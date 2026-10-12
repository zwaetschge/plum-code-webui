import json,os
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright,expect
url=os.environ.get('PLUM_FIXTURE_URL','http://127.0.0.1:5188');assert url.startswith(('http://127.0.0.1:','http://localhost:'))
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/local/bin/plum-chromium',headless=True);page=browser.new_page(viewport={'width':390,'height':844});errors=[];requests=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    chat={'id':'mini-chat','kind':'api-chat','title':'Eine schnelle Frage','revision':1,'createdAt':'','updatedAt':'','body':{'providerId':'fixture-api','model':'fixture-model','sourceIds':[]}}
    turn={'id':'mini-turn','seq':1,'prompt':'Eine schnelle Frage','response':'Eine bestätigte Antwort','status':'completed','error':None,'model':'fixture-model','createdAt':'2026-10-10T10:00:00Z','sourceVersions':[],'usage':None}
    def api(route):
        path=urlsplit(route.request.url).path;data=[]
        if path.endswith('/api-chat-providers'):data=[{'id':'fixture-api','name':'Eigene API','protocol':'openai','models':['fixture-model']}]
        elif path.endswith(('/profiles','/sources')):data=[]
        elif route.request.method=='POST':
            payload=json.loads(route.request.post_data);requests.append((path,payload));data=turn if path.endswith('/turns') else chat
        elif path.endswith('/turns'):data={'chat':chat,'turns':[turn],'active':False}
        else:raise AssertionError(path)
        route.fulfill(content_type='application/json',body=json.dumps({'data':data}))
    page.route('**/api/**',api);page.goto(url+'/scripts/fixtures/assistant-mini.html')
    expect(page.get_by_role('link',name='Plum Mini',exact=True)).to_be_visible();expect(page.get_by_text('Eigene API · fixture-model · eigene API-Verbindung',exact=True)).to_be_visible()
    assert page.get_by_label('API-Verbindung',exact=True).count()==0
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.screenshot(path='.probe/plum-assistant/mini-mobile.png',full_page=True)
    page.set_viewport_size({'width':460,'height':720});page.screenshot(path='.probe/plum-assistant/mini-desktop.png',full_page=True)
    page.get_by_role('button',name='Modell, Profil und Dokumentquellen',exact=True).click();expect(page.get_by_role('combobox',name='API-Verbindung',exact=True)).to_be_visible()
    page.get_by_role('button',name='Modell, Profil und Dokumentquellen',exact=True).click()
    page.get_by_label('Deine Nachricht',exact=True).fill('Eine schnelle Frage');page.get_by_role('button',name='Modellgespräch starten',exact=True).click()
    expect(page.get_by_role('heading',name='Eine schnelle Frage',exact=True)).to_be_visible();expect(page.get_by_text('Eine bestätigte Antwort',exact=True)).to_be_visible()
    expect(page.get_by_role('link',name='Plum Chat',exact=True)).to_have_attribute('href','/mini')
    assert len(requests)==2 and all(payload.get('commandId') for _,payload in requests)
    assert requests[0][1]['providerId']=='fixture-api' and requests[1][1]['prompt']=='Eine schnelle Frage'
    assert not errors,errors
    print('PASS: compact authenticated shell and visible API/model, explicit personalization options, durable create/send into mini conversation, result/back navigation and 390/460px actual views')
    browser.close()
