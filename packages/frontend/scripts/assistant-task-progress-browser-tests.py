import json, os
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright, expect
root=os.environ.get('PLUM_FIXTURE_URL','http://127.0.0.1:5188')
assert root.startswith('http://127.0.0.1:')
user={'id':'task-progress-fixture','email':'fixture@example.invalid','role':'admin'}
for_width=[390,1440]
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/local/bin/plum-chromium',headless=True)
 for width in for_width:
  task={'id':'progress-task','kind':'task','revision':1,'title':'Auftrag verfolgen','createdAt':'2026-10-11T18:00:00Z','updatedAt':'2026-10-11T18:00:00Z','body':{'status':'draft','goal':'Antworte mit dem Ergebnis','provider':'codex','deliverables':[]}}
  reads=[0];actions=[];errors=[];requests=[]
  context=browser.new_context(viewport={'width':width,'height':900});page=context.new_page()
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.add_init_script("localStorage.setItem('claude-webui-auth',JSON.stringify({state:{token:'task-progress-fixture'},version:0}))")
  def route(r):
   path=urlsplit(r.request.url).path; data=[];requests.append((r.request.method,path))
   if path=='/auth/me':data=user
   elif path=='/api/basic-auth/status':data={'enabled':False}
   elif path=='/api/assistant/overview':data={'counts':{},'tasks':[],'agents':[],'recent':[]}
   elif path=='/api/assistant/tasks':
    # Deliberately disappears from the current filtered page after starting.
    data=[task] if task['body']['status']=='draft' else []
   elif path.endswith('/commands'):
    payload=r.request.post_data_json;actions.append(payload)
    assert payload['expectedRevision']==task['revision']
    task['revision']+=1
    task['body']['status']='running' if payload['action']=='submit' else 'completed'
    data={'taskId':task['id'],'status':'accepted'}
   elif path=='/api/assistant/tasks/progress-task':
    reads[0]+=1
    if task['body']['status']=='running' and reads[0]>=3:
     task['revision']+=1;task['body'].update(status='waiting_input',result='PLUM_TASK_VISIBLE_RESULT')
    data=task
   elif path.endswith('/limits'):data={'knownCostUsd':0,'budgetUsd':None,'deadline':None,'unpricedTurns':0,'scope':'cli'}
   elif 'settings' in path:data={}
   r.fulfill(content_type='application/json',body=json.dumps({'success':True,'data':data}))
  page.route('**/api/**',route);page.route('**/auth/**',route);page.route('**/socket.io/**',lambda r:r.abort())
  page.goto(root+'/assistant/tasks')
  page.get_by_label('Taskstatus',exact=True).select_option('draft')
  page.get_by_role('button',name='Auftrag verfolgen Entwurf',exact=True).click()
  try:
   page.get_by_role('button',name='Starten',exact=True).click(timeout=10000)
  except Exception:
   print('DIAGNOSTIC',json.dumps({'requests':requests,'actions':actions,'task':task,'visible':page.locator('body').inner_text(),'errors':errors}));raise
  expect(page.get_by_role('heading',name='Auftrag verfolgen',exact=True)).to_be_visible()
  expect(page.get_by_text('PLUM_TASK_VISIBLE_RESULT',exact=True)).to_be_visible(timeout=20000)
  page.get_by_role('button',name='Ergebnis akzeptieren',exact=True).click()
  expect(page.get_by_role('button',name='Neuer Versuch',exact=True)).to_be_visible(timeout=15000)
  assert task['body']['status']=='completed' and [a['action'] for a in actions]==['submit','complete']
  assert not errors,errors
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  print('PASS',width,'Task remains open, filtered-out task refreshes, result appears and can be accepted')
  context.close()
 browser.close()
