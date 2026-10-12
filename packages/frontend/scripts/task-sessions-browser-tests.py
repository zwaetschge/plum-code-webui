"""Exercise real session dashboards with a private, isolated HTTP fixture."""
import copy,json,os
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright,expect
root=os.environ.get('PLUM_FIXTURE_URL','http://127.0.0.1:5190')
assert root.startswith('http://127.0.0.1:')
user={'id':'task-session-fixture','email':'fixture@example.invalid','role':'admin'}
initial=[dict(id=i,name=n,surface=s,status='stopped',workingDirectory='/workspace/'+i,cliProvider='codex',mode='manual',starred=False,createdAt='2026-10-11T15:00:00Z',updatedAt='2026-10-11T16:00:00Z',claudeSessionId='native-'+i,lastMessage='Existing history '+i) for i,n,s in [('cache','Cache-Platte prüfen','code'),('app','Plum Frontend entwickeln','code'),('trip','Reise planen','task'),('talk','Kurze Frage','chat'),('backup','Backups prüfen','code')]]
results=[]
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/local/bin/plum-chromium',headless=True)
 for width in [1440,390,320]:
  sessions=copy.deepcopy(initial);mutations=[];errors=[];fail_once=[True];requests=[]
  context=browser.new_context(viewport={'width':width,'height':900},reduced_motion='reduce');page=context.new_page()
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.add_init_script("localStorage.setItem('claude-webui-auth',JSON.stringify({state:{token:'task-session-fixture'},version:0}));localStorage.setItem('theme','dark');localStorage.setItem('background-animation','aurora')")
  def route(r):
   path=urlsplit(r.request.url).path;method=r.request.method;requests.append((method,path));data=[]
   if path=='/auth/me':data=user
   elif path=='/api/basic-auth/status':data={'enabled':False}
   elif path=='/api/sessions' and method=='GET':data=sessions
   elif path=='/api/sessions' and method=='POST':
    payload=r.request.post_data_json;mutations.append((method,path,payload))
    assert payload['surface']=='task' and 'workingDirectory' not in payload
    assert payload['initialMessage']=='Prüfe meine Cache-Platte'
    data={**initial[0],'id':'new-task','name':payload['name'],'surface':'task','workingDirectory':'/workspace/.plum-assistant/own-task','mode':payload['mode']};sessions.append(data)
   elif method=='PATCH' and path.endswith('/surface'):
    payload=r.request.post_data_json;session=next(s for s in sessions if s['id']==path.split('/')[3]);mutations.append((method,path,payload))
    if session['id']=='backup' and fail_once[0]:
     fail_once[0]=False;r.fulfill(status=503,content_type='application/json',body=json.dumps({'success':False,'error':{'message':'Temporary fixture error'}}));return
    assert payload.keys()=={'surface'}
    session['surface']=payload['surface'];data={'surface':payload['surface']}
   elif path.startswith('/api/sessions/') and len(path.split('/'))==4:data=next(s for s in sessions if s['id']==path.split('/')[3])
   elif path.endswith('/chats'):data={'chats':[],'activeChatId':None}
   elif path.endswith('/agents'):data={'runs':[],'live':[],'history':[],'totals':{}}
   elif path=='/api/assistant/tasks/old-task':data={'id':'old-task','kind':'task','title':'Structured order','revision':1,'body':{'goal':'Old goal','status':'draft','deliverables':[]}}
   elif path.endswith('/limits'):data={'knownCostUsd':0,'budgetUsd':None,'deadline':None,'unpricedTurns':0,'scope':'cli'}
   elif path.endswith('/profile'):data={'profileId':None,'profileRevision':None}
   elif path=='/api/settings':data={'defaultWorkingDir':'','defaultCliProvider':'codex','enabledCliProviders':['codex']}
   elif path=='/api/cli-providers':data=[{'id':'codex','name':'Codex','available':True,'enabled':True,'models':['gpt-5.5'],'defaultModel':'gpt-5.5'}]
   elif path=='/api/setup/status':data={'ready':True}
   elif path=='/api/assistant/overview':data={'counts':{},'tasks':[],'agents':[],'recent':[]}
   elif method not in ['GET','HEAD']:raise AssertionError('Unexpected fixture mutation: '+method+' '+path)
   r.fulfill(content_type='application/json',body=json.dumps({'success':True,'data':data}))
  page.route('**/api/**',route);page.route('**/auth/**',route);page.route('**/socket.io/**',lambda r:r.abort())
  def card(name):return page.get_by_role('link',name='Open session '+name,exact=True)
  page.goto(root+'/code');expect(page.get_by_role('heading',name='Was möchtest du entwickeln?',exact=True)).to_be_visible(timeout=90000)
  expect(card('Cache-Platte prüfen')).to_be_visible();expect(card('Reise planen')).to_have_count(0);expect(card('Kurze Frage')).to_have_count(0)
  # Per-session action moves the actual existing ID while its runtime/history stay untouched.
  page.get_by_role('button',name='More options for Cache-Platte prüfen',exact=True).click()
  page.get_by_role('menuitem',name='Nach Plum Task verschieben',exact=True).click()
  expect(card('Cache-Platte prüfen')).to_have_count(0)
  page.goto(root+'/tasks');expect(page.get_by_role('heading',name='Welche Aufgabe soll Plum erledigen?',exact=True)).to_be_visible(timeout=30000)
  expect(card('Cache-Platte prüfen')).to_be_visible();expect(card('Reise planen')).to_be_visible();expect(card('Plum Frontend entwickeln')).to_have_count(0)
  cache=next(s for s in sessions if s['id']=='cache');assert {k:v for k,v in cache.items() if k!='surface'}=={k:v for k,v in initial[0].items() if k!='surface'}
  assert page.locator('.assistant-sidebar').count()==0
  if width>=768:
   side=page.locator('.app-sidebar-shell');expect(side.get_by_role('link',name='Cache-Platte prüfen',exact=False)).to_be_visible();expect(side.get_by_role('link',name='Plum Frontend entwickeln',exact=False)).to_have_count(0)
  else:
   page.get_by_role('button',name='Navigation öffnen',exact=True).click()
   expect(page.locator('.mobile-navigation-sheet .app-sidebar-shell')).to_be_visible()
   page.screenshot(path=f'/mnt/user/appdata/claude-code-webui/.probe/plum-task-sessions/task-sidebar-{width}.png')
   page.keyboard.press('Escape')
  # Bulk movement keeps successful items, leaves a failed one selectable, and retries only that item.
  page.get_by_role('button',name='Sessions aus Code übernehmen',exact=True).click()
  dialog=page.get_by_role('dialog');dialog.get_by_role('checkbox',name='Plum Frontend entwickeln',exact=True).check();dialog.get_by_role('checkbox',name='Backups prüfen',exact=True).check()
  dialog.get_by_role('button',name='2 Sessions nach Task verschieben',exact=True).click()
  expect(dialog.get_by_role('alert')).to_contain_text('1 Zuordnungen fehlgeschlagen')
  dialog.get_by_role('button',name='1 Sessions nach Task verschieben',exact=True).click();expect(dialog).to_have_count(0)
  expect(card('Backups prüfen')).to_be_visible();expect(card('Plum Frontend entwickeln')).to_be_visible()
  assert all(method=='PATCH' and path.endswith('/surface') for method,path,payload in mutations)
  # Return a genuine code session; never silently classify from names.
  page.get_by_role('button',name='More options for Plum Frontend entwickeln',exact=True).click();page.get_by_role('menuitem',name='Nach Plum Code verschieben',exact=True).click()
  expect(card('Plum Frontend entwickeln')).to_have_count(0)
  # Search stays within the active workspace and assignments survive a reload.
  page.reload();expect(card('Cache-Platte prüfen')).to_be_visible(timeout=30000)
  page.get_by_placeholder('Search sessions',exact=True).fill('Frontend');expect(card('Plum Frontend entwickeln')).to_have_count(0)
  page.get_by_placeholder('Search sessions',exact=True).fill('')
  page.screenshot(path=f'/mnt/user/appdata/claude-code-webui/.probe/plum-task-sessions/after-task-{width}.png',full_page=True,timeout=90000,animations='disabled')
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),'Task overflows viewport'
  # No configured coding folder is required for a new task session.
  if width<768:page.locator('.dashboard-composer-mobile-toggle').click()
  page.get_by_placeholder('Zum Beispiel: Prüfe meine Cache-Platte und zeige mir die Befunde.').fill('Prüfe meine Cache-Platte')
  page.get_by_role('button',name='Start session',exact=True).click()
  expect(page).to_have_url(root+'/session/new-task',timeout=30000)
  assert mutations[-1][0]=='POST'
  page.goto(root+'/code');expect(card('Plum Frontend entwickeln')).to_be_visible(timeout=30000);expect(card('Cache-Platte prüfen')).to_have_count(0);expect(card('Reise planen')).to_have_count(0)
  if width>=768:assert page.locator('.app-sidebar-shell').count()==1
  page.screenshot(path=f'/mnt/user/appdata/claude-code-webui/.probe/plum-task-sessions/after-code-{width}.png',full_page=True,timeout=90000,animations='disabled')
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),'Code overflows viewport'
  # Existing links to structured orders remain separate and compatible.
  page.goto(root+'/tasks?resource=old-task');expect(page).to_have_url(root+'/assistant/tasks?resource=old-task',timeout=30000)
  assert not errors,errors
  assert len([m for m in mutations if m[0]=='POST'])==1
  results.append({'width':width,'passed':True,'checks':['same Sidebar for Task and Code','scoped lists/search/sidebar','existing ID/history/workspace preserved','individual and bulk assignment with partial failure retry','persisted assignment reload','Task starts without coding folder','legacy order link redirects']})
  print('PASS',width,flush=True);context.close()
 browser.close()
Path('/mnt/user/appdata/claude-code-webui/reports/plum-task-session-browser-verification-2026-10-11.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
