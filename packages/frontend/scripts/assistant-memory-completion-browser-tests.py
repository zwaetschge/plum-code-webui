import os,json,uuid
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright,expect
fixture=json.loads(Path(os.environ['PLUM_PERSONALIZATION_FIXTURE_RECORD']).read_text())
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/local/bin/plum-chromium',headless=True)
 for width,height,label in [(1440,1000,'desktop'),(390,844,'mobile'),(320,700,'narrow')]:
  c=browser.new_context(viewport={'width':width,'height':height},color_scheme='dark',accept_downloads=True)
  c.add_init_script("localStorage.setItem('claude-webui-auth',JSON.stringify({state:{token:'completion-browser-fixture'},version:0}))")
  page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  def request(path,method='GET',body=None):
   return c.request.fetch(fixture['url']+path,method=method,headers={'Authorization':'Bearer '+fixture['token'],'Content-Type':'application/json'},data=json.dumps(body) if body is not None else None)
  def route_api(route):
   u=urlsplit(route.request.url);path=u.path
   if path.startswith('/api/assistant/'):
    r=c.request.fetch(fixture['url']+path+('?' + u.query if u.query else ''),method=route.request.method,headers={'Authorization':'Bearer '+fixture['token'],'Content-Type':route.request.headers.get('content-type','application/json')},data=route.request.post_data_buffer)
    route.fulfill(status=r.status,headers={'content-type':r.headers.get('content-type','application/json')},body=r.body());return
   data=[]
   if path=='/auth/me':data={'id':'personal-alice','name':'Ada','email':'personal-alice@example.invalid','role':'admin'}
   elif path=='/api/basic-auth/status':data={'enabled':False}
   elif 'settings' in path:data={}
   route.fulfill(content_type='application/json',body=json.dumps({'success':True,'data':data}))
  page.route('**/api/**',route_api);page.route('**/auth/me',route_api);page.route('**/socket.io/**',lambda r:r.abort())
  if label=='desktop':
   notes=[{'title':f'Archiv {i:03}', 'text':f'Notiz {i:03}: Ich bevorzuge ruhige Spaziergänge.'} for i in range(106)]
   r=request('/api/assistant/memory-system/transfer','POST',{'filename':'archive-fixture.json','text':json.dumps({'memories':notes})});assert r.status==200,r.text()
  page.goto(os.environ.get('PLUM_FIXTURE_URL','http://127.0.0.1:5188')+'/chat/personalization');expect(page.get_by_role('heading',name='Personalisierung',exact=True)).to_be_visible(timeout=60000)
  page.get_by_role('button',name='Verwalten',exact=True).click()
  page.get_by_role('button',name='Weitere Erinnerungen laden',exact=True).click();expect(page.get_by_role('heading',name='Archiv 000',exact=True)).to_be_visible()
  page.get_by_label('Erinnerungen durchsuchen',exact=True).fill('Archiv 000');expect(page.locator('article.memory-entry')).to_have_count(1)
  page.get_by_text('Gedächtnis importieren und exportieren',exact=True).click()
  name='Lieblingsfarbe '+label+' '+uuid.uuid4().hex[:5]
  page.get_by_label('Erinnerungsdatei importieren',exact=True).set_input_files({'name':'memory-fixture.json','mimeType':'application/json','buffer':json.dumps({'memories':[{'title':name,'text':'Meine Lieblingsfarbe ist Türkis. Testnotiz '+name}]}).encode()})
  expect(page.get_by_text('1 übernommen, 0 bereits vorhanden, 0 abgewiesen.',exact=True)).to_be_visible()
  page.get_by_label('Erinnerungen durchsuchen',exact=True).fill(name);expect(page.get_by_role('heading',name=name,exact=True)).to_be_visible()
  with page.expect_download() as downloaded:page.get_by_role('button',name='Alle Erinnerungen exportieren',exact=True).click()
  export=json.loads(Path(downloaded.value.path()).read_text());assert export['format']=='plum-memory' and len(export['memories'])>=107
  page.get_by_text('Originalgedächtnisse von Hermes und Schwarm',exact=True).click()
  # This account is not the verified Matrix operator; original stores must stay inaccessible.
  expect(page.get_by_role('alert')).to_contain_text('Betreiber')
  page.get_by_text('Frühere Chats und gelernter Schreibstil',exact=True).click();expect(page.get_by_label('Gelernten Gesprächskontext durchsuchen',exact=True)).to_be_visible()
  assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
  page.screenshot(path=f'reports/plum-memory-complete-{label}-2026-10-11.png',full_page=True)
  assert page.get_by_role('dialog').evaluate('(el)=>el.scrollWidth<=el.clientWidth+1'),page.get_by_role('dialog').evaluate('(el)=>Array.from(el.querySelectorAll("*")).filter(x=>x.getBoundingClientRect().right>el.getBoundingClientRect().right).map(x=>({tag:x.tagName,cls:x.className,width:x.getBoundingClientRect().width,text:x.textContent?.slice(0,60)}))')
  page.screenshot(path=f'reports/plum-memory-complete-{label}-2026-10-11.png',full_page=True)
  assert not errors,errors
  print('PASS '+label+': 100+ pagination, server search, file import, complete export/download, native ownership boundary, history search, no overflow',flush=True)
  c.close()
 browser.close()
