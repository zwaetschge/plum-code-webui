import json,os
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright,expect
url=os.environ.get('PLUM_FIXTURE_URL','http://127.0.0.1:5192');assert url.startswith('http://127.0.0.1:')
sessions=[dict(id=i,name=n,surface=s,workingDirectory='/workspace/'+i,cliProvider='codex',cliModel='gpt-5.5',mode='manual',starred=False,createdAt='2026-10-11T15:00:00Z',updatedAt='2026-10-11T16:00:00Z') for i,n,s in [('talk','Meine CLI-Frage','chat'),('cache','Cache-Platte prüfen','task'),('app','Frontend entwickeln','code')]]
chat={'id':'api-chat','title':'Mein Modellgespräch','kind':'api-chat','revision':1,'createdAt':'2026-10-11T15:00:00Z','updatedAt':'2026-10-11T16:00:00Z','body':{'providerId':'fixture','model':'fixture-model'}}
project={'id':'my-project','title':'Mein Chatprojekt','kind':'project','revision':1,'body':{},'updatedAt':'2026-10-11T16:00:00Z'}
results=[]
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/local/bin/plum-chromium',headless=True)
 for width in [1440,390,320]:
  context=browser.new_context(viewport={'width':width,'height':900});page=context.new_page();errors=[];writes=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.add_init_script("localStorage.setItem('claude-webui-auth',JSON.stringify({state:{token:'sidebar-fixture'},version:0}));localStorage.setItem('theme','dark');localStorage.setItem('background-animation','aurora')")
  def route(r):
   path=urlsplit(r.request.url).path;data=[]
   if r.request.method not in ['GET','HEAD']:
    writes.append(path)
    if path!='/api/assistant/references':raise AssertionError('Unexpected mutation '+path)
   if path=='/auth/me':data={'id':'sidebar-fixture','email':'fixture@example.invalid','name':'Vale','role':'admin'}
   elif path=='/api/basic-auth/status':data={'enabled':False}
   elif path=='/api/sessions':data=sessions
   elif path=='/api/settings':data={'defaultWorkingDir':'','defaultCliProvider':'codex','enabledCliProviders':['codex']}
   elif path=='/api/setup/status':data={'ready':True}
   elif path=='/api/cli-providers':data=[{'id':'codex','name':'Codex','available':True,'enabled':True,'models':['gpt-5.5'],'defaultModel':'gpt-5.5'}]
   elif path=='/api/assistant/api-chats':data=[chat]
   elif path=='/api/assistant/projects':data=[project]
   elif path=='/api/assistant/personalization':data={'revision':0,'nickname':'Vale','voiceChat':True,'suggestedPrompts':True,'referencePhotos':{'portrait':None,'fullBody':None}}
   elif path=='/api/assistant/overview':data={'counts':{},'recent':[],'tasks':[],'agents':[]}
   elif path=='/api/assistant/api-chats/api-chat/turns':data={'chat':chat,'turns':[]}
   r.fulfill(content_type='application/json',body=json.dumps({'success':True,'data':data}))
  page.route('**/api/**',route);page.route('**/auth/**',route);page.route('**/socket.io/**',lambda r:r.abort())
  page.goto(url+'/chat');expect(page.get_by_role('textbox',name='Deine Nachricht',exact=True)).to_be_visible(timeout=90000)
  if width<768:page.get_by_role('button',name='Navigation öffnen',exact=True).click()
  side=page.locator('.app-sidebar-shell:visible');expect(side).to_have_count(1)
  assert page.locator('.assistant-sidebar').count()==0
  for name in ['Plum Chat','Plum Task','Plum Code','Agenten','Schwarm','Monitor','Analytics','General Settings','Personalisierung','Neuer Chat']:
   expect(side.get_by_role('link',name=name,exact=True)).to_be_visible()
  expect(side.get_by_role('link',name='Meine CLI-Frage',exact=False)).to_be_visible()
  expect(side.get_by_role('link',name='Mein Modellgespräch',exact=True)).to_be_visible()
  assert side.get_by_role('link',name='Meine CLI-Frage',exact=False).get_attribute('href')=='/chat/session/talk'
  assert side.get_by_role('link',name='Mein Modellgespräch',exact=True).get_attribute('href')=='/chat/model/api-chat'
  assert not side.get_by_role('link',name='Cache-Platte prüfen',exact=False).count()
  assert not side.get_by_role('link',name='Frontend entwickeln',exact=False).count()
  side.get_by_role('textbox',name='Gespräche suchen',exact=True).fill('Modell')
  expect(side.get_by_role('link',name='Meine CLI-Frage',exact=False)).to_have_count(0)
  expect(side.get_by_role('link',name='Mein Modellgespräch',exact=True)).to_be_visible()
  side.get_by_role('textbox',name='Gespräche suchen',exact=True).fill('')
  side.locator('summary',has_text='Bibliothek').click()
  expect(side.get_by_role('link',name='Gedächtnis',exact=True)).to_be_visible()
  side.locator('summary',has_text='Bibliothek').click()
  page.screenshot(path=f'/mnt/user/appdata/claude-code-webui/.probe/plum-task-sessions/shared-chat-sidebar-{width}.png',animations='disabled')
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  side.get_by_role('link',name='Mein Modellgespräch',exact=True).click()
  expect(page).to_have_url(url+'/chat/model/api-chat')
  if width<768:expect(page.locator('.mobile-navigation-sheet:visible')).to_have_count(0)
  expect(page.get_by_role('textbox',name='Deine Nachricht',exact=True)).to_be_visible(timeout=30000)
  page.goto(url+'/tasks');expect(page.get_by_role('heading',name='Welche Aufgabe soll Plum erledigen?',exact=True)).to_be_visible(timeout=30000)
  expect(page.get_by_role('link',name='Open session Cache-Platte prüfen',exact=True)).to_be_visible()
  expect(page.get_by_role('link',name='Open session Frontend entwickeln',exact=True)).to_have_count(0)
  assert not errors,errors
  results.append({'width':width,'passed':True,'sharedShell':True,'chatHistoryAndProjectsPreserved':True,'scopedTaskSessions':True,'pageErrors':errors})
  print('PASS',width,flush=True);context.close()
 browser.close()
Path('/mnt/user/appdata/claude-code-webui/reports/plum-shared-sidebar-browser-verification-2026-10-11.json').write_text(json.dumps(results,indent=2))
