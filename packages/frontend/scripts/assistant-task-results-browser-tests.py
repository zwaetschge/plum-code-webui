import json, os
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright, expect
url=os.environ.get('PLUM_FIXTURE_URL','http://127.0.0.1:5188');assert url.startswith(('http://127.0.0.1:','http://localhost:'))
user={'id':'output-browser-alice','email':'alice@example.invalid','role':'admin'}
task={'id':'output-task','kind':'task','revision':2,'title':'Umsatzanalyse','createdAt':'2026-10-10T08:00:00Z','updatedAt':'2026-10-10T08:00:00Z','body':{'goal':'Skript und Bericht liefern','status':'waiting_input','result':'Die Analyse ist bereit.','provider':'codex','deliverables':['Python-Skript','Analysebericht'],'sourceIds':[]}}
files=[{'id':'00000000-0000-4000-8000-000000000001','title':'Analyse.py','revision':1,'type':'code'},{'id':'00000000-0000-4000-8000-000000000002','title':'Auswertung','revision':2,'type':'document'}]
requests=[];errors=[];lost=True;receipt=None
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/local/bin/plum-chromium',headless=True);page=browser.new_page(viewport={'width':1440,'height':1000})
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.add_init_script("localStorage.setItem('claude-webui-auth',JSON.stringify({state:{token:'output-browser-fixture'},version:0}))")
    def api(route):
        global lost,receipt
        request=route.request;path=urlsplit(request.url).path
        data={} if 'settings' in path else []
        if request.method=='POST':
            payload=request.post_data_json;requests.append((path,payload))
            if path.endswith('/results'):
                if receipt is None:
                    assert payload['expectedRevision']==task['revision']
                    assert payload['items']==[{'index':0,'artifactId':files[0]['id'],'revision':1},{'index':1,'artifactId':files[1]['id'],'revision':2}]
                    task['revision']+=1;task['body']['deliverableReviews']=[{**item,'label':task['body']['deliverables'][item['index']]} for item in payload['items']];task['body']['deliverableReviewedBy']=user['id'];receipt=json.loads(json.dumps(task))
                data=receipt
                if lost:lost=False;route.abort('failed');return
            elif path.endswith('/commands'):
                assert payload['action']=='complete' and payload['expectedRevision']==task['revision']
                task['revision']+=1;task['body']['status']='completed';data={'taskId':task['id'],'status':'accepted'}
        elif path=='/auth/me':data=user
        elif path=='/api/basic-auth/status':data={'enabled':False}
        elif path=='/api/assistant/overview':data={'counts':{},'recent':[],'tasks':[],'agents':[]}
        elif path=='/api/assistant/tasks':data=[task]
        elif path=='/api/assistant/tasks/output-task':data=task
        elif path.endswith('/results'):data=files
        elif path.endswith('/limits'):data={'knownCostUsd':0,'budgetUsd':None,'unpricedTurns':0,'deadline':None,'scope':'cli'}
        route.fulfill(content_type='application/json',body=json.dumps({'success':True,'data':data}))
    page.route('**/api/**',api);page.route('**/auth/me',api);page.route('**/socket.io/**',lambda route:route.abort())
    page.goto(url+'/tasks?resource=output-task')
    results=page.get_by_role('region',name='Auftragsergebnisse',exact=True)
    expect(results.get_by_role('link',name='Analyse.py · code · Revision 1',exact=True)).to_have_attribute('href','/assistant/artifacts?resource='+files[0]['id']+'&revision=1')
    expect(page.get_by_role('button',name='Ergebnis akzeptieren',exact=True)).to_be_disabled()
    results.get_by_label('Ergebnis 1: Python-Skript',exact=True).select_option(files[0]['id']+':1')
    expect(results.get_by_role('button',name='Auswahl geprüft speichern',exact=True)).to_be_disabled()
    results.get_by_label('Ergebnis 2: Analysebericht',exact=True).select_option(files[1]['id']+':2')
    results.scroll_into_view_if_needed();Path('.probe/plum-assistant').mkdir(parents=True,exist_ok=True)
    page.screenshot(path='.probe/plum-assistant/task-results-desktop.png',full_page=True)
    page.set_viewport_size({'width':390,'height':844});results.scroll_into_view_if_needed();page.screenshot(path='.probe/plum-assistant/task-results-mobile.png',full_page=True)
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    results.get_by_role('button',name='Auswahl geprüft speichern',exact=True).click()
    summary=page.get_by_text('1 unbestätigte Assistenz-Zustellungen',exact=True)
    expect(summary).to_be_visible();summary.click()
    page.get_by_role('button',name='Zustellung prüfen / wiederholen',exact=True).click()
    expect(summary).to_have_count(0)
    assert len(requests)==2 and requests[0]==requests[1], 'Lost acknowledgement must reuse the exact command'
    page.get_by_role('button',name='Aktualisieren',exact=True).click()
    expect(page.get_by_role('button',name='Ergebnis akzeptieren',exact=True)).to_be_enabled(timeout=10000)
    expect(results.get_by_role('link',name='Geprüfte Revision öffnen',exact=True)).to_have_count(2)
    page.get_by_role('button',name='Ergebnis akzeptieren',exact=True).click()
    expect(page.get_by_role('button',name='Umsatzanalyse Erledigt',exact=True)).to_be_visible(timeout=10000)
    page.get_by_role('button',name='Umsatzanalyse Erledigt',exact=True).click()
    expect(page.get_by_role('button',name='Neuer Versuch',exact=True)).to_be_visible(timeout=10000)
    assert task['body']['status']=='completed' and len(requests)==3 and requests[-1][1]['action']=='complete'
    assert not errors,errors
    print('PASS: actual Task result links, required mapping disables completion, immutable artifact revision choices, exact lost-ack command retry, explicit acceptance and desktop/mobile widths')
    browser.close()
