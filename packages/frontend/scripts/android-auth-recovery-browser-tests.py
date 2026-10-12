import json,os
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright,expect
root=os.environ.get('PLUM_FIXTURE_URL','http://127.0.0.1:5188')
assert root.startswith('http://127.0.0.1:')
user={'id':'native-recovery-fixture','name':'Vale','role':'admin','email':'fixture@example.invalid'}
results=[]
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/local/bin/plum-chromium',headless=True)
 for path,rejected in [('/chat',False),('/tasks',False),('/chat',True)]:
  context=browser.new_context(viewport={'width':390,'height':844})
  context.add_init_script("window.__PLUM_ANDROID__={apiBase:location.origin+'/mobile',token:'recovery-fixture-only'};localStorage.removeItem('claude-webui-auth');")
  page=context.new_page();attempts=[0];errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  def route(r):
   request=r.request;endpoint=urlsplit(request.url).path.removeprefix('/mobile')
   if '/socket.io' in endpoint:r.abort();return
   if endpoint not in ['/api/basic-auth/status','/auth/proxy/status']:
    assert request.headers.get('authorization')=='Bearer recovery-fixture-only',endpoint
   data=[]
   if endpoint=='/auth/me':
    attempts[0]+=1
    if rejected or attempts[0]==1:
     r.fulfill(status=401 if rejected else 503,content_type='application/json',body=json.dumps({'success':False,'error':{'message':'Rejected' if rejected else 'Temporarily unavailable'}}));return
    data=user
   elif endpoint=='/api/basic-auth/status':data={'enabled':True}
   elif endpoint=='/api/assistant/personalization':data={'revision':0,'referencePhotos':{},'nickname':'Vale','suggestedPrompts':False,'voiceChat':False}
   elif endpoint=='/api/assistant/overview':data={'counts':{},'recent':[],'tasks':[],'agents':[]}
   elif endpoint=='/api/cli-providers':data=[{'id':'codex','name':'Codex','available':True,'enabled':True,'models':['gpt-5.5'],'defaultModel':'gpt-5.5'}]
   elif endpoint=='/api/settings':data={}
   elif endpoint=='/api/setup/status':data={'ready':True}
   elif endpoint=='/auth/proxy/status':data={'enabled':False}
   r.fulfill(content_type='application/json',body=json.dumps({'success':True,'data':data}))
  page.route('**/mobile/**',route)
  page.goto(root+path)
  if rejected:
   expect(page).to_have_url(root+'/login',timeout=20000)
   page.wait_for_timeout(5500)
   assert attempts[0]==1,'Rejected credentials must not be retried'
  else:
   expect(page.get_by_role('heading',name='Verbindung zu Plum unterbrochen',exact=True)).to_be_visible(timeout=20000)
   assert page.url==root+path,'Temporary outage lost the target surface'
   expect(page.get_by_role('button',name='Erneut verbinden',exact=True)).to_be_visible()
   if path=='/chat':expect(page.get_by_role('heading',name='Hallo Vale',exact=False)).to_be_visible(timeout=20000)
   else:expect(page.get_by_role('heading',name='Welche Aufgabe soll Plum erledigen?',exact=True)).to_be_visible(timeout=20000)
   assert page.url==root+path
   assert attempts[0]>=2
  assert page.evaluate("localStorage.getItem('claude-webui-auth')") is None
  assert not errors,errors
  results.append({'route':path,'case':'invalid-credentials' if rejected else '503-recovery','passed':True,'authAttempts':attempts[0]})
  context.close()
 browser.close()
print(json.dumps(results))
