import json, os
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright, expect

url=os.environ.get('PLUM_FIXTURE_URL','http://127.0.0.1:5188')
assert url.startswith(('http://127.0.0.1:','http://localhost:'))
user={'id':'notebook-browser-alice','email':'alice@example.invalid','role':'admin'}
date='2026-10-10T00:00:00Z'
dataset={'id':'data-fixture','kind':'artifact','revision':1,'title':'Umsätze.csv','body':{'type':'dataset','format':'csv','content':'Region,Umsatz\nZürich,10\nBern,20\nZürich,-5','sourceIds':[]},'createdAt':date,'updatedAt':date}
notebook={'type':'plum-notebook','version':1,'datasetId':dataset['id'],'datasetRevision':1,'steps':[{'id':'summary','kind':'summary','column':'Region'}],'report':''}
artifact={'id':'notebook-fixture','kind':'artifact','revision':1,'title':'Umsätze · Analyse','body':{'type':'notebook','format':'json','content':json.dumps(notebook),'sourceIds':[]},'createdAt':date,'updatedAt':date}
task={'id':'python-task-fixture','kind':'task','revision':1,'title':'Umsätze · Python','body':{'goal':'Berechne eine Umsatzprognose und prüfe die Annahmen.','status':'draft','provider':'codex','deliverables':['Python-Skript','Analysebericht'],'sourceIds':[]},'createdAt':date,'updatedAt':date}
script='print("<script>window.__unexpected = true</script>")\n'
code={'id':'python-code-fixture','kind':'artifact','revision':1,'title':'Umsatzanalyse.py','body':{'type':'code','format':'text','language':'python','content':script,'taskId':task['id'],'sourceIds':[]},'createdAt':date,'updatedAt':date}
posts=[];errors=[]
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/local/bin/plum-chromium',headless=True)
    page=browser.new_page(viewport={'width':390,'height':844})
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.add_init_script("localStorage.setItem('claude-webui-auth',JSON.stringify({state:{token:'notebook-browser-fixture'},version:0}))")
    def api(route):
        request=route.request;path=urlsplit(request.url).path
        payload=json.loads(request.post_data) if 'application/json' in request.headers.get('content-type','') and request.post_data else {}
        data={} if 'settings' in path else []
        if request.method=='POST':
            posts.append((path,payload))
            if path.endswith('/notebook'):data=artifact
            elif path.endswith('/run'):
                calculated=json.loads(artifact['body']['content'])
                assert calculated['steps'][0]['kind']=='group' and calculated['steps'][0]['aggregate']=='sum'
                calculated['run']={'id':payload['commandId'],'notebookId':artifact['id'],'at':date,'datasetHash':'a'*64,'inputRows':3,'outputs':[{'stepId':'summary','title':'group: Region','columns':['Region','sum'],'rows':[['Bern',20],['Zürich',5]],'series':[{'label':'Bern','value':20},{'label':'Zürich','value':5}]}]}
                artifact['revision']+=1;artifact['body']['content']=json.dumps(calculated);data=artifact
            elif path.endswith('/analysis-task'):
                assert payload['expectedRevision']==artifact['revision'] and payload['instructions']==task['body']['goal']
                artifact['revision']+=1;artifact['body']['analysisTaskIds']=[task['id']];data=task
            elif path=='/api/assistant/references':data=[]
        elif request.method=='PATCH' and path.endswith('/notebook-fixture'):
            assert payload['expectedRevision']==artifact['revision']
            artifact['body']=payload['body'];artifact['revision']+=1;data=artifact
        elif path=='/auth/me':data=user
        elif path=='/api/basic-auth/status':data={'enabled':False}
        elif path=='/api/assistant/overview':data={'counts':{},'recent':[],'tasks':[],'agents':[]}
        elif path=='/api/assistant/artifacts/python-code-fixture/export':
            assert 'format=py' in request.url and 'revision=1' in request.url
            route.fulfill(content_type='text/x-python; charset=utf-8',body=script);return
        elif path=='/api/assistant/artifacts/python-code-fixture':data=code
        elif path=='/api/assistant/artifacts/data-fixture':data=dataset
        elif path=='/api/assistant/artifacts/notebook-fixture':data=artifact
        elif path=='/api/assistant/artifacts':data=[dataset,artifact]
        elif path=='/api/assistant/tasks':data=[task]
        elif path.endswith('/limits'):data={'scope':'cli','knownCostUsd':0,'budgetUsd':None,'unpricedTurns':0}
        elif path=='/api/assistant/tasks/python-task-fixture':data=task
        route.fulfill(content_type='application/json',body=json.dumps({'success':True,'data':data}))
    page.route('**/api/**',api);page.route('**/auth/me',api);page.route('**/socket.io/**',lambda r:r.abort())
    page.goto(url+'/assistant/artifacts?resource=data-fixture')
    page.get_by_role('button',name='Analyse im Notebook',exact=True).click()
    expect(page).to_have_url(url+'/assistant/artifacts?resource=notebook-fixture')
    workspace=page.get_by_role('region',name='Datenworkspace',exact=True)
    workspace.get_by_role('combobox',name='Berechnung',exact=True).select_option('group')
    workspace.get_by_role('combobox',name='Aggregation',exact=True).select_option('sum')
    workspace.get_by_role('combobox',name='Wertespalte',exact=True).select_option('Umsatz')
    expect(workspace.get_by_role('button',name='Gespeicherte Schritte ausführen',exact=True)).to_be_disabled()
    workspace.get_by_role('button',name='Berechnung speichern',exact=True).click()
    expect(workspace.get_by_role('button',name='Gespeicherte Schritte ausführen',exact=True)).to_be_enabled()
    workspace.get_by_role('button',name='Gespeicherte Schritte ausführen',exact=True).click()
    expect(workspace.get_by_role('img',name='Balkendiagramm group: Region',exact=True)).to_be_visible()
    expect(workspace.get_by_role('cell',name='20',exact=True)).to_be_visible()
    expect(workspace.get_by_role('cell',name='5',exact=True)).to_be_visible()
    assert len(posts)==2 and all('commandId' in payload for _,payload in posts)
    expect(workspace.get_by_text('Eingaberevision 1.',exact=False)).to_be_visible()
    workspace.get_by_role('textbox',name='Interpretation / Bericht',exact=True).fill('**Eigene Interpretation:** Bern liegt höher.')
    workspace.get_by_role('button',name='Berechnung speichern',exact=True).click()
    expect(workspace.get_by_text('Eigene Interpretation:',exact=True)).to_be_visible()
    expect(workspace.get_by_role('img',name='Balkendiagramm group: Region',exact=True)).to_be_visible()
    assert not page.evaluate('()=>document.documentElement.scrollWidth>innerWidth')
    Path('.probe/plum-assistant').mkdir(parents=True,exist_ok=True)
    workspace.get_by_role('img',name='Balkendiagramm group: Region',exact=True).scroll_into_view_if_needed()
    page.screenshot(path='.probe/plum-assistant/notebook-mobile.png',full_page=True)
    page.set_viewport_size({'width':1440,'height':1000});page.screenshot(path='.probe/plum-assistant/notebook-desktop.png',full_page=True)
    assert not page.evaluate('()=>document.documentElement.scrollWidth>innerWidth')
    workspace.get_by_role('button',name='Berechnungsschritt hinzufügen',exact=True).click()
    expect(workspace.get_by_role('combobox',name='Berechnung',exact=True)).to_have_count(2)
    expect(workspace.get_by_text('Noch kein bestätigter Lauf für diese Schritte.',exact=True)).to_be_visible()
    python=workspace.get_by_role('region',name='Freie Python-Analyse',exact=True)
    python.get_by_role('textbox',name='Analyseauftrag',exact=True).fill(task['body']['goal'])
    expect(python.get_by_role('button',name='Python-Task erstellen',exact=True)).to_be_disabled()
    workspace.get_by_role('button',name='Berechnung speichern',exact=True).click()
    expect(python.get_by_role('button',name='Python-Task erstellen',exact=True)).to_be_enabled()
    python.scroll_into_view_if_needed()
    page.screenshot(path='.probe/plum-assistant/notebook-python-desktop.png',full_page=True)
    page.set_viewport_size({'width':390,'height':844})
    python.scroll_into_view_if_needed()
    page.screenshot(path='.probe/plum-assistant/notebook-python-mobile.png',full_page=True)
    assert not page.evaluate('()=>document.documentElement.scrollWidth>innerWidth')
    python.get_by_role('button',name='Python-Task erstellen',exact=True).click()
    expect(page).to_have_url(url+'/assistant/tasks?resource=python-task-fixture')
    assert len(posts)==3 and posts[-1][0].endswith('/analysis-task') and len(posts[-1][1]['commandId'])==36
    assert not any(path.endswith('/commands') or '/matrix/' in path for path,_ in posts), 'Draft must not start a worker'
    page.goto(url+'/assistant/artifacts?resource=notebook-fixture')
    expect(page.get_by_role('link',name='Python-Task 1',exact=True)).to_have_attribute('href','/assistant/tasks?resource=python-task-fixture')
    page.goto(url+'/assistant/artifacts?resource=python-code-fixture')
    expect(page.get_by_label('Gespeicherter Quellcode',exact=True)).to_have_text(script.strip())
    assert page.evaluate('window.__unexpected') is None,'Stored Python text must never execute as HTML'
    with page.expect_download() as download:
        page.get_by_role('button',name='Datei exportieren',exact=True).click()
    file=download.value
    assert file.suggested_filename=='Umsatzanalyse.py'
    assert Path(file.path()).read_text()==script
    assert not errors,errors
    print('PASS: actual dataset→notebook navigation, ordered editable group steps, save-before-run, confirmed chart/table, preserved interpretation results, invalidation after changed calculations, Python draft with saved revision/UUID and lineage link, raw .py download with exact bytes/name and safe code preview, no worker start and desktop/mobile widths')
    browser.close()
