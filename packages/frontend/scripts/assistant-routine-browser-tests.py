import json,os
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright,expect
url=os.environ.get('PLUM_FIXTURE_URL','http://127.0.0.1:5188');assert url.startswith(('http://127.0.0.1:','http://localhost:'))
name='plum-00000000000040008000000000000001';goal='Zeige meine fälligen Aufgaben, bestätigte Quellen und drei nächste Schritte.'
requests=[];errors=[];native=None;spoof=True;lost=True;held=[];hold=False
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/local/bin/plum-chromium',headless=True);page=browser.new_page(viewport={'width':390,'height':844})
    page.on('pageerror',lambda error:errors.append(str(error)))
    def api(route):
        global native,lost
        path=urlsplit(route.request.url).path
        if path.endswith('/status'):data={'connected':True,'userId':'@vale:fixture.invalid','epoch':'routine-fixture'}
        elif path.endswith('/rooms'):
            item={'name':name,'zeitplan':'werktags 07:00','agent':'brian','ziel':goal,'pausiert':False,'naechster':'2026-10-12T05:00:00Z'}
            state=[]
            if spoof:state.append({'type':'ch.zwaetschge.swarm.routinen','sender':'@spoof:fixture.invalid','content':{'v':1,'routinen':[item]}})
            if native:state.append({'type':'ch.zwaetschge.swarm.routinen','sender':'@schwarm:fixture.invalid','content':{'v':1,'routinen':[native]}})
            data=[{'id':'!lobby:fixture.invalid','alias':'#schwarm-lobby:fixture.invalid','agents':[{'id':'matrix:brian','nativeId':'brian','name':'Brian','mode':'native','schemaVersion':1,'retired':False}],'state':state}]
        elif path.endswith('/events'):
            payload=route.request.post_data_json;requests.append(payload);body=payload['content']['body']
            assert payload['nativeUserId']=='@vale:fixture.invalid'
            if body.startswith('!routine neu '):native={'name':name,'zeitplan':'werktags 07:00','agent':'brian','ziel':goal,'pausiert':False,'naechster':'2026-10-12T05:00:00Z'}
            elif body=='!routine pause '+name:native['pausiert']=True
            elif body=='!routine weiter '+name:native['pausiert']=False
            elif body!='!routine jetzt '+name:raise AssertionError(body)
            if hold:held.append(route);return
            if lost:lost=False;route.abort('failed');return
            data={'event_id':'$routine-confirmed'}
        else:raise AssertionError(path)
        route.fulfill(content_type='application/json',body=json.dumps({'data':data}))
    page.route('**/api/**',api);page.goto(url+'/scripts/fixtures/assistant-routine.html')
    expect(page.get_by_role('button',name='Im Schwarm aktivieren',exact=True)).to_be_enabled()
    expect(page.get_by_text('Vom Hub bestätigt: aktiv',exact=True)).to_have_count(0)
    assert not requests
    page.get_by_role('button',name='Im Schwarm aktivieren',exact=True).click();expect(page.get_by_role('alert')).to_be_visible()
    page.get_by_role('button',name='Im Schwarm aktivieren',exact=True).click();expect(page.get_by_text('Vom Hub bestätigt: aktiv',exact=True)).to_be_visible()
    assert requests[0]==requests[1] and requests[0]['content']['body']==f'!routine neu {name} werktags 07:00 @brian {goal}'
    page.get_by_role('button',name='Pausieren',exact=True).click();expect(page.get_by_text('Vom Hub bestätigt: pausiert',exact=True)).to_be_visible()
    page.get_by_role('button',name='Fortsetzen',exact=True).click();expect(page.get_by_text('Vom Hub bestätigt: aktiv',exact=True)).to_be_visible()
    page.get_by_role('button',name='Jetzt einmal ausführen',exact=True).click()
    expect(page.get_by_role('status')).to_contain_text('Erst ein neuer Hub-Stand')
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');page.screenshot(path='.probe/plum-assistant/routine-mobile.png',full_page=True)
    page.set_viewport_size({'width':1440,'height':900});page.screenshot(path='.probe/plum-assistant/routine-desktop.png',full_page=True)
    # A template in UTC cannot silently change the fixed native Zurich schedule.
    native=None;page.reload();page.get_by_role('button',name='Zeitzone ändern',exact=True).click();expect(page.get_by_role('button',name='Im Schwarm aktivieren',exact=True)).to_be_disabled()
    page.reload();hold=True;page.get_by_role('button',name='Im Schwarm aktivieren',exact=True).click();page.get_by_role('button',name='Konto wechseln',exact=True).click()
    for route in held:route.fulfill(content_type='application/json',body=json.dumps({'data':{'event_id':'$late'}}))
    page.wait_for_timeout(100);expect(page.get_by_text('Befehl zugestellt. Erst ein neuer Hub-Stand bestätigt die Änderung.',exact=True)).to_have_count(0)
    # Verify the real library route also binds a personal preset and only saves a template.
    hold=False;native=None;definitions=[]
    user={'id':'routine-alice','username':'Routine Alice','email':'alice@fixture.invalid','role':'admin'}
    page.evaluate('(value)=>localStorage.setItem("claude-webui-auth",JSON.stringify(value))',{'state':{'user':user,'token':'own-routine-fixture','isAuthenticated':True},'version':0})
    def app_api(route):
        path=urlsplit(route.request.url).path
        if path=='/auth/me':data=user
        elif path=='/api/basic-auth/status':data={'enabled':False}
        elif path=='/api/assistant/overview':data={'counts':{},'tasks':[],'recent':[],'agents':[{'id':'matrix:brian','nativeId':'brian','name':'Brian','mode':'native','schemaVersion':1,'retired':False}]}
        elif path=='/api/assistant/routines':
            if route.request.method=='POST':
                payload=route.request.post_data_json
                data={'id':'00000000-0000-4000-8000-000000000001','kind':'routine','title':payload['title'],'body':payload['body'],'revision':1,'createdAt':'2026-10-10T00:00:00Z','updatedAt':'2026-10-10T00:00:00Z'}
                definitions.append(data)
            else:data=definitions
        elif path.startswith('/api/assistant/matrix/'):return api(route)
        else:data=[]
        route.fulfill(content_type='application/json',body=json.dumps({'success':True,'data':data}))
    page.unroute('**/api/**',api);page.route('**/api/**',app_api);page.route('**/auth/me',app_api)
    before=len(requests);page.goto(url+'/assistant/routines')
    page.get_by_role('button',name='Neu',exact=True).click()
    page.get_by_label('Routinevorlage',exact=True).select_option('morning')
    expect(page.get_by_label('Name',exact=True)).to_have_value('Mein Morgenbriefing')
    expect(page.get_by_label('Zeitplan',exact=True)).to_have_value('werktags 07:00')
    expect(page.get_by_label('Zeitzone',exact=True)).to_have_value('Europe/Zurich')
    page.get_by_label('Agent',exact=True).select_option('matrix:brian')
    page.get_by_role('button',name='Speichern',exact=True).click()
    expect(page.get_by_role('button',name='Mein Morgenbriefing',exact=False)).to_be_visible()
    assert len(definitions)==1 and definitions[0]['body']['enabled']==False and definitions[0]['body']['agentId']=='matrix:brian'
    assert 'keine Termine oder Fakten erfinden' in definitions[0]['body']['goal'] and len(requests)==before
    page.get_by_role('button',name='Mein Morgenbriefing',exact=False).click()
    expect(page.get_by_role('button',name='Im Schwarm aktivieren',exact=True)).to_be_enabled()
    page.screenshot(path='.probe/plum-assistant/routine-library-desktop.png',full_page=True)
    assert not errors,errors
    print('PASS: genuine native routine commands, trusted Hub-only confirmation, lost-answer stable UUID, pause/resume/run, Zurich contract, account-switch fence and real narrow/desktop view; no native coordinator started')
    browser.close()
