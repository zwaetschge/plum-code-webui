import json, os, base64
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright, expect

url=os.environ.get('PLUM_FIXTURE_URL','http://127.0.0.1:5188')
assert url.startswith(('http://127.0.0.1:','http://localhost:'))
user={'id':'api-browser-alice','email':'alice@example.invalid','username':'Alice','role':'admin'}
providers=[{'id':'fixture','name':'Persönliche API','protocol':'openai','models':['fixture-model']}, *[{'id':i,'name':n,'protocol':'anthropic' if i=='anthropic' else 'openai','models':['model-'+i]} for i,n in [('z-ai','GLM Coding Plan'),('deepseek','DeepSeek'),('mistral','Mistral'),('anthropic','Claude API')]]]
chat={'id':'api-fixture-chat','kind':'api-chat','revision':1,'title':'Meine Frage','body':{'providerId':'fixture','model':'fixture-model','sourceIds':[]},'createdAt':'2026-10-10T00:00:00Z','updatedAt':'2026-10-10T00:00:00Z'}
posts=[];turns=[];polls=0;pending=True;cli_requests=[]
pixel=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=')
source={'id':'source-fixture','kind':'source','revision':1,'title':'Quellenbeleg','body':{'text':'Die Quelle enthält belegte Fakten.'},'createdAt':'','updatedAt':''}
artifact={'id':'artifact-fixture','kind':'artifact','revision':1,'title':chat['title'],'body':{'type':'document','format':'markdown','content':'Anfang Ende','sourceIds':[]},'createdAt':'2026-10-10T00:00:00Z','updatedAt':'2026-10-10T00:00:00Z'}
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/local/bin/plum-chromium',headless=True)
    page=browser.new_page(viewport={'width':390,'height':844})
    page.on('pageerror',lambda error: print('FIXTURE ERROR:',str(error)))
    page.add_init_script("localStorage.setItem('claude-webui-auth',JSON.stringify({state:{token:'api-browser-fixture'},version:0}))")
    def api(route):
        global polls,pending,chat,artifact
        request=route.request;path=urlsplit(request.url).path
        if path=='/api/cli-providers':cli_requests.append(path)
        payload=json.loads(request.post_data) if 'application/json' in request.headers.get('content-type','') and request.post_data else {}
        if path.endswith('/images/image-fixture'):
            route.fulfill(content_type='image/png',body=pixel);return
        data={} if 'settings' in path else []
        if request.method=='POST':
            posts.append((path,payload))
            if path=='/api/assistant/api-chats':
                if payload.get('artifactEdit') or payload.get('workflow') or payload.get('temporary'):
                    chat={**chat,'id':'edit-fixture' if payload.get('artifactEdit') else 'research-fixture' if payload.get('workflow') else 'temporary-fixture','body':{**payload,**({'expiresAt':(datetime.now(timezone.utc)+timedelta(hours=24)).isoformat()} if payload.get('temporary') else {})}}
                    turns.clear();polls=0
                data=chat
            elif path.endswith('/turns'):
                turns.append({'id':payload['commandId'],'seq':len(turns)+1,'prompt':payload['prompt'],'response':'Anfang','status':'running','error':None,'model':'fixture-model','sourceVersions':[],'imageAssetIds':payload.get('imageAssetIds',[]),'usage':None,'createdAt':'2026-10-10T00:00:00Z'});data=turns[-1]
            elif path.endswith('/images'):data={'id':'image-fixture','filename':'probe.png','mimeType':'image/png','byteLength':len(pixel)}
            elif path.endswith('/branches'):
                data={'chat':{**chat,'id':'branch-fixture'},'prompt':turns[0]['prompt'] if not payload['includeAnswer'] else '', 'imageAssetIds':turns[0].get('imageAssetIds',[]) if not payload['includeAnswer'] else []}
            elif path.endswith('/results'):
                if payload['kind']=='research':
                    report=json.loads(turns[-1]['response']);artifact={**artifact,'title':report['title'],'body':{'type':'research','format':'markdown','content':report['report'],'sourceIds':[source['id']],'evidence':[{**report['claims'][0],'reviewed':False}]}}
                data=artifact
            elif path.endswith('/selection'):
                edit=chat['body']['artifactEdit'];original=artifact['body']['content'];artifact={**artifact,'revision':2,'body':{**artifact['body'],'content':original[:edit['start']]+payload['replacement']+original[edit['end']:]}};data=artifact
            elif path=='/api/assistant/references':data=[source] if source['id'] in payload.get('ids',[]) else []
        elif path=='/auth/me':data=user
        elif path=='/api/assistant/personalization':data={'revision':0,'nickname':'','voiceChat':True,'suggestedPrompts':False,'referencePhotos':{'portrait':None,'fullBody':None}}
        elif path=='/api/basic-auth/status':data={'enabled':False}
        elif path=='/api/assistant/overview':data={'counts':{},'recent':[],'tasks':[],'agents':[]}
        elif path=='/api/assistant/api-chat-providers':data=providers
        elif path=='/api/assistant/api-chats':data=[chat] if posts else []
        elif path.endswith('/turns'):
            polls+=1
            if pending and polls>=3 and turns:
                turns[-1].update({'status':'completed','response':'Anfang Ende','usage':{'input':4,'cached':1,'cacheWrite':0,'output':2,'costUsd':None}})
                if chat['body'].get('workflow')=='research':turns[-1]['response']=json.dumps({'title':'Belegter Bericht','report':'Die Fakten stehen in der Quelle [1].','claims':[{'claim':'Belegte Fakten','sourceId':source['id'],'sourceRevision':1,'quote':source['body']['text'],'note':'Persönlich prüfen'}]})
            data={'chat':{**chat,'id':'branch-fixture' if 'branch-fixture' in path else chat['id']},'turns':[] if 'branch-fixture' in path else turns}
        elif path=='/api/assistant/artifacts/artifact-fixture':data=artifact
        elif path=='/api/assistant/sources':data=[source]
        elif path in ['/api/assistant/profiles','/api/assistant/projects','/api/assistant/references','/api/sessions','/api/assistant/artifacts']:data=[]
        route.fulfill(content_type='application/json',body=json.dumps({'success':True,'data':data}))
    page.route('**/api/**',api);page.route('**/auth/me',api);page.route('**/socket.io/**',lambda route:route.abort())
    page.goto(url+'/chat');page.wait_for_timeout(2500)
    connection=page.get_by_role('combobox',name='Modellverbindung',exact=True)
    expect(connection).to_have_value('api:anthropic')
    assert connection.locator('option').evaluate_all('(rows)=>rows.map(row=>row.value)')==['api:anthropic','api:mistral','api:deepseek','api:z-ai','api:fixture']
    assert not cli_requests,'Chat must not fetch CLI harnesses'
    page.get_by_role('textbox',name='Deine Nachricht',exact=True).fill('Mein Entwurf')
    connection.select_option('api:mistral')
    expect(page.get_by_role('textbox',name='Deine Nachricht',exact=True)).to_have_value('Mein Entwurf')
    output=Path('.probe/plum-chat-api/welcome-mobile.png');output.parent.mkdir(parents=True,exist_ok=True);page.screenshot(path=str(output))
    page.set_viewport_size({'width':1440,'height':1000});page.screenshot(path='.probe/plum-chat-api/welcome-desktop.png');page.set_viewport_size({'width':390,'height':844})
    connection.select_option('api:fixture')
    page.get_by_role('textbox',name='Deine Nachricht',exact=True).fill('Meine Frage')
    page.locator('.plum-message-composer input[type=file]').set_input_files({'name':'probe.png','mimeType':'image/png','buffer':pixel})
    expect(page.get_by_role('button',name='probe.png entfernen',exact=True)).to_be_visible()
    page.get_by_role('button',name='Nachricht senden',exact=True).click()
    expect(page).to_have_url(url+'/chat/model/api-fixture-chat')
    expect(page.get_by_text('Anfang',exact=True)).to_be_visible()
    expect(page.get_by_role('button',name='Senden',exact=True)).to_be_disabled()
    expect(page.get_by_text('Anfang Ende',exact=True)).to_be_visible(timeout=8000)
    page.get_by_text('Modell und Verbrauch',exact=True).click()
    expect(page.get_by_text('5 Eingabetokens · 2 Ausgabetokens · Preis unbekannt',exact=False)).to_be_visible()
    assert len([item for item in posts if item[0].endswith('/turns')])==1
    assert len({item[1]['commandId'] for item in posts if 'commandId' in item[1]})==2
    assert [item[1]['imageAssetIds'] for item in posts if item[0].endswith('/turns')]==[['image-fixture']], str([(path,payload.get('imageAssetIds')) for path,payload in posts])
    expect(page.get_by_role('img',name='Bildanhang 1',exact=True)).to_be_visible()
    assert not page.evaluate('()=>document.documentElement.scrollWidth>innerWidth')
    output=Path('.probe/plum-assistant/api-chat-mobile.png');output.parent.mkdir(parents=True,exist_ok=True);page.screenshot(path=str(output),full_page=True)
    page.set_viewport_size({'width':1440,'height':1000});page.wait_for_timeout(800);assert page.get_by_text('Something went wrong.',exact=True).count()==0;page.screenshot(path='.probe/plum-assistant/api-chat-desktop.png',full_page=True)
    page.get_by_text('Weitere Aktionen',exact=True).first.click()
    page.get_by_role('button',name='Nachricht bearbeiten / neue Antwort',exact=True).click()
    expect(page).to_have_url(url+'/chat/model/branch-fixture')
    expect(page.get_by_role('textbox',name='Deine Nachricht',exact=True)).to_have_value('Meine Frage')
    assert posts[-1][1]['includeAnswer'] is False
    assert 'Meine' not in page.url
    expect(page.get_by_text('Bildanhänge aus der bearbeiteten Nachricht',exact=True)).to_be_visible()
    page.goto(url+'/chat/model/api-fixture-chat')
    page.get_by_text('Weitere Aktionen',exact=True).first.click()
    page.get_by_role('button',name='Als Ergebnis speichern',exact=True).click()
    expect(page).to_have_url(url+'/assistant/artifacts?resource=artifact-fixture')
    expect(page.get_by_text('Anfang Ende',exact=True)).to_be_visible()
    assert posts[-1][1]['kind']=='document'
    assert all('apiKey' not in json.dumps(item) for item in posts)
    page.get_by_role('region',name='Ergebnis bearbeiten und ansehen',exact=True).get_by_role('button',name='Bearbeiten',exact=True).click()
    page.get_by_role('textbox',name='Ergebnisinhalt',exact=True).evaluate("element => {element.focus();element.setSelectionRange(0,6);document.dispatchEvent(new Event('selectionchange'));element.dispatchEvent(new Event('select',{bubbles:true}));}")
    expect(page.get_by_role('button',name='Auswahl mit Plum ändern',exact=True)).to_be_enabled()
    page.get_by_role('button',name='Auswahl mit Plum ändern',exact=True).click()
    page.get_by_role('textbox',name='Deine Nachricht',exact=True).fill('Verbessere die Auswahl')
    page.get_by_role('button',name='Änderung vorschlagen lassen',exact=True).click()
    expect(page).to_have_url(url+'/chat/model/edit-fixture')
    expect(page.get_by_role('textbox',name='Neue Textstelle',exact=True)).to_be_visible(timeout=8000)
    assert artifact['revision']==1,'proposal must not mutate original'
    page.get_by_role('textbox',name='Neue Textstelle',exact=True).fill('Korrigiert')
    page.get_by_role('button',name='Geprüfte Auswahl übernehmen',exact=True).click()
    expect(page).to_have_url(url+'/assistant/artifacts?resource=artifact-fixture')
    expect(page.get_by_text('Korrigiert Ende',exact=True)).to_be_visible()
    assert posts[-1][1]['replacement']=='Korrigiert'
    page.goto(url+'/chat');page.get_by_role('combobox',name='Modellverbindung',exact=True).select_option('api:fixture');page.get_by_role('button',name='Gesprächsoptionen',exact=True).click()
    page.get_by_role('checkbox',name='Quellengebundene Dokumentrecherche',exact=True).check()
    expect(page.get_by_role('button',name='Nachricht senden',exact=True,include_hidden=True)).to_be_disabled()
    page.get_by_role('checkbox',name='Quellenbeleg',exact=True).check()
    page.get_by_role('button',name='Fertig',exact=True).click()
    page.get_by_role('textbox',name='Deine Nachricht',exact=True).fill('Vergleiche belegte Fakten')
    page.get_by_role('button',name='Nachricht senden',exact=True).click()
    expect(page).to_have_url(url+'/chat/model/research-fixture')
    expect(page.get_by_role('heading',name='Belegter Bericht',exact=True)).to_be_visible(timeout=8000)
    page.get_by_role('button',name='Bericht und Belegregister speichern',exact=True).click()
    expect(page).to_have_url(url+'/assistant/artifacts?resource=artifact-fixture')
    expect(page.get_by_role('heading',name='Belegregister (1)',exact=True)).to_be_visible()
    expect(page.get_by_role('checkbox',name='Von mir geprüft',exact=True)).not_to_be_checked()
    page.set_viewport_size({'width':390,'height':844});assert not page.evaluate('()=>document.documentElement.scrollWidth>innerWidth');page.screenshot(path='.probe/plum-assistant/research-mobile.png',full_page=True)
    print('PASS: actual text selection to reviewed replacement and source-bound research to editable report/evidence register; original retained until explicit apply')
    page.goto(url+'/chat');page.get_by_role('combobox',name='Modellverbindung',exact=True).select_option('api:fixture');page.get_by_role('button',name='Gesprächsoptionen',exact=True).click()
    page.get_by_role('checkbox',name='Temporäres Gespräch',exact=True).check()
    expect(page.get_by_role('checkbox',name='Quellengebundene Dokumentrecherche',exact=True)).not_to_be_checked()
    page.get_by_role('button',name='Fertig',exact=True).click()
    page.get_by_role('textbox',name='Deine Nachricht',exact=True).fill('Privates temporäres Gespräch')
    page.get_by_role('button',name='Nachricht senden',exact=True).click()
    expect(page).to_have_url(url+'/chat/model/temporary-fixture')
    expect(page.get_by_text('Anfang Ende',exact=True)).to_be_visible(timeout=8000)
    expect(page.get_by_role('button',name='Als persönliche Erinnerung speichern',exact=True)).to_have_count(0)
    expect(page.get_by_role('button',name='Hier abzweigen',exact=True)).to_have_count(0)
    expect(page.get_by_text('Temporäres Gespräch · lokale Löschung',exact=False)).to_be_visible()
    print('PASS: temporary API-chat entry, expiry notice and absence of permanent transfer actions')
    assert not any(path=='/api/sessions' for path,payload in posts),'API chats cannot create CLI sessions'
    print('PASS: API-only Chat; Anthropic/Mistral/DeepSeek/GLM order and default; no CLI catalogue or session creation; draft retained')
    print('PASS: actual API-chat creation, separate runtime selection, incremental reply, stable delivery IDs, lossless edit branch and answer-to-artifact route; desktop/mobile rendered')
    browser.close()
