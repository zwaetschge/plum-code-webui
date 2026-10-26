"""Durable queue controls in the rendered chat; fake API only, backend persistence tested separately."""
import json
import os
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import expect, sync_playwright

url = os.environ.get('PLUM_FIXTURE_URL', 'http://127.0.0.1:5188')
assert url.startswith(('http://127.0.0.1:', 'http://localhost:'))
stamp = '2026-10-25T21:00:00Z'
output = Path('.screenshots')
output.mkdir(exist_ok=True)

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path='/usr/local/bin/plum-chromium', headless=True)
    for width, height in [(1440, 1000), (390, 844)]:
        page = browser.new_page(viewport={'width': width, 'height': height})
        page.add_init_script("localStorage.setItem('claude-webui-auth',JSON.stringify({state:{token:'memory-fixture'},version:0}))")
        state = {'chat': None, 'turns': [], 'patches': []}
        page.set_default_timeout(15000)
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        def api(route):
            request = route.request
            path = urlsplit(request.url).path
            payload = json.loads(request.post_data) if request.post_data and 'application/json' in request.headers.get('content-type', '') else {}
            data = {} if 'settings' in path else []
            if path == '/auth/me':
                data = {'id': 'memory-browser', 'email': 'memory@example.invalid', 'username': 'Memory', 'role': 'admin'}
            elif path == '/api/basic-auth/status':
                data = {'enabled': False}
            elif path == '/api/assistant/personalization':
                data = {'revision': 1, 'nickname': '', 'voiceChat': False, 'suggestedPrompts': False, 'referencePhotos': {'portrait': None, 'fullBody': None}}
            elif path == '/api/claude-config/skills':
                data = [dict(baseName='fixture-analysis', name='Datenanalyse', description='Daten prüfen'), dict(baseName='fixture-docs', name='Dokumentation', description='Dokumente schreiben')]
            elif path == '/api/mcp-servers':
                data = [dict(id='fixture-mcp', name='Testwerkzeuge', enabled=True)]
            elif path == '/api/assistant/api-chat-tools/catalog':
                data = [dict(key='fixture-mcp:analyse', name='analyse', description='Daten lesen', readOnly=True)]
            elif path == '/api/assistant/api-chats/memory-chat/options':
                state['chat']['body']['chatOptions'] = payload['options']
                state['chat']['revision'] += 1
                data = state['chat']
            elif path.endswith('/stop'):
                identifier = path.split('/')[-2]
                next(turn for turn in state['turns'] if turn['id'] == identifier)['status'] = 'cancelled'
                data = {}
            elif path.endswith('/tools/fixture-call/decision'):
                state['decision'] = payload['decision']
                state['turns'][0]['toolEvents'][0].update(status='completed', result='Bestätigt')
                state['turns'][0]['status'] = 'completed'
                data = dict(decision=payload['decision'])
            elif path == '/api/assistant/api-chat-providers':
                data = [{'id': 'z-ai', 'name': 'GLM', 'protocol': 'openai', 'models': ['glm-5.3-flash']}]
            elif path == '/api/assistant/overview':
                data = {'counts': {}, 'tasks': [], 'recent': [], 'agents': []}
            elif path == '/api/assistant/api-chats':
                if request.method == 'POST':
                    state['chat'] = dict(id='memory-chat', kind='api-chat', revision=1, title=payload['title'], body=payload, createdAt=stamp, updatedAt=stamp)
                    data = state['chat']
                else:
                    data = [state['chat']] if state['chat'] else []
            elif path == '/api/assistant/api-chats/memory-chat/turns':
                if request.method == 'POST':
                    data = dict(id=payload['commandId'], seq=1, prompt=payload['prompt'], response='Lokale Testantwort.', status='completed', model='glm-5.3-flash', providerId='z-ai', sourceVersions=[], imageAssetIds=[], createdAt=stamp, usage=None)
                    data['contextReceipt'] = dict(version=1, memoryRead=True, memoryLearn=True, personalizationRevision=4, profileId=None, profileRevision=None, projectId='project', projectRevision=2, legacyNotes=False, voiceHistory=False, references=[dict(kind='memory', id='memory', revision=2, title='Arbeitsweise', available=True, text='Konkrete Aufgaben schrittweise bearbeiten.'), dict(kind='project-chat', id='related', turnId='related-turn', title='Projektplanung', available=True)], learning=dict(status='completed', memories=[dict(id='learned', title='Neue Präferenz', revision=1, proposed=True)], historySaved=True, writingStyleSaved=False))
                    data['seq'] = len(state['turns']) + 1
                    if any(turn['status'] == 'running' for turn in state['turns']):
                        data.update(status='queued', response='')
                        data.pop('contextReceipt', None)
                    state['turns'].append(data)
                else:
                    data = {'chat': state['chat'], 'turns': state['turns']}
            elif path == '/api/assistant/api-chats/memory-chat' and request.method == 'PATCH':
                assert payload['expectedRevision'] == state['chat']['revision']
                state['patches'].append(payload)
                state['chat']['body'].update(payload)
                state['chat']['revision'] += 1
                data = state['chat']
            route.fulfill(content_type='application/json', body=json.dumps({'success': True, 'data': data}))
        page.route('**/api/**', api)
        page.route('**/auth/me', api)
        page.route('**/socket.io/**', lambda route: route.abort())
        page.goto(url + '/chat')
        page.get_by_role('button', name='Anhänge und Vorgaben', exact=True).click()
        page.get_by_role('menuitem', name='Gesprächsoptionen', exact=True).click()
        dialog = page.get_by_role('dialog')
        read = dialog.get_by_role('checkbox', name='Frühere Erinnerungen und Chats verwenden', exact=True)
        learn = dialog.get_by_role('checkbox', name='Aus diesem Gespräch lernen', exact=True)
        expect(read).to_be_checked()
        expect(learn).to_be_checked()
        read.uncheck()
        learn.uncheck()
        page.screenshot(path=str(output / f'chat-memory-new-{width}.png'))
        dialog.get_by_role('button', name='Fertig', exact=True).click()
        page.get_by_role('textbox', name='Deine Nachricht', exact=True).fill('Gedächtnistest')
        page.get_by_role('button', name='Nachricht senden', exact=True).click()
        expect(page).to_have_url(url + '/chat/model/memory-chat')
        expect(page.get_by_text('Lokale Testantwort.', exact=True)).to_be_visible()
        page.get_by_text('Gedächtnis · 2 Kontextbelege · Verarbeitet', exact=True).click()
        expect(page.get_by_text('Neue Präferenz · Revision 1 · Zur Prüfung', exact=True)).to_be_visible()
        page.get_by_text('Erinnerung · Arbeitsweise · Revision 2', exact=True).click()
        expect(page.get_by_text('Konkrete Aufgaben schrittweise bearbeiten.', exact=True)).to_be_visible()
        page.screenshot(path=str(output / f'chat-context-receipt-{width}.png'))
        state['turns'][0]['contextReceipt']['references'][0].update(available=False, title='Vergessene Erinnerung', text=None)
        page.reload()
        page.get_by_text('Gedächtnis · 2 Kontextbelege · Verarbeitet', exact=True).click()
        expect(page.get_by_text('Erinnerung · Vergessene Erinnerung · Revision 2 · Nicht mehr verfügbar', exact=True)).to_be_visible()
        expect(page.get_by_text('Konkrete Aufgaben schrittweise bearbeiten.', exact=True)).to_have_count(0)
        assert state['chat']['body']['memoryRead'] is False
        assert state['chat']['body']['memoryLearn'] is False
        page.get_by_role('button', name='Anhänge und Vorgaben', exact=True).click()
        page.get_by_role('menuitem', name='Gesprächsoptionen', exact=True).click()
        dialog = page.get_by_role('dialog')
        read = dialog.get_by_role('checkbox', name='Frühere Erinnerungen und Chats verwenden', exact=True)
        learn = dialog.get_by_role('checkbox', name='Aus diesem Gespräch lernen', exact=True)
        expect(read).not_to_be_checked()
        expect(learn).not_to_be_checked()
        learn.check()
        page.screenshot(path=str(output / f'chat-memory-existing-{width}.png'))
        dialog.get_by_role('button', name='Personalisierung speichern', exact=True).click()
        expect(dialog).to_have_count(0)
        assert state['patches'][-1]['memoryRead'] is False
        assert state['patches'][-1]['memoryLearn'] is True
        page.reload()
        page.get_by_role('button', name='Anhänge und Vorgaben', exact=True).click()
        page.get_by_role('menuitem', name='Gesprächsoptionen', exact=True).click()
        expect(page.get_by_role('checkbox', name='Frühere Erinnerungen und Chats verwenden', exact=True)).not_to_be_checked()
        expect(page.get_by_role('checkbox', name='Aus diesem Gespräch lernen', exact=True)).to_be_checked()
        page.get_by_role('dialog').get_by_role('button', name='Personalisierung speichern', exact=True).click()
        expect(page.get_by_role('dialog')).to_have_count(0)
        page.get_by_role('button', name='Chat-Werkzeuge', exact=True).click()
        dialog = page.get_by_role('dialog')
        dialog.get_by_text('Fachliche Skills · 0', exact=True).click()
        dialog.get_by_role('checkbox', name='Datenanalyse', exact=True).check()
        dialog.get_by_role('checkbox', name='Dokumentation', exact=True).check()
        dialog.get_by_text('MCP-Werkzeuge', exact=True).click()
        dialog.get_by_role('checkbox', name='Testwerkzeuge', exact=True).check()
        dialog.get_by_role('button', name='Funktionen verwalten', exact=True).click()
        dialog.get_by_role('combobox', name='Berechtigung für analyse', exact=True).select_option('ask')
        page.screenshot(path=str(output / f'chat-capabilities-{width}.png'))
        dialog.get_by_role('button', name='Speichern', exact=True).click()
        expect(dialog).to_have_count(0)
        options = state['chat']['body']['chatOptions']
        assert options['skillNames'] == ['fixture-analysis', 'fixture-docs']
        assert options['toolLoading'] == 'on-demand'
        assert options['toolPermissions']['fixture-mcp:analyse'] == 'ask'
        state['turns'][0]['toolEvents'] = [dict(id='fixture-call', name='mcp_fixture_analyse', status='waiting', arguments='{"source":"Testdaten"}')]
        state['turns'][0]['status'] = 'running'
        page.reload()
        expect(page.get_by_role('button', name='Einmal erlauben', exact=True)).to_be_visible()
        page.screenshot(path=str(output / f'chat-tool-decision-{width}.png'))
        page.get_by_role('button', name='Einmal erlauben', exact=True).click()
        expect(page.get_by_role('button', name='Einmal erlauben', exact=True)).to_have_count(0)
        assert state['decision'] == 'allow'
        state['turns'][0]['status'] = 'running'
        page.reload()
        page.get_by_role('textbox', name='Deine Nachricht', exact=True).fill('Folgefrage mit Warteschlange')
        page.get_by_role('button', name='Nachricht vormerken', exact=True).click()
        expect(page.get_by_text('Folgefrage mit Warteschlange', exact=True)).to_be_visible()
        expect(page.get_by_role('button', name='Wartende Nachricht entfernen', exact=True)).to_be_visible()
        assert state['turns'][-1]['status'] == 'queued'
        page.screenshot(path=str(output / f'chat-queue-{width}.png'))
        page.reload()
        expect(page.get_by_role('button', name='Wartende Nachricht entfernen', exact=True)).to_be_visible()
        page.get_by_role('button', name='Wartende Nachricht entfernen', exact=True).click()
        expect(page.get_by_role('button', name='Wartende Nachricht entfernen', exact=True)).to_have_count(0)
        assert state['turns'][-1]['status'] == 'cancelled'
        assert not page.evaluate('document.documentElement.scrollWidth > innerWidth')
        assert not errors, errors
        page.close()
        print(f'PASS {width}px: queued follow-up during streaming, reload and individual cancellation; all HTTP/model responses mocked')
    browser.close()
