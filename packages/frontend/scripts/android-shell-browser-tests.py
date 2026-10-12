import json,os
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright,expect
root=os.environ.get('PLUM_FIXTURE_URL','http://127.0.0.1:5188');assert root.startswith('http://127.0.0.1:')
user={'id':'android-shell-fixture','name':'Vale','email':'fixture@example.invalid','role':'admin'}
task={'id':'android-task','kind':'task','revision':1,'title':'Hermes-Auftrag','createdAt':'2026-10-11T08:00:00Z','updatedAt':'2026-10-11T08:00:00Z','body':{'goal':'Teste die neue Arbeitsfläche','status':'draft','agentId':'hermes','provider':'codex','sourceIds':[],'deliverables':['Zusammenfassung']}}
checks=[]
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/local/bin/plum-chromium',headless=True)
 for width,height in [(1440,1000),(390,844),(320,700)]:
  context=browser.new_context(viewport={'width':width,'height':height},color_scheme='dark')
  context.add_init_script("window.__PLUM_ANDROID__={apiBase:location.origin+'/mobile',token:'android-fixture-only'};localStorage.setItem('theme','dark');localStorage.setItem('background-animation','aurora');localStorage.removeItem('claude-webui-auth');")
  page=context.new_page();errors=[];requests=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.on('requestfailed',lambda r:print('Resource failed',r.urlsplit if hasattr(r,'urlsplit') else urlsplit(r.url).path,r.failure) if '/assets/' in r.url else None)
  def api(route):
   request=route.request;path=urlsplit(request.url).path
   if '/socket.io/' in path:route.abort();return
   assert path.startswith('/mobile/'),path
   assert request.headers.get('authorization')=='Bearer android-fixture-only',path
   requests.append(path);path=path.removeprefix('/mobile');data=[]
   assert request.method=='GET','Opening the workspace must not start tasks'
   if path=='/auth/me':data=user
   elif path=='/api/basic-auth/status':data={'enabled':False}
   elif path=='/api/cli-providers':data=[{'id':'codex','name':'Codex','available':True,'enabled':True,'models':['gpt-5.5'],'defaultModel':'gpt-5.5'}]
   elif path=='/api/assistant/overview':data={'counts':{},'recent':[],'tasks':[],'agents':[{'id':'hermes','name':'Hermes','state':'online','runtime':{'provider':'codex'}}]}
   elif path=='/api/assistant/personalization':data={'revision':1,'nickname':'Vale','voiceChat':False,'suggestedPrompts':False,'referencePhotos':{'portrait':None,'fullBody':None}}
   elif path=='/api/assistant/tasks':data=[task]
   elif path=='/api/assistant/tasks/android-task':data=task
   elif path.endswith('/limits'):data={'knownCostUsd':0,'scope':'native-coordinator','budgetUsd':None}
   elif 'settings' in path:data={}
   route.fulfill(content_type='application/json',body=json.dumps({'success':True,'data':data}))
  page.route('**/mobile/**',api)
  page.route('**/socket.io/**',lambda r:r.abort())
  page.goto(root+'/chat')
  expect(page.get_by_role('heading',name='Hallo Vale',exact=False)).to_be_visible(timeout=60000)
  assert page.evaluate("localStorage.getItem('claude-webui-auth')") is None
  assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
  page.screenshot(path=f'reports/plum-android-chat-{width}-2026-10-11.png',full_page=True)
  page.goto(root+'/assistant/tasks')
  expect(page.get_by_role('region',name='Task-Board')).to_be_visible(timeout=60000)
  page.get_by_role('button',name='Hermes-Auftrag Entwurf',exact=True).click()
  expect(page.get_by_role('heading',name='Hermes-Auftrag',exact=True)).to_be_visible()
  assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
  page.screenshot(path=f'reports/plum-android-task-{width}-2026-10-11.png',full_page=True)
  page.goto(root+'/chat/personalization')
  if errors: print('Browser errors',errors)
  expect(page.get_by_role('heading',name='Personalisierung',exact=True)).to_be_visible(timeout=60000)
  assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
  assert not errors,errors
  assert '/mobile/auth/me' in requests
  if not os.environ.get("PLUM_PRODUCTION_BUNDLE"):
   page.evaluate("""async () => {
    const shell = await import('/src/lib/nativeShell.ts');
    const original = window.__PLUM_ANDROID__;
    for (const apiBase of ['https://external.example.invalid/mobile',location.origin+'/mobile?secret=x',location.origin+'/mobile#fragment']) {window.__PLUM_ANDROID__={...original,apiBase};if(shell.nativeShell()!==null)throw Error('Unsafe native configuration accepted');}
    window.__PLUM_ANDROID__=original;
    let loggedOut = false;window.PlumHost={logout:()=>loggedOut=true};
    const {useAuthStore}=await import('/src/stores/authStore.ts');useAuthStore.getState().logout();
    if(!loggedOut)throw Error('Native logout was not dispatched');
    if(localStorage.getItem('claude-webui-auth')!==null)throw Error('Native token persisted');
  }""")
  checks.append({'width':width,'chat':'passed','task':'passed','personalization':'passed','mobileApiPrefix':'passed','nativeTokenNotPersisted':'passed','openingHasNoMutations':'passed'})
  context.close()
 browser.close()
Path('reports/plum-android-shell-'+('production' if os.environ.get('PLUM_PRODUCTION_BUNDLE') else 'browser')+'-2026-10-11.json').write_text(json.dumps({'checks':checks,'deviceExecution':False},indent=2))
print('Android workspace rendering / mobile API binding / transient authentication passed:',len(checks),'sizes')
