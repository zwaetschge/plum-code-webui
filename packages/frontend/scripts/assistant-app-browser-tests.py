import os, json, re, signal, subprocess, tempfile, time
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright, expect

url = os.environ.get('PLUM_FIXTURE_URL', 'http://127.0.0.1:5188')
assert url.startswith(('http://127.0.0.1:', 'http://localhost:'))
root = Path(__file__).resolve().parents[3]
# Product CSP. Only Vite's development preamble is externalised for the fixture.
parent_csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https:; connect-src 'self' ws: wss:; font-src 'self' data: https://fonts.gstatic.com; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
with tempfile.TemporaryDirectory(prefix='plum-app-test-') as directory:
    record = Path(directory) / 'fixture.json'
    with (Path(directory) / 'server.log').open('w+') as log:
        env = {**os.environ, 'PLUM_APP_FIXTURE_RECORD': str(record)}
        server = subprocess.Popen(['node_modules/.bin/tsx', '--conditions=development', 'scripts/assistant-app-fixture.ts'], cwd=root/'packages/backend', env=env, stdout=log, stderr=log, start_new_session=True)
        try:
            for _ in range(1800):
                if record.exists(): break
                if server.poll() is not None:
                    log.seek(0); raise AssertionError(log.read())
                time.sleep(.1)
            if not record.exists():
                log.seek(0); raise AssertionError('isolated fixture did not start: ' + log.read())
            fixture = json.loads(record.read_text())
            with sync_playwright() as p:
                browser = p.chromium.launch(executable_path='/usr/local/bin/plum-chromium', headless=True)
                page = browser.new_page(viewport={'width':390,'height':844})
                writes = []; task_writes=[]
                def api(route):
                    request = route.request
                    if request.method == 'PATCH': writes.append(json.loads(request.post_data))
                    parsed=urlsplit(request.url)
                    response = route.fetch(url=fixture['origin'] + parsed.path + ('?' + parsed.query if parsed.query else ''), headers={**request.headers, 'Authorization':'Bearer '+fixture['token']})
                    assert response.status < 400, (request.method, parsed.path, response.status, response.text())
                    if request.method=='POST' and parsed.path.endswith('/app-task'):
                        task_writes.append(json.loads(request.post_data))
                        if len(task_writes)==1:route.abort();return
                    route.fulfill(response=response)
                page.route('**/api/assistant/**', api)
                preludes = {}
                page.route('**/fixture-preamble-*.js', lambda route: route.fulfill(content_type='application/javascript', body=preludes[urlsplit(route.request.url).path]))
                def document(route):
                    response = route.fetch()
                    def external(match):
                        path = '/fixture-preamble-' + str(len(preludes)) + '.js'
                        preludes[path] = match.group(2)
                        return '<script type="module" src="' + path + '"></script>'
                    html = re.sub(r'<script([^>]*?)>(.*?)</script>', lambda m: m.group(0) if 'src=' in m.group(1) else external(m), response.text(), flags=re.S)
                    route.fulfill(response=response, body=html, headers={**response.headers, 'content-security-policy':parent_csp})
                page.route('**/scripts/fixtures/assistant-app.html*', document)
                page.goto(url + '/scripts/fixtures/assistant-app.html?artifact='+fixture['artifact'])
                frame = page.frame_locator('iframe')
                expect(frame.locator('#value')).to_have_value('0')
                assert frame.locator('body').evaluate('()=>typeof window.Plum') == 'undefined'
                assert not writes
                page.get_by_role('button',name='Speichern persönlicher Eingaben aktivieren').click()
                frame.locator('#load').click(); expect(frame.locator('#result')).to_have_text('geladen')
                frame.locator('#value').fill('7'); frame.locator('#save').click(); expect(frame.locator('#result')).to_have_text('gespeichert')
                assert writes[-1]['state'] == {'count':7}
                page.evaluate("()=>window.postMessage({action:'save',id:22,state:{count:999}},'*')")
                page.wait_for_timeout(100); assert len(writes) == 1
                page.get_by_role('button',name='Revision wechseln').click()
                expect(page.get_by_role('button',name='Speichern persönlicher Eingaben aktivieren')).to_be_enabled()
                expect(frame.locator('#value')).to_have_value('0')
                assert frame.locator('body').evaluate('()=>typeof window.Plum') == 'undefined'
                page.get_by_role('button',name='Revision wechseln').click()
                expect(frame.locator('#value')).to_have_value('0')
                page.reload(); page.get_by_role('button',name='Speichern persönlicher Eingaben aktivieren').click()
                frame.locator('#load').click(); expect(frame.locator('#value')).to_have_value('7')
                assert frame.locator('body').evaluate('()=>{try{parent.document.body;return false;}catch{return true;}}')
                page.get_by_role('button',name='Gespeicherte Eingaben löschen').click()
                expect(page.get_by_role('button',name='Speichern persönlicher Eingaben aktivieren')).to_be_enabled()
                expect(frame.locator('#value')).to_have_value('0')
                page.get_by_role('button',name='Task-Vorschläge dieser App aktivieren',exact=True).click()
                frame.locator('#propose').click();expect(frame.locator('#result')).to_have_text('review')
                expect(page.get_by_label('Vorgeschlagenes Taskziel',exact=True)).to_have_value('Erstelle einen Bericht zum ausgewählten App-Kontext.')
                assert not task_writes
                page.get_by_label('Vorgeschlagenes Taskziel',exact=True).fill('Erstelle meinen ausdrücklich geprüften Bericht.')
                page.get_by_role('button',name='Geprüften Vorschlag als Task übernehmen',exact=True).click();expect(page.get_by_role('alert')).to_contain_text('fetch')
                expect(page.get_by_label('Vorgeschlagenes Taskziel',exact=True)).to_be_disabled()
                page.get_by_role('button',name='Denselben App-Task bestätigen',exact=True).click();expect(page.get_by_role('link',name='Bericht vorbereiten',exact=True)).to_be_visible()
                assert task_writes[0]==task_writes[1] and task_writes[0]['revision']==1 and task_writes[0]['goal']=='Erstelle meinen ausdrücklich geprüften Bericht.'
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
                page.screenshot(path=str(root/'.probe/plum-assistant/app-task-mobile.png'),full_page=True)
                page.set_viewport_size({'width':1440,'height':1000});page.screenshot(path=str(root/'.probe/plum-assistant/app-task-desktop.png'),full_page=True)
                page.get_by_role('button',name='Revision wechseln').click();expect(page.get_by_role('button',name='Task-Vorschläge dieser App aktivieren',exact=True)).to_be_visible()
                expect(page.locator('iframe')).to_have_count(1)
                expect(frame.locator('#result')).to_have_text('')
                assert frame.locator('body').evaluate('()=>typeof window.Plum')=='undefined'
                browser.close()
                print('PASS: genuine HTTP app sandbox under production parent CSP; ownership/UUID SQL races, one-use tickets, revision grants, personal-state deletion, explicit widget proposal and reviewed Task draft with durable lost-ack receipt, mobile/desktop; no general tools or worker calls')
        finally:
            if server.poll() is None:
                os.killpg(server.pid, signal.SIGTERM)
                try: server.wait(timeout=20)
                except subprocess.TimeoutExpired: os.killpg(server.pid,signal.SIGKILL);server.wait()
