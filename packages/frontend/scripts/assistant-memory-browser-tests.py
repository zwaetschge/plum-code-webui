import os,json,uuid
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright,expect
fixture=json.loads(Path(os.environ['PLUM_PERSONALIZATION_FIXTURE_RECORD']).read_text())
root=os.environ.get('PLUM_FIXTURE_URL','http://127.0.0.1:5188')
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/local/bin/plum-chromium',headless=True)
 run_id=uuid.uuid4().hex[:6]
 for width,height,viewport_label in [(1440,1000,'desktop'),(390,844,'mobile'),(320,700,'narrow')]:
  label=viewport_label+'-'+run_id
  c=browser.new_context(viewport={'width':width,'height':height},color_scheme='dark')
  c.add_init_script("localStorage.setItem('claude-webui-auth',JSON.stringify({state:{token:'memory-browser-fixture'},version:0}))")
  page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  def request(path,method='GET',body=None):
   return c.request.fetch(fixture['url']+path,method=method,headers={'Authorization':'Bearer '+fixture['token'],'Content-Type':'application/json'},data=json.dumps(body) if body is not None else None)
  def route_api(route):
   path=urlsplit(route.request.url).path
   if path.startswith('/api/assistant/'):
    response=c.request.fetch(fixture['url']+path+('?' + urlsplit(route.request.url).query if urlsplit(route.request.url).query else ''),method=route.request.method,headers={'Authorization':'Bearer '+fixture['token'],'Content-Type':route.request.headers.get('content-type','application/json')},data=route.request.post_data_buffer)
    route.fulfill(status=response.status,headers={'content-type':response.headers.get('content-type','application/json')},body=response.body());return
   data=[]
   if path=='/auth/me':data={'id':'personal-alice','name':'Ada','email':'personal-alice@example.invalid','role':'admin'}
   elif path=='/api/basic-auth/status':data={'enabled':False}
   elif 'settings' in path:data={}
   route.fulfill(content_type='application/json',body=json.dumps({'success':True,'data':data}))
  page.route('**/api/**',route_api);page.route('**/auth/me',route_api);page.route('**/socket.io/**',lambda r:r.abort())
  page.goto(root+'/chat/personalization');expect(page.get_by_role('heading',name='Personalisierung',exact=True)).to_be_visible(timeout=60000)
  for name in ['Erinnerungen verwenden','Aus Gesprächen lernen','Frühere Chats berücksichtigen','Meinen Schreibstil berücksichtigen','Meinen Schreibstil lernen','Erinnerungen mit beauftragten Schwarm-Agenten teilen']:
   control=page.get_by_role('switch',name=name,exact=True)
   if control.get_attribute('aria-checked')!='true':control.click()
  page.get_by_label('Wie soll Plum dich nennen?').fill('Memory '+label)
  page.get_by_role('button',name='Speichern',exact=True).click();expect(page.get_by_role('status')).to_contain_text('Gespeichert')
  page.reload();expect(page.get_by_role('switch',name='Aus Gesprächen lernen',exact=True)).to_have_attribute('aria-checked','true')
  page.get_by_role('button',name='Verwalten',exact=True).click()
  page.get_by_label('Titel',exact=True).fill('Erinnerung '+label);page.get_by_label('Neue Erinnerung',exact=True).fill('Ich mag lange Antworten.')
  page.get_by_role('button',name='Erinnerung speichern',exact=True).click();expect(page.get_by_role('heading',name='Erinnerung '+label,exact=True)).to_be_visible()
  entry=page.locator('article.memory-entry').filter(has=page.get_by_role('heading',name='Erinnerung '+label,exact=True))
  entry.get_by_role('button',name='Bearbeiten',exact=True).click();entry.get_by_label('Titel bearbeiten').fill('Antwortstil '+label);entry.get_by_label('Erinnerung bearbeiten').fill('Ich bevorzuge kurze Antworten.')
  entry.get_by_role('button',name='Korrektur speichern').click();expect(page.get_by_role('heading',name='Antwortstil '+label,exact=True)).to_be_visible()
  result=request('/api/assistant/memory').json()['data'];assert any(r['title']=='Antwortstil '+label and r['body']['pinned'] and r['body']['text']=='Ich bevorzuge kurze Antworten.' for r in result)
  response=request('/api/assistant/memory','POST',{'title':'Hermes-Wissen '+label,'body':{'text':'Hermes übernimmt Telefonaufträge.','scope':'agent','agentId':'hermes'}});assert response.status==201
  page.reload();page.get_by_role('button',name='Verwalten',exact=True).click()
  agent=page.locator('article.memory-entry').filter(has=page.get_by_role('heading',name='Hermes-Wissen '+label,exact=True))
  agent.get_by_role('button',name='Ins persönliche Gedächtnis übernehmen').click();expect(page.get_by_role('heading',name='Hermes-Wissen '+label,exact=True)).to_have_count(2)
  page.screenshot(path=f'reports/plum-memory-{viewport_label}-2026-10-11.png',full_page=True)
  assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
  assert page.get_by_role('dialog').evaluate('(el)=>el.scrollWidth <= el.clientWidth + 1'), 'Dialog content overflows viewport'
  page.get_by_role('button',name='Bestehende Chats einlesen',exact=True).click();expect(page.get_by_text('Dafür fallen Modellkosten an oder',exact=False)).to_be_visible()
  page.get_by_role('button',name='Abbrechen',exact=True).click()
  page.get_by_role('button',name='Gelernten Chatverlauf und Schreibstil löschen',exact=True).click();page.get_by_role('button',name='Jetzt dauerhaft löschen',exact=True).click()
  expect(page.get_by_role('heading',name='Antwortstil '+label,exact=True)).to_be_visible()
  entry=page.locator('article.memory-entry').filter(has=page.get_by_role('heading',name='Antwortstil '+label,exact=True));entry.get_by_role('button',name='Vergessen',exact=True).click();expect(page.get_by_role('heading',name='Antwortstil '+label,exact=True)).to_have_count(0)
  page.get_by_role('button',name='Persönliches und Projektgedächtnis löschen',exact=True).click();page.get_by_role('button',name='Jetzt dauerhaft löschen',exact=True).click();expect(page.get_by_role('heading',name='Hermes-Wissen '+label,exact=True)).to_have_count(1)
  assert not errors,errors
  print('PASS memory '+viewport_label+': persisted opt-ins, model selection, real REST correction/pinning, agent import, forget, separate history clear, full clear, cost confirmation and no overflow',flush=True)
  c.close()
 browser.close()
