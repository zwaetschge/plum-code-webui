"""Real Chat UI regression with an isolated, stateful API (never production)."""
import json
import os
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright

url = os.environ.get('PLUM_FIXTURE_URL', 'http://127.0.0.1:5188')
assert url.startswith(('http://127.0.0.1:', 'http://localhost:'))
output = Path('.screenshots')
output.mkdir(exist_ok=True)
stamp = '2026-10-19T12:00:00Z'


def resource(identifier, kind, title, body):
    return dict(id=identifier, kind=kind, title=title, body=body, revision=1,
                createdAt=stamp, updatedAt=stamp)


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path='/usr/local/bin/plum-chromium', headless=True)
    for width, height in [(1440, 1000), (390, 844)]:
        page = browser.new_page(viewport={'width': width, 'height': height})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.add_init_script("localStorage.setItem('claude-webui-auth',JSON.stringify({state:{token:'workspace-fixture'},version:0}))")
        state = {'profiles': [], 'projects': [], 'sources': [resource('reference', 'source', 'Stilhandbuch', {'text': 'Klare Sprache verwenden.'})], 'api-chats': []}
        calls = []
        turns = []
        fail_next_save = [False]
        providers = [{'id': 'fixture', 'name': 'Testverbindung', 'protocol': 'openai', 'models': ['fixture-model', 'preferred-model']}]

        def api(route):
            request = route.request
            path = urlsplit(request.url).path
            payload = json.loads(request.post_data) if request.post_data and 'application/json' in request.headers.get('content-type', '') else {}
            calls.append((request.method, path, payload))
            data = {} if 'settings' in path else []
            parts = path.removeprefix('/api/assistant/').split('/')
            collection = parts[0]
            if path == '/auth/me':
                data = {'id': 'workspace-alice', 'email': 'alice@example.invalid', 'username': 'Alice', 'role': 'admin'}
            elif path == '/api/basic-auth/status':
                data = {'enabled': False}
            elif path == '/api/assistant/personalization':
                data = {'revision': 0, 'nickname': '', 'voiceChat': False, 'suggestedPrompts': False, 'referencePhotos': {'portrait': None, 'fullBody': None}}
            elif path == '/api/assistant/api-chat-providers':
                data = providers
            elif path == '/api/assistant/overview':
                data = {'counts': {}, 'recent': [], 'tasks': [], 'agents': []}
            elif path == '/api/assistant/references':
                data = [item for rows in state.values() for item in rows if item['id'] in payload.get('ids', [])]
            elif collection in state:
                rows = state[collection]
                if len(parts) == 1:
                    if request.method == 'POST':
                        if fail_next_save[0]:
                            fail_next_save[0] = False
                            route.fulfill(status=422, content_type='application/json', body=json.dumps({'success': False, 'error': {'message': 'Speichern fehlgeschlagen. Bitte erneut versuchen.'}}))
                            return
                        data = resource(f'{collection}-{len(rows) + 1}', {'profiles': 'profile', 'projects': 'project', 'sources': 'source', 'api-chats': 'api-chat'}[collection], payload['title'], payload.get('body', payload))
                        rows.append(data)
                    else:
                        data = rows
                else:
                    item = next((row for row in rows if row['id'] == parts[1]), None)
                    if len(parts) == 3 and parts[2] == 'turns':
                        if request.method == 'POST':
                            data = {'id': payload['commandId'], 'seq': len(turns) + 1, 'prompt': payload['prompt'], 'response': 'Antwort mit gemeinsamem Projektwissen.', 'status': 'completed', 'model': 'preferred-model', 'sourceVersions': [], 'imageAssetIds': [], 'usage': None, 'createdAt': stamp}
                            turns.append(data)
                        else:
                            data = {'chat': item, 'turns': turns}
                    elif request.method == 'PATCH':
                        assert payload['expectedRevision'] == item['revision']
                        item.update(title=payload['title'], body=payload.get('body', {**item['body'], **payload}), revision=item['revision'] + 1)
                        data = item
                    elif request.method == 'DELETE':
                        assert payload['expectedRevision'] == item['revision']
                        rows.remove(item)
                        data = item
                    else:
                        data = item
            route.fulfill(content_type='application/json', body=json.dumps({'success': True, 'data': data}))

        page.route('**/api/**', api)
        page.route('**/auth/me', api)
        page.route('**/socket.io/**', lambda route: route.abort())
        page.goto(url + '/chat')
        workspace = page.locator('section[aria-label="Assistent und Projekt"]')
        expect(workspace.get_by_role('combobox', name='Assistent', exact=True)).to_be_visible()
        expect(workspace.get_by_role('combobox', name='Projekt', exact=True)).to_be_visible()
        workspace.get_by_role('button', name='Verwalten', exact=True).click()
        dialog = page.get_by_role('dialog')
        expect(dialog.get_by_role('heading', name='Assistenten und Projekte', exact=True)).to_be_visible()
        dialog.get_by_role('button', name='Neuer Assistent', exact=True).click()
        dialog.get_by_role('textbox', name='Name', exact=True).fill('Schreibcoach')
        dialog.get_by_role('textbox', name='Anweisungen', exact=True).fill('Antworte klar und auf Deutsch.')
        dialog.get_by_role('combobox', name='Bevorzugte API-Verbindung', exact=True).select_option('fixture')
        dialog.get_by_role('combobox', name='Bevorzugtes Modell', exact=True).select_option('preferred-model')
        dialog.get_by_role('checkbox', name='Stilhandbuch', exact=True).check()
        fail_next_save[0] = True
        dialog.get_by_role('button', name='Speichern', exact=True).click()
        expect(dialog.get_by_role('alert')).to_be_visible()
        expect(dialog.get_by_role('textbox', name='Name', exact=True)).to_have_value('Schreibcoach')
        dialog.get_by_role('button', name='Speichern', exact=True).click()
        expect(dialog.get_by_role('button', name='Schreibcoach bearbeiten', exact=True)).to_be_visible()
        assert state['profiles'][0]['body']['sourceIds'] == ['reference']
        assert state['profiles'][0]['body']['model'] == 'preferred-model'
        dialog.get_by_role('button', name='Schreibcoach bearbeiten', exact=True).click()
        expect(dialog.get_by_role('textbox', name='Anweisungen', exact=True)).to_have_value('Antworte klar und auf Deutsch.')
        dialog.get_by_role('textbox', name='Anweisungen', exact=True).fill('Antworte klar, kurz und auf Deutsch.')
        dialog.get_by_role('button', name='Speichern', exact=True).click()
        expect(dialog.get_by_role('button', name='Schreibcoach bearbeiten', exact=True)).to_be_visible()
        assert state['profiles'][0]['revision'] == 2
        dialog.get_by_role('button', name='Projekte', exact=True).click()
        dialog.get_by_role('button', name='Neues Projekt', exact=True).click()
        dialog.get_by_role('textbox', name='Name', exact=True).fill('Hausumbau')
        dialog.get_by_role('textbox', name='Beschreibung', exact=True).fill('Alle Gespräche zum Umbau')
        dialog.get_by_role('textbox', name='Anweisungen', exact=True).fill('Budget in Schweizer Franken berücksichtigen.')
        dialog.get_by_role('button', name='Speichern', exact=True).click()
        expect(dialog.get_by_role('button', name='Hausumbau bearbeiten', exact=True)).to_be_visible()
        dialog.get_by_role('button', name='Projektquellen', exact=True).click()
        dialog.get_by_role('button', name='Neue Projektquelle', exact=True).click()
        dialog.get_by_role('textbox', name='Name', exact=True).fill('Umbau-Budget')
        dialog.get_by_role('textbox', name='Quellentext', exact=True).fill('Das Gesamtbudget beträgt 20000 CHF.')
        dialog.get_by_role('button', name='Speichern', exact=True).click()
        expect(dialog.get_by_role('button', name='Umbau-Budget bearbeiten', exact=True)).to_be_visible()
        assert state['sources'][-1]['body']['projectId'] == 'projects-1'
        dialog.get_by_role('button', name='Umbau-Budget bearbeiten', exact=True).click()
        dialog.get_by_role('textbox', name='Quellentext', exact=True).fill('Das Gesamtbudget beträgt 25000 CHF.')
        dialog.get_by_role('button', name='Speichern', exact=True).click()
        expect(dialog.get_by_role('button', name='Umbau-Budget bearbeiten', exact=True)).to_be_visible()
        page.screenshot(path=str(output / f'chat-workspace-manager-{width}.png'), full_page=True)
        page.keyboard.press('Escape')
        expect(dialog).not_to_be_visible()
        expect(workspace.get_by_role('combobox', name='Assistent', exact=True)).to_have_value('profiles-1')
        expect(workspace.get_by_role('combobox', name='Projekt', exact=True)).to_have_value('projects-1')
        assert not page.evaluate('document.documentElement.scrollWidth > innerWidth')
        page.screenshot(path=str(output / f'chat-workspace-after-{width}.png'), full_page=True)
        page.get_by_role('textbox', name='Deine Nachricht', exact=True).fill('Wie verteile ich mein Budget?')
        page.get_by_role('button', name='Nachricht senden', exact=True).click()
        expect(page).to_have_url(url + '/chat/model/api-chats-1')
        expect(page.get_by_text('Antwort mit gemeinsamem Projektwissen.', exact=True)).to_be_visible()
        creation = next(payload for method, path, payload in calls if method == 'POST' and path == '/api/assistant/api-chats')
        assert creation['profileId'] == 'profiles-1' and creation['projectId'] == 'projects-1'
        assert creation['providerId'] == 'fixture' and creation['model'] == 'preferred-model'
        assert not any(method == 'POST' and path == '/api/sessions' for method, path, payload in calls)
        state['projects'].append(resource('other-project', 'project', 'Garten', {'instructions': 'Nur den Garten berücksichtigen.'}))
        page.get_by_role('button', name='Anhänge und Vorgaben', exact=True).click()
        page.get_by_role('menuitem', name='Gesprächsoptionen', exact=True).click()
        settings = page.get_by_role('dialog')
        project_picker = settings.get_by_role('group', name='Projekt', exact=True)
        expect(project_picker.get_by_role('checkbox', name='Hausumbau', exact=True)).to_be_checked()
        project_picker.get_by_role('checkbox', name='Garten', exact=True).check()
        settings.get_by_role('button', name='Personalisierung speichern', exact=True).click()
        expect(settings).not_to_be_visible()
        assert state['api-chats'][0]['body']['projectId'] == 'other-project'
        project_update = next(payload for method, path, payload in calls if method == 'PATCH' and path == '/api/assistant/api-chats/api-chats-1')
        assert project_update['projectId'] == 'other-project'
        page.goto(url + '/chat?project=other-project&workspace=projects')
        expect(page.get_by_role('dialog').get_by_role('heading', name='Gespräche in Garten', exact=True)).to_be_visible()
        expect(page.get_by_role('dialog').get_by_role('link', name='Wie verteile ich mein Budget?', exact=True)).to_have_attribute('href', '/chat/model/api-chats-1')
        page.screenshot(path=str(output / f'chat-workspace-project-{width}.png'), full_page=True)
        page.keyboard.press('Escape')
        page.goto(url + '/chat?project=projects-1&workspace=projects')
        expect(page.get_by_role('dialog').get_by_role('heading', name='Gespräche in Hausumbau', exact=True)).to_be_visible()
        expect(page.get_by_role('dialog').get_by_role('link', name='Wie verteile ich mein Budget?', exact=True)).to_have_count(0)
        expect(page.get_by_role('dialog').get_by_text('Noch keine Gespräche. Wähle das Projekt und sende deine erste Nachricht.', exact=True)).to_be_visible()
        page.get_by_role('dialog').get_by_role('button', name='Projektquellen', exact=True).click()
        page.get_by_role('dialog').get_by_role('button', name='Umbau-Budget bearbeiten', exact=True).click()
        page.get_by_role('dialog').get_by_role('button', name='Archivieren', exact=True).click()
        expect(page.get_by_role('dialog').get_by_role('button', name='Umbau-Budget bearbeiten', exact=True)).to_have_count(0)
        assert not any(row['title'] == 'Umbau-Budget' for row in state['sources'])
        page.get_by_role('dialog').get_by_role('button', name='Assistenten', exact=True).click()
        page.get_by_role('dialog').get_by_role('button', name='Schreibcoach bearbeiten', exact=True).click()
        page.get_by_role('dialog').get_by_role('button', name='Archivieren', exact=True).click()
        expect(page.get_by_role('dialog').get_by_role('button', name='Schreibcoach bearbeiten', exact=True)).to_have_count(0)
        assert not state['profiles']
        assert not errors, errors
        print(f'PASS {width}px: direct selectors; assistant create/edit/model/knowledge; save failure retains input; project/shared-source create/edit; chat profile/project delivery; existing-chat project change and filtered grouping; source/assistant archive; no JS errors or horizontal overflow')
        page.close()
    browser.close()
