"""Existing settings skill editor: create nested file, save and compare immutable versions."""
import json
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
from playwright.sync_api import sync_playwright, expect

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/local/bin/plum-chromium', headless=True)
    for width, height in [(1440, 1000), (390, 844)]:
        page = browser.new_page(viewport={'width': width, 'height': height})
        page.set_default_timeout(20000)
        page.add_init_script("localStorage.setItem('claude-webui-auth',JSON.stringify({state:{token:'skill-fixture'},version:0}))")
        state = {'files': {'SKILL.md': dict(path='SKILL.md', hash='a'*64, content='# Original')}, 'history': {}}
        errors = []; page.on('pageerror', lambda e: errors.append(str(e)))
        def api(route):
            req = route.request; path = urlsplit(req.url).path; query = parse_qs(urlsplit(req.url).query)
            data = {} if 'settings' in path else []
            if path == '/auth/me': data = dict(id='owner', username='Fixture', role='admin', email='fixture@example.invalid')
            elif path == '/api/basic-auth/status': data = dict(enabled=False)
            elif path == '/api/settings/subagent-models': data = []
            elif path == '/api/settings': data = dict(defaultProvider='codex', defaultModel='fixture')
            elif path == '/api/claude-config/skills': data = [dict(id='fixture', baseName='fixture', name='Fixture', dirPath='/fixtures/fixture', description='Test', enabled=True, libraryKind='skill', source='user')]
            elif path == '/api/claude-config/skill/fixture': data = dict(name='Fixture', description='Test', content='Original')
            elif path.endswith('/fixture/files'): data = dict(files=list(state['files']), readOnly=False)
            elif path.endswith('/fixture/file-history'):
                data = [dict(hash=key, createdAt='2026-10-26T03:00:00Z') for key in state['history'].get(query['path'][0], {})]
            elif path.endswith('/fixture/file'):
                if req.method == 'PUT':
                    payload = json.loads(req.post_data); name = payload['path']; old = state['files'].get(name)
                    assert payload['expectedHash'] == (old['hash'] if old else None)
                    if old: state['history'].setdefault(name, {})[old['hash']] = dict(old)
                    data = dict(path=name, hash='b'*64, content=payload['content']); state['files'][name] = data
                else:
                    name = query['path'][0]; version = query.get('revision', [None])[0]
                    data = state['history'][name][version] if version else state['files'][name]
            route.fulfill(content_type='application/json', body=json.dumps(dict(success=True, data=data)))
        page.route('**/api/**', api); page.route('**/auth/me', api); page.route('**/socket.io/**', lambda r: r.abort())
        page.goto('http://127.0.0.1:5188/settings?tab=extensions&section=skills', wait_until='domcontentloaded')
        page.locator('[data-ui=card]').filter(has=page.get_by_role('button', name='Edit Fixture', exact=True)).hover()
        page.get_by_role('button', name='Edit Fixture', exact=True).click()
        page.get_by_role('button', name='Dateien und Versionen', exact=True).click()
        dialog = page.get_by_role('dialog', name='Skilldateien')
        expect(dialog.get_by_role('textbox', name='Dateiinhalt', exact=True)).to_have_value('# Original')
        dialog.get_by_role('textbox', name='Dateiinhalt', exact=True).fill('# Aktualisiert')
        dialog.get_by_role('button', name='Datei speichern', exact=True).click()
        expect(dialog.get_by_role('button', name='Datei speichern', exact=True)).to_be_disabled()
        dialog.get_by_role('combobox', name='Dateiversion vergleichen', exact=True).select_option('a'*64)
        expect(dialog.get_by_text('# Original', exact=True)).to_be_visible()
        expect(dialog.locator('pre').filter(has_text='# Aktualisiert')).to_be_visible()
        dialog.get_by_role('textbox', name='Neue Skilldatei', exact=True).fill('references/beispiel.md')
        dialog.get_by_role('button', name='Anlegen', exact=True).click()
        dialog.get_by_role('textbox', name='Dateiinhalt', exact=True).fill('Referenztext')
        dialog.get_by_role('button', name='Datei speichern', exact=True).click()
        expect(dialog.get_by_role('button', name='Datei speichern', exact=True)).to_be_disabled()
        dialog.get_by_role('combobox', name='Skilldatei', exact=True).select_option('SKILL.md')
        expect(dialog.get_by_role('textbox', name='Dateiinhalt', exact=True)).to_have_value('# Aktualisiert')
        page.screenshot(path=f'.screenshots/skill-files-{width}.png')
        assert not page.evaluate('document.documentElement.scrollWidth > innerWidth')
        assert not errors, errors
        assert state['files']['references/beispiel.md']['content'] == 'Referenztext'
        print(f'PASS {width}px: existing skill editor, file save, before/after and nested file; fake API')
        page.close()
    browser.close()
