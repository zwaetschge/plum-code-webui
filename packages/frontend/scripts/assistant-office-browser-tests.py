"""Actual Office taskpane and portal source with explicit SDK host fixture; no Word host/M365 login/provider is invoked."""
import os,json,hashlib,base64,uuid
from playwright.sync_api import sync_playwright,expect
url=os.environ.get('PLUM_FIXTURE_URL','http://127.0.0.1:5188');assert url.startswith(('http://127.0.0.1:','http://localhost:'))
sdk='''
window.__range={text:'Originale Äpfel',tracked:false,load(){return this},track(){this.tracked=true},untrack(){this.tracked=false},insertText(text,where){window.__writes.push({text,where,original:this.text});this.text=text;}};
window.__other={text:'Andere Word-Stelle'};window.__current=window.__range;window.__writes=[];window.__dialogMessages=[];window.__dialogChallenge='';
window.Word={InsertLocation:{replace:'Replace'},run:async(a,b)=>{const fn=b||a;return fn({document:{getSelection:()=>window.__current},sync:async()=>{}})}};
window.Office={HostType:{Word:'Word'},AsyncResultStatus:{Succeeded:'success'},EventType:{DialogMessageReceived:'message',DialogEventReceived:'event'},onReady:(fn)=>fn?fn({host:'Word'}):Promise.resolve({host:'Word'}),context:{requirements:{isSetSupported:()=>true},ui:{messageParent:(message,options)=>window.__dialogMessages.push({message:JSON.parse(message),options}),displayDialogAsync:(address,options,callback)=>{window.__dialogChallenge=new URL(address).searchParams.get('challenge');window.__dialogUrl=address;window.__dialogHandlers={};callback({status:'success',value:{close(){window.__dialogClosed=true},addEventHandler:(name,handler)=>{window.__dialogHandlers[name]=handler}}});}}}};
window.__ticket=(origin=location.origin,challenge=window.__dialogChallenge)=>window.__dialogHandlers.message({origin,message:JSON.stringify({type:'plum-office-ticket',challenge,ticket:'t'.repeat(43)})});
'''
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/local/bin/plum-chromium',headless=True)
    page=browser.new_page(viewport={'width':330,'height':1000})
    page.route('https://appsforoffice.microsoft.com/**',lambda r:r.fulfill(status=200,content_type='text/javascript',body=sdk))
    requests=[];turn_bodies=[];chat_bodies=[];task_bodies=[];fail_chat=True;fail_turn=True;fail_task=True
    chat={'id':'office-chat-fixture','revision':1};turn={'id':str(uuid.uuid4()),'response':'Überarbeitete Äpfel','status':'completed'}
    def api(route):
        global fail_chat,fail_turn,fail_task
        req=route.request;path=req.url.split('/api/office',1)[1];body=req.post_data_json if req.method=='POST' else None
        requests.append({'path':path,'body':body,'headers':req.headers})
        if path=='/redeem':
            assert 'authorization' not in req.headers
            actual=base64.urlsafe_b64encode(hashlib.sha256(body['verifier'].encode()).digest()).decode().rstrip('=')
            assert actual==page.evaluate('window.__dialogChallenge')
            data={'token':'plum_office_'+'a'*43,'account':'office-alice@fixture.invalid'}
        else:
            assert req.headers.get('authorization')=='Bearer plum_office_'+'a'*43
            assert 'cookie' not in req.headers
            if path=='/providers':data=[{'id':'openai','name':'Fixture','models':['gpt-5.5']}]
            elif path=='/chats':
                chat_bodies.append(body)
                if fail_chat:fail_chat=False;route.abort();return
                data=chat
            elif path.endswith('/turns'):
                turn_bodies.append(body)
                if fail_turn:fail_turn=False;route.abort();return
                data=turn
            elif path.endswith('/stop'):data=turn
            elif path=='/tasks':
                task_bodies.append(body)
                if fail_task:fail_task=False;route.abort();return
                data={'id':'office-task-fixture','body':{'status':'draft'}}
            elif path=='/disconnect':data=None
            else:data={'turns':[turn]}
        route.fulfill(status=200,content_type='application/json',body=json.dumps({'success':True,'data':data}))
    page.route('**/api/office/**',api);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(url+'/office/taskpane.html');expect(page.get_by_role('button',name='Mit Plum verbinden',exact=True)).to_be_enabled()
    page.get_by_role('button',name='Mit Plum verbinden',exact=True).click();page.wait_for_function('!!window.__dialogHandlers?.message')
    page.evaluate("window.__ticket('https://foreign.fixture.invalid')");page.evaluate("window.__ticket(location.origin,'wrong')")
    assert not requests,'Foreign origin/challenge must not redeem'
    page.evaluate('window.__ticket()');expect(page.get_by_role('status').first).to_contain_text('office-alice')
    assert 'ordinary-office-fixture-jwt' not in page.evaluate('window.__dialogUrl')
    page.get_by_role('button',name='Aktuelle Word-Auswahl übernehmen',exact=True).click()
    expect(page.get_by_label('Ausgewählte Originalstelle',exact=True)).to_have_value('Originale Äpfel')
    page.get_by_label('Änderungswunsch',exact=True).fill('Kürzen')
    page.get_by_role('button',name='Änderung vorschlagen lassen',exact=True).click();expect(page.get_by_role('alert')).to_contain_text('fetch')
    expect(page.get_by_role('button',name='Aktuelle Word-Auswahl übernehmen',exact=True)).to_be_disabled()
    page.get_by_role('button',name='Zustellung erneut bestätigen',exact=True).click()
    expect(page.get_by_role('alert')).to_contain_text('fetch');assert len(chat_bodies)==2 and chat_bodies[0]==chat_bodies[1]
    page.get_by_role('button',name='Zustellung erneut bestätigen',exact=True).click()
    expect(page.get_by_label('Geprüfter Ersetzungstext',exact=True)).to_have_value('Überarbeitete Äpfel')
    assert len(turn_bodies)==2 and turn_bodies[0]==turn_bodies[1]
    assert not page.evaluate('window.__writes.length'),'No automatic replacement'
    # Moving the cursor cannot redirect the accepted replacement to another range.
    page.evaluate('window.__current=window.__other');page.get_by_role('button',name='Ersetzung in ursprünglicher Stelle übernehmen',exact=True).click()
    expect(page.get_by_role('status').last).to_contain_text('übernommen')
    assert page.evaluate('window.__writes[0]')=={'text':'Überarbeitete Äpfel','where':'Replace','original':'Originale Äpfel'}
    assert page.evaluate('window.__other.text')=='Andere Word-Stelle'
    # A modified original must be explicitly recaptured before any replacement.
    page.evaluate("window.__current=window.__range;window.__range.text='Stabiler Text'")
    page.get_by_role('button',name='Aktuelle Word-Auswahl übernehmen',exact=True).click()
    page.get_by_label('Geprüfter Ersetzungstext',exact=True).fill('Manueller Vorschlag')
    page.evaluate("window.__range.text='In Word geändert'");page.get_by_role('button',name='Ersetzung in ursprünglicher Stelle übernehmen',exact=True).click()
    expect(page.get_by_role('alert')).to_contain_text('wurde geändert');assert page.evaluate('window.__writes.length')==1
    page.get_by_role('button',name='Aktuelle Word-Auswahl übernehmen',exact=True).click()
    page.get_by_role('button',name='Als Plum-Task-Entwurf übernehmen',exact=True).click()
    expect(page.get_by_role('alert')).to_contain_text('fetch')
    page.get_by_label('Änderungswunsch',exact=True).fill('Späterer Wunsch ist nicht die erste Zustellung')
    page.get_by_role('button',name='Zustellung erneut bestätigen',exact=True).click()
    expect(page.get_by_role('link',name='Task in Plum öffnen',exact=True)).to_have_attribute('href','/tasks?resource=office-task-fixture')
    assert len(task_bodies)==2 and task_bodies[0]==task_bodies[1]
    assert task_bodies[0]['original']=='In Word geändert' and task_bodies[0]['instruction']=='Kürzen'
    page.screenshot(path='.probe/plum-assistant/office-taskpane-mobile.png',full_page=True)
    assert page.evaluate('Array.from(document.querySelectorAll("button,input,textarea,select")).every(e=>e.getBoundingClientRect().right<=innerWidth+1)')
    page.set_viewport_size({'width':900,'height':1100});page.screenshot(path='.probe/plum-assistant/office-taskpane-desktop.png',full_page=True)
    page.get_by_role('button',name='Verbindung beenden',exact=True).click();expect(page.get_by_role('status').first).to_have_text('Verbindung beendet')
    assert page.evaluate('window.__range.tracked')==False
    # Errors after capture's deliberate local reset must remain visible.
    page.get_by_role('button',name='Mit Plum verbinden',exact=True).click();page.wait_for_function('!!window.__dialogHandlers?.message && !document.getElementById("connect").disabled===false')
    page.evaluate('window.__ticket()');expect(page.get_by_role('status').first).to_contain_text('office-alice')
    page.evaluate("window.__current.text=''");page.get_by_role('button',name='Aktuelle Word-Auswahl übernehmen',exact=True).click()
    expect(page.get_by_role('alert')).to_contain_text('1 bis 12 000')
    assert not errors,errors
    # Actual portal page sends a bounded ticket only via the SDK and exact target origin.
    portal=browser.new_page(viewport={'width':390,'height':844});messages=[]
    portal.route('https://appsforoffice.microsoft.com/**',lambda r:r.fulfill(status=200,content_type='text/javascript',body=sdk))
    def ticket_route(route):
        assert route.request.headers.get('authorization')=='Bearer ordinary-office-fixture-jwt'
        body=route.request.post_data_json;assert body=={'challenge':'c'*43,'origin':url}
        messages.append(body);route.fulfill(status=200,content_type='application/json',body=json.dumps({'data':{'ticket':'t'*43,'expiresIn':120}}))
    portal.route('**/api/assistant/office-tickets',ticket_route)
    portal.goto(url+'/scripts/fixtures/assistant-office-connect.html?challenge='+'c'*43)
    portal.get_by_role('button',name='Dieses Konto für Office verbinden',exact=True).click()
    portal.wait_for_function('window.__dialogMessages.length===1')
    sent=portal.evaluate('window.__dialogMessages[0]');assert sent=={'message':{'type':'plum-office-ticket','challenge':'c'*43,'ticket':'t'*43},'options':{'targetOrigin':url}}
    assert 'jwt' not in json.dumps(sent)
    portal.screenshot(path='.probe/plum-assistant/office-connect-mobile.png',full_page=True)
    browser.close()
    print('PASS: actual Word taskpane and portal, origin+PKCE bridge, frozen same-UUID chat/turn/task retries, explicit tracked-range replacement/cursor binding and changed-text refusal, draft-only transfer, cleanup and visible errors, 330px/desktop; native Word host remains unverified')
