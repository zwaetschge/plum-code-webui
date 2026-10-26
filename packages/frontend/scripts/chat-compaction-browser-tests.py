"""Compaction coverage, actual checkpoint note and forgotten checkpoint in rendered chat; fake API only."""
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
                    data['compaction'] = dict(id='checkpoint', status='completed', summary='Früheres Ziel aus dem Gespräch, als Verlauf verdichtet.', throughSeq=12, coveredTurns=12, olderTurns=15, remainingTurns=3, sourceHash='fixture', truncatedTurnIds=['old-turn'])
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
        page.get_by_text('Verlauf · 12 Beiträge verdichtet', exact=True).click()
        expect(page.get_by_text('12 von 15 früheren Beiträgen · bis Beitrag 12', exact=True)).to_be_visible()
        expect(page.get_by_text('3 weitere Beiträge fehlen in dieser Verdichtung.', exact=True)).to_be_visible()
        expect(page.get_by_text('Ein Beitrag mit gekürztem Auszug', exact=True)).to_be_visible()
        expect(page.get_by_text('Früheres Ziel aus dem Gespräch, als Verlauf verdichtet.', exact=True)).to_be_visible()
        page.screenshot(path=str(output / f'chat-compaction-{width}.png'))
        state['turns'][0]['compaction'].update(id=None, status='failed', summary='', error='Diese Verdichtung ist nicht mehr verfügbar.')
        state['turns'][0]['contextReceipt']['references'][0].update(available=False, title='Vergessene Erinnerung', text=None)
        page.reload()
        page.get_by_text('Gedächtnis · 2 Kontextbelege · Verarbeitet', exact=True).click()
        expect(page.get_by_text('Erinnerung · Vergessene Erinnerung · Revision 2 · Nicht mehr verfügbar', exact=True)).to_be_visible()
        expect(page.get_by_text('Konkrete Aufgaben schrittweise bearbeiten.', exact=True)).to_have_count(0)
        expect(page.get_by_text('Früheres Ziel aus dem Gespräch, als Verlauf verdichtet.', exact=True)).to_have_count(0)
        expect(page.get_by_text('Verdichtung nicht verfügbar', exact=True)).to_be_visible()
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
        assert not page.evaluate('document.documentElement.scrollWidth > innerWidth')
        assert not errors, errors
        page.close()
        print(f'PASS {width}px: compaction coverage, bounded excerpts, actual note and forgotten-checkpoint reload; all HTTP/model responses mocked')
    browser.close()
