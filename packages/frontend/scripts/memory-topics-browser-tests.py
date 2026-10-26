"""Rendered live topic documents, correction, diff, provenance and forgetting; stateful fake API."""
import json
import os
import re
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import expect, sync_playwright

url = os.environ.get('PLUM_FIXTURE_URL', 'http://127.0.0.1:5188')
assert url.startswith(('http://127.0.0.1:', 'http://localhost:'))
stamp = '2026-10-26T01:00:00Z'
output = Path('.screenshots')
output.mkdir(exist_ok=True)
with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path='/usr/local/bin/plum-chromium', headless=True)
    for width, height in [(1440, 1000), (390, 844)]:
        page = browser.new_page(viewport={'width': width, 'height': height})
        page.set_default_timeout(15000)
        page.add_init_script("localStorage.setItem('claude-webui-auth',JSON.stringify({state:{token:'topic-fixture'},version:0}))")
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        state = dict(entries=[dict(id='fact-one', kind='memory', revision=1, title='Küche', body=dict(topic='Kochwissen', scope='personal', text='ALT', origins=[dict(type='api', id='origin-chat', turnId='origin-turn', quote='Beleg aus dem Gespräch')]), createdAt=stamp, updatedAt=stamp), dict(id='fact-two', kind='memory', revision=1, title='Vorräte', body=dict(topic='Kochwissen', scope='personal', text='Zweiter Abschnitt'), createdAt=stamp, updatedAt=stamp)])
        def api(route):
            request = route.request
            path = urlsplit(request.url).path
            payload = json.loads(request.post_data) if request.post_data else {}
            data = {} if 'settings' in path else []
            status = 200
            if path == '/auth/me':
                data = dict(id='topic-fixture', email='topic@example.invalid', username='Fixture', role='admin')
            elif path == '/api/basic-auth/status':
                data = dict(enabled=False)
            elif path == '/api/assistant/personalization':
                data = dict(revision=1, nickname='', referencePhotos=dict(portrait=None, fullBody=None))
            elif path == '/api/assistant/overview':
                data = dict(counts={}, tasks=[], recent=[], agents=[])
            elif path == '/api/assistant/memory-system/topics':
                data = dict(topics=[dict(id='a' * 64, title='Kochwissen', scope='personal', scopeId='', count=len(state['entries']), updatedAt=stamp)] if state['entries'] else [], nextOffset=None)
            elif path == '/api/assistant/memory-system/topics/' + 'a' * 64:
                if request.method == 'DELETE':
                    assert payload['expectedVersion'] == 'b' * 64
                    state['entries'] = []
                    data = dict(forgotten=2)
                elif not state['entries']:
                    status = 404
                else:
                    data = dict(entries=state['entries'], version='b' * 64, nextOffset=None)
            elif path == '/api/assistant/memory/fact-one' and request.method == 'PATCH':
                assert payload['expectedRevision'] == 1
                state['entries'][0].update(title=payload['title'], body=payload['body'], revision=2)
                data = state['entries'][0]
            elif path == '/api/assistant/revision-diff/memory/fact-one':
                data = dict(lines=[dict(type='removed', text='ALT'), dict(type='added', text='NEU: korrigierter Wissensstand')])
            route.fulfill(status=status, content_type='application/json', body=json.dumps(dict(success=status == 200, data=data, error=dict(message='Thema nicht gefunden') if status == 404 else None)))
        page.route('**/api/**', api)
        page.route('**/auth/me', api)
        page.route('**/socket.io/**', lambda route: route.abort())
        page.goto(url + '/assistant/memory-topics')
        page.get_by_role('navigation', name='Gedächtnisthemen').get_by_role('button', name=re.compile('Kochwissen.*Persönlich')).click()
        expect(page.get_by_text('Zweiter Abschnitt', exact=True)).to_be_visible()
        page.get_by_role('button', name='Bearbeiten', exact=True).first.click()
        dialog = page.get_by_role('dialog')
        dialog.get_by_role('textbox', name='Wissensstand', exact=True).fill('NEU: korrigierter Wissensstand')
        dialog.get_by_role('button', name='Speichern', exact=True).click()
        expect(dialog).to_have_count(0)
        expect(page.get_by_text('NEU: korrigierter Wissensstand', exact=True)).to_be_visible()
        page.get_by_text('Herkunft und Belege', exact=True).click()
        expect(page.get_by_text('Beleg aus dem Gespräch', exact=True)).to_be_visible()
        page.screenshot(path=str(output / f'memory-topics-{width}.png'))
        page.get_by_role('button', name='Änderungen vergleichen', exact=True).first.click()
        dialog = page.get_by_role('dialog')
        expect(dialog.get_by_text('− ALT', exact=True)).to_be_visible()
        expect(dialog.get_by_text('+ NEU: korrigierter Wissensstand', exact=True)).to_be_visible()
        page.screenshot(path=str(output / f'memory-topic-diff-{width}.png'))
        dialog.get_by_role('button', name='Close', exact=True).click()
        expect(dialog).to_have_count(0)
        page.get_by_role('button', name='Thema vergessen', exact=True).click()
        page.get_by_role('dialog').get_by_role('button', name='Thema vergessen', exact=True).click()
        expect(page.get_by_text('Keine Themen.', exact=True)).to_be_visible()
        expect(page.get_by_text('NEU: korrigierter Wissensstand', exact=True)).to_have_count(0)
        page.reload()
        expect(page.get_by_text('Keine Themen.', exact=True)).to_be_visible()
        assert not page.evaluate('document.documentElement.scrollWidth > innerWidth')
        assert not errors, errors
        print(f'PASS {width}px: topic, edit with pinned original provenance, immutable diff, whole-topic forgetting and reload; API mocked')
        page.close()
    browser.close()
