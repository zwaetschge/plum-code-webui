import os,json
from playwright.sync_api import sync_playwright,expect
url=os.environ.get('PLUM_FIXTURE_URL','http://127.0.0.1:5188');assert url.startswith(('http://127.0.0.1:','http://localhost:'))
state={'nativeUserId':'@alice:fixture.invalid','epoch':'existing-epoch','hash':'a'*64,'settings':{'v':1,'zeit':100,'pdfSeiten':False,'vorlagen':[{'id':'existing','titel':'Bericht','agent':'brian','ziel':'Bericht über {Thema}','budgetUsd':0.5,'budgetMin':20,'frist':'2h','favorit':False}]}};packets=[];lost=True
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/local/bin/plum-chromium',headless=True);page=browser.new_page(viewport={'width':390,'height':900});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    def api(route):
        global state,lost
        req=route.request;assert req.url.endswith('/matrix/preferences') and req.headers.get('authorization')=='Bearer native-preferences-fixture-token'
        if req.method=='GET':route.fulfill(content_type='application/json',body=json.dumps({'data':state}));return
        assert req.method=='POST';packet=req.post_data_json;packets.append(packet);assert packet['nativeUserId']==state['nativeUserId'] and packet['epoch']==state['epoch']
        state={**state,'hash':'b'*64,'settings':{**state['settings'],**packet['changes'],'zeit':packet['zeit']}}
        if lost:lost=False;route.abort();return
        route.fulfill(content_type='application/json',body=json.dumps({'data':state}))
    page.route('**/api/**',api);page.goto(url+'/scripts/fixtures/assistant-native-preferences.html')
    page.get_by_text('Schwarm-Vorlagen und Kontoeinstellungen',exact=True).click();expect(page.get_by_label('Vorlagentitel existing',exact=True)).to_have_value('Bericht')
    page.get_by_label('PDF-Seiten für Brian aufbereiten',exact=True).check();page.get_by_label('Favorit existing',exact=True).check()
    page.get_by_role('button',name='Platzhalter ausfüllen',exact=True).click();expect(page.get_by_role('button',name='Im Nachrichtenfeld vorbereiten',exact=True)).to_be_disabled()
    page.get_by_label('Platzhalter Thema',exact=True).fill('mein NAS');page.get_by_role('button',name='Im Nachrichtenfeld vorbereiten',exact=True).click()
    expect(page.get_by_label('Vorbereitete Nachricht',exact=True)).to_have_value('!auftrag @brian Bericht über mein NAS\nBudget: 0.5 USD / 20 min · Frist: 2h');assert not packets
    page.get_by_role('button',name='Native Einstellungen speichern',exact=True).click();expect(page.get_by_role('alert')).to_contain_text('fetch');expect(page.get_by_label('Vorlagentitel existing',exact=True)).to_be_disabled()
    page.get_by_role('button',name='Dieselbe Speicherung bestätigen',exact=True).click();expect(page.get_by_label('Vorlagentitel existing',exact=True)).to_be_enabled();assert packets[0]==packets[1] and packets[0]['changes']['pdfSeiten'] and packets[0]['changes']['vorlagen'][0]['favorit']
    page.screenshot(path='.probe/plum-assistant/native-preferences-mobile.png',full_page=True);assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.set_viewport_size({'width':1440,'height':1000});page.screenshot(path='.probe/plum-assistant/native-preferences-desktop.png',full_page=True)
    page.get_by_label('Vorlagentitel existing',exact=True).fill('Lokaler anderer Titel');page.get_by_role('button',name='Aktuellen Stand laden und lokalen Entwurf verwerfen',exact=True).click();expect(page.get_by_label('Vorlagentitel existing',exact=True)).to_have_value('Bericht')
    assert not errors,errors;browser.close();print('PASS: actual native preferences controls, favorite and PDF option, required placeholders and exact native budget/deadline command with no send, same-UUID/epoch/timestamp lost-ack retry, explicit reload and StrictMode/mobile/desktop; no live settings changed')
