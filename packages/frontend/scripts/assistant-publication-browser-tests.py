import os,json,signal,subprocess,tempfile,time
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright,expect
url=os.environ.get('PLUM_FIXTURE_URL','http://127.0.0.1:5188');assert url.startswith(('http://127.0.0.1:','http://localhost:'));root=Path(__file__).resolve().parents[3]
with tempfile.TemporaryDirectory(prefix='plum-publication-fixture-') as directory:
    record=Path(directory)/'fixture.json'
    with (Path(directory)/'server.log').open('w+') as log:
        server=subprocess.Popen(['node_modules/.bin/tsx','--conditions=development','scripts/assistant-publication-regression-tests.ts'],cwd=root/'packages/backend',env={**os.environ,'PLUM_PUBLICATION_FIXTURE_RECORD':str(record)},stdout=log,stderr=log,start_new_session=True)
        try:
            for _ in range(1800):
                if record.exists():break
                if server.poll() is not None:log.seek(0);raise AssertionError(log.read())
                time.sleep(.1)
            assert record.exists(),'isolated publication fixture did not start'
            fixture=json.loads(record.read_text())
            with sync_playwright() as p:
                browser=p.chromium.launch(executable_path='/usr/local/bin/plum-chromium',headless=True);page=browser.new_page(viewport={'width':390,'height':900});packets=[];lost=True
                def api(route):
                    global lost
                    req=route.request;parsed=urlsplit(req.url)
                    response=route.fetch(url=fixture['origin']+parsed.path+('?' + parsed.query if parsed.query else ''),headers={**req.headers,'Authorization':'Bearer '+fixture['token']})
                    assert response.status<400,(parsed.path,response.status,response.text())
                    if req.method=='POST':
                        packets.append(req.post_data_json)
                        if lost:lost=False;route.abort();return
                    route.fulfill(response=response)
                page.route('**/api/assistant/**',api);page.goto(url+'/scripts/fixtures/assistant-publication.html?artifact='+fixture['artifact']['id'])
                page.get_by_text('Öffentliche Version veröffentlichen',exact=True).click();expect(page.get_by_label('Öffentlicher Link gültig für',exact=True)).to_be_enabled();expect(page.get_by_role('button',name='Diese Version öffentlich veröffentlichen',exact=True)).to_be_disabled();assert not packets
                page.get_by_role('checkbox',name='Diese Version darf öffentlich gelesen werden',exact=True).check();page.get_by_role('button',name='Diese Version öffentlich veröffentlichen',exact=True).click();expect(page.get_by_role('alert')).to_be_visible();expect(page.get_by_role('checkbox',name='Diese Version darf öffentlich gelesen werden',exact=True)).to_be_disabled()
                page.get_by_role('button',name='Dieselbe Veröffentlichung bestätigen',exact=True).click();field=page.get_by_label('Öffentlicher Versionslink 1',exact=True);expect(field).to_be_visible();assert packets[0]==packets[1]
                assert field.input_value().startswith(fixture['origin']+'/published/'),'uses configured canonical origin rather than owner fixture origin'
                path=urlsplit(field.input_value()).path;public=browser.new_page(viewport={'width':390,'height':900});requests=[];public.on('request',lambda req:requests.append(req.url));public.goto(fixture['origin']+path)
                frame=public.frame_locator('iframe');expect(frame.locator('#scope')).to_have_text('undefined opaque');expect(frame.locator('#value')).to_have_text('0');frame.get_by_role('button',name='Weiter',exact=True).click();expect(frame.locator('#value')).to_have_text('1')
                assert frame.locator('#original').evaluate('(img)=>img.complete&&img.naturalWidth===1');assert public.evaluate('document.body.dataset.escaped===undefined');assert all(req.startswith(fixture['origin']+'/published/') for req in requests),requests
                assert public.evaluate('document.documentElement.scrollWidth<=innerWidth');public.screenshot(path='.probe/plum-assistant/publication-mobile.png',full_page=True);page.screenshot(path='.probe/plum-assistant/publication-owner-mobile.png',full_page=True)
                public.set_viewport_size({'width':1440,'height':1000});public.screenshot(path='.probe/plum-assistant/publication-desktop.png',full_page=True)
                page.get_by_role('button',name='Öffentliche Version widerrufen',exact=True).click();expect(field).to_have_count(0);response=public.goto(fixture['origin']+path);assert response.status==404;browser.close()
            print('PASS: actual acknowledged owner publish and lost HTTP response/same UUID, anonymous opaque interactive iframe and exact embedded image, blocked external network/parent access/no Plum bridge, mobile/desktop and real revoke; no public live route enabled')
        finally:
            if server.poll() is None:os.killpg(server.pid,signal.SIGTERM);server.wait(timeout=30)
