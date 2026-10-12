import json,os,uuid
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright,expect
url=os.environ.get('PLUM_FIXTURE_URL','http://127.0.0.1:5188')
assert url.startswith(('http://127.0.0.1:','http://localhost:'))
user={'id':'transfer-fixture','email':'fixture@example.invalid','role':'admin'}
auth=json.dumps({'state':{'user':user,'token':'fixture-credential-must-not-export','isAuthenticated':True},'version':0})
command=str(uuid.uuid4())
entry={'id':command,'path':'/api/assistant/api-chats/chat-fixture/turns','payload':{'commandId':command,'expectedRevision':1,'prompt':'Vorbereitete persönliche Frage'},'label':'Modellfrage senden','createdAt':'2026-10-10T00:00:00Z'}
draftkey='plum.chat.draft.v1:'+json.dumps([user['id'],'session-fixture',None],separators=(',',':'))
mutations=[]
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/local/bin/plum-chromium',headless=True)
    def configure(context):
        context.add_init_script("localStorage.setItem('claude-webui-auth',"+json.dumps(auth)+")")
        def route(r):
            path=urlsplit(r.request.url).path
            if r.request.method!='GET':mutations.append(path)
            data={'instanceId':'fixture-instance','userId':user['id']} if path.endswith('/identity') else [{'id':'session-fixture'}] if path=='/api/sessions' else {}
            r.fulfill(content_type='application/json',body=json.dumps({'success':True,'data':data}))
        context.route('**/api/**',route);context.route('**/socket.io/**',lambda r:r.abort())
    old=browser.new_context();configure(old);page=old.new_page();page.goto(url+'/scripts/fixtures/assistant-portability.html')
    page.evaluate('(value)=>{localStorage.setItem(value.key,"Alter unsynchronisierter Entwurf");localStorage.setItem("theme","dark");localStorage.setItem("plum.assistant.outbox.v1:transfer-fixture",JSON.stringify([value.entry]));}',{'key':draftkey,'entry':entry})
    with page.expect_download() as download:
        page.get_by_role('button',name='Browserzustand exportieren',exact=True).click()
    data=json.loads(open(download.value.path()).read())
    assert data['version']==2 and data['assistantOutbox'][0]['payload']==entry['payload']
    assert data['drafts'][draftkey]=='Alter unsynchronisierter Entwurf'
    assert 'fixture-credential-must-not-export' not in json.dumps(data)
    assert 'claude-webui-auth' not in data['preferences']
    new=browser.new_context();configure(new);target=new.new_page();target.goto(url.replace('127.0.0.1','localhost')+'/scripts/fixtures/assistant-portability.html')
    def inspect(value):target.get_by_label('Übertragungsdatei prüfen',exact=True).set_input_files({'name':'transfer.json','mimeType':'application/json','buffer':json.dumps(value).encode()})
    inspect(data)
    expect(target.get_by_text('1 Entwürfe, 0 Nachrichten und 1 Assistenz-Zustellungen können übernommen werden.',exact=True)).to_be_visible()
    target.get_by_role('button',name='Geprüfte Datei übernehmen',exact=True).click()
    expect(target.get_by_text('1 unbestätigte Assistenz-Zustellungen',exact=True)).to_be_visible()
    assert target.evaluate('(key)=>localStorage.getItem(key)',draftkey)=='Alter unsynchronisierter Entwurf'
    assert target.evaluate("JSON.parse(localStorage.getItem('plum.assistant.outbox.v1:transfer-fixture'))[0].id")==command
    assert not mutations,'import must never deliver a paid question/task'
    conflict=json.loads(json.dumps(data));conflict['assistantOutbox'][0]['payload']['prompt']='Anderer Inhalt'
    inspect(conflict)
    expect(target.get_by_text('Eine lokale Assistenz-Befehlskennung hat einen anderen Inhalt. Zuerst die lokale Outbox prüfen.',exact=True)).to_be_visible()
    assert target.evaluate("JSON.parse(localStorage.getItem('plum.assistant.outbox.v1:transfer-fixture'))[0].payload.prompt")=='Vorbereitete persönliche Frage'
    wrong=json.loads(json.dumps(data));wrong['identity']['userId']='other';inspect(wrong)
    expect(target.get_by_text('Diese Datei gehört nicht zu derselben Plum-Installation und demselben Konto',exact=True)).to_be_visible()
    assert not mutations
    print('PASS: actual two-origin browser transfer retains draft and API command identity without credentials or automatic requests; conflicting transaction and foreign account imports are rejected before writes')
    browser.close()
