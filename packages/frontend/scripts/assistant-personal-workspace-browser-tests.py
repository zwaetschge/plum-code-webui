import os,json
from playwright.sync_api import sync_playwright,expect
url=os.environ.get('PLUM_FIXTURE_URL','http://127.0.0.1:5188');assert url.startswith(('http://127.0.0.1:','http://localhost:'))
packets=[];lost=True
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/local/bin/plum-chromium',headless=True);page=browser.new_page(viewport={'width':390,'height':900});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    def api(route):
        global lost
        req=route.request;assert req.url.endswith('/personal-workspaces') and req.method=='POST' and req.headers.get('authorization')=='Bearer personal-workspace-fixture-token'
        packet=req.post_data_json;packets.append(packet)
        if lost:lost=False;route.abort();return
        route.fulfill(content_type='application/json',body=json.dumps({'data':{'project':{'id':'own-finance','title':packet['title']},'profile':{'id':'own-profile'}}}))
    page.route('**/api/**',api);page.goto(url+'/scripts/fixtures/assistant-personal-workspace.html')
    page.get_by_text('Gesundheits- und Finanzunterlagen ordnen',exact=True).click();assert not packets
    page.get_by_label('Dokumentbereich',exact=True).select_option('finance');expect(page.get_by_label('Name des Wissensbereichs',exact=True)).to_have_value('Finanzunterlagen')
    page.get_by_label('Name des Wissensbereichs',exact=True).fill('Meine Abrechnungen');page.get_by_role('button',name='Bereich und Profil erstellen',exact=True).click()
    expect(page.get_by_role('alert')).to_be_visible();expect(page.get_by_label('Dokumentbereich',exact=True)).to_be_disabled()
    page.get_by_role('button',name='Dieselbe Erstellung bestätigen',exact=True).click();expect(page.get_by_role('link',name='Unterlagen für diesen Bereich importieren',exact=True)).to_have_attribute('href','/assistant/sources?project=own-finance')
    expect(page.get_by_role('link',name='Dokumentprofil ansehen',exact=True)).to_have_attribute('href','/assistant/profiles?resource=own-profile')
    assert packets[0]==packets[1] and packets[0]['preset']=='finance' and packets[0]['title']=='Meine Abrechnungen';assert len(packets)==2
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');page.screenshot(path='.probe/plum-assistant/personal-workspace-mobile.png',full_page=True)
    page.set_viewport_size({'width':1440,'height':1000});page.screenshot(path='.probe/plum-assistant/personal-workspace-desktop.png',full_page=True)
    assert not errors,errors;browser.close();print('PASS: actual explicit personal document preset/name, no auto-create, retained UUID/payload and locked controls after lost reply, own project import/profile links, StrictMode and mobile/desktop')
