"""Bulk move, archive and restore through the real rendered history; fake API only."""
import json
import os
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
from playwright.sync_api import expect, sync_playwright

url = os.environ.get('PLUM_FIXTURE_URL', 'http://127.0.0.1:5188')
assert url.startswith(('http://127.0.0.1:', 'http://localhost:'))
stamp = '2026-10-26T02:00:00Z'
output = Path('.screenshots'); output.mkdir(exist_ok=True)
with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path='/usr/local/bin/plum-chromium', headless=True)
    for width, height in [(1440, 1000), (390, 844)]:
        page = browser.new_page(viewport={'width': width, 'height': height}); page.set_default_timeout(15000)
        page.add_init_script("localStorage.setItem('claude-webui-auth',JSON.stringify({state:{token:'bulk-fixture'},version:0}))")
        errors = []; page.on('pageerror', lambda error: errors.append(str(error)))
        state = {'rows': [dict(id=name.lower(), kind='api-chat', revision=1, title=name, body=dict(providerId='fixture', model='fixture'), createdAt=stamp, updatedAt=stamp, archived=False) for name in ['Alpha', 'Beta', 'Läuft']], 'actions': []}
        project = dict(id='project', kind='project', revision=1, title='Projektwissen', body={}, createdAt=stamp, updatedAt=stamp)
        def api(route):
            request = route.request; parsed = urlsplit(request.url); path = parsed.path; query = parse_qs(parsed.query)
            payload = json.loads(request.post_data) if request.post_data else {}
            data = {} if 'settings' in path else []
            if path == '/auth/me': data = dict(id='bulk-fixture', email='bulk@example.invalid', username='Fixture', role='admin')
            elif path == '/api/basic-auth/status': data = dict(enabled=False)
            elif path == '/api/assistant/personalization': data = dict(revision=1, nickname='', referencePhotos=dict(portrait=None, fullBody=None))
            elif path == '/api/assistant/overview': data = dict(counts={}, tasks=[], recent=[], agents=[])
            elif path == '/api/assistant/projects': data = [project]
            elif path == '/api/assistant/api-chats': data = [r for r in state['rows'] if not r['archived']]
            elif path == '/api/assistant/api-chats/manage':
                archived = query.get('archived', ['false'])[0] == 'true'
                data = dict(entries=[r for r in state['rows'] if r['archived'] == archived], nextOffset=None, busyChats={} if archived else {'läuft': 'running'})
            elif path == '/api/assistant/api-chats/bulk':
                assert len(payload['chats']) == 2
                assert {item['id'] for item in payload['chats']} == {'alpha', 'beta'}
                state['actions'].append(payload['action'])
                for item in payload['chats']:
                    row = next(r for r in state['rows'] if r['id'] == item['id'])
                    assert row['revision'] == item['expectedRevision']
                    if payload['action'] == 'move': row['body']['projectId'] = payload['projectId']
                    else: row['archived'] = payload['action'] == 'archive'
                    row['revision'] += 1
                data = dict(count=2, ids=['alpha', 'beta'], action=payload['action'])
            route.fulfill(content_type='application/json', body=json.dumps(dict(success=True, data=data)))
        page.route('**/api/**', api); page.route('**/auth/me', api); page.route('**/socket.io/**', lambda route: route.abort())
        page.goto(url + '/chat/history')
        expect(page.get_by_role('checkbox', name='Läuft auswählen', exact=True)).to_be_disabled()
        for name in ['Alpha', 'Beta']: page.get_by_role('checkbox', name=name + ' auswählen', exact=True).check()
        page.get_by_role('combobox', name='Zielprojekt', exact=True).select_option('project')
        page.get_by_role('button', name='Verschieben', exact=True).click()
        expect(page.get_by_text('0 ausgewählt', exact=True)).to_be_visible()
        for row in state['rows'][:2]: assert row['body']['projectId'] == 'project'
        for name in ['Alpha', 'Beta']: page.get_by_role('checkbox', name=name + ' auswählen', exact=True).check()
        page.screenshot(path=str(output / f'chat-manager-{width}.png'))
        page.get_by_role('button', name='Archivieren', exact=True).click()
        expect(page.get_by_role('checkbox', name='Alpha auswählen', exact=True)).to_have_count(0)
        page.get_by_role('button', name='Archiv', exact=True).click()
        for name in ['Alpha', 'Beta']: page.get_by_role('checkbox', name=name + ' auswählen', exact=True).check()
        page.screenshot(path=str(output / f'chat-manager-archive-{width}.png'))
        page.get_by_role('button', name='Wiederherstellen', exact=True).click()
        expect(page.get_by_text('Archiv ist leer.', exact=True)).to_be_visible()
        page.get_by_role('button', name='Gespräche', exact=True).click()
        expect(page.get_by_role('checkbox', name='Alpha auswählen', exact=True)).to_be_visible()
        page.reload()
        expect(page.get_by_role('checkbox', name='Beta auswählen', exact=True)).to_be_visible()
        assert state['actions'] == ['move', 'archive', 'restore']
        assert not page.evaluate('document.documentElement.scrollWidth > innerWidth')
        assert not errors, errors
        print(f'PASS {width}px: owner history, busy guard, two-chat selection, move, archive, restore and reload; fake API')
        page.close()
    browser.close()
