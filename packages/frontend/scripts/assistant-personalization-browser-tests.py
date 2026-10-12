import os,json,base64
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright,expect
root=os.environ.get('PLUM_FIXTURE_URL','http://127.0.0.1:5188')
fixture=json.loads(Path(os.environ['PLUM_PERSONALIZATION_FIXTURE_RECORD']).read_text())
assert fixture['url'].startswith('http://127.0.0.1:')
user={'id':'personal-alice','name':'Ada','email':'personal-alice@example.invalid','role':'admin'}
providers=[{'id':'codex','name':'Codex','available':True,'enabled':True,'models':['gpt-5.5'],'defaultModel':'gpt-5.5'}]
pixel=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=')
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/local/bin/plum-chromium',headless=True,args=['--remote-debugging-port=9228','--remote-debugging-address=127.0.0.1'] if os.environ.get('PLUM_REA_BROWSER') else [])
 for width,height,label in [(1440,1000,'desktop'),(390,844,'mobile'),(320,700,'narrow')]:
  context=browser.new_context(viewport={'width':width,'height':height},color_scheme='dark')
  context.add_init_script("localStorage.setItem('claude-webui-auth',JSON.stringify({state:{token:'personal-browser-fixture'},version:0}))")
  page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  def route_api(route):
   request=route.request;path=urlsplit(request.url).path
   if path.startswith('/api/assistant/personalization') or path.startswith('/api/assistant/memory') or path.startswith('/api/assistant/api-chat-providers'):
    response=context.request.fetch(fixture['url']+path,method=request.method,headers={'Authorization':'Bearer '+fixture['token'],'Content-Type':request.headers.get('content-type','application/json')},data=request.post_data_buffer)
    route.fulfill(status=response.status,headers={'content-type':response.headers.get('content-type','application/json')},body=response.body());return
   data={} if 'settings' in path else []
   if path=='/auth/me':data=user
   elif path=='/api/basic-auth/status':data={'enabled':False}
   elif path=='/api/cli-providers':data=providers
   route.fulfill(content_type='application/json',body=json.dumps({'success':True,'data':data}))
  page.route('**/api/**',route_api);page.route('**/auth/me',route_api);page.route('**/socket.io/**',lambda r:r.abort())
  page.goto(root+'/chat/personalization')
  expect(page.get_by_role('heading',name='Personalisierung',exact=True)).to_be_visible(timeout=60000)
  expect(page.get_by_role('switch',name='Erinnerungen verwenden')).to_be_visible()
  page.get_by_label('Wie soll Plum dich nennen?').fill('Vale '+label)
  page.get_by_label('Herzlichkeit',exact=True).select_option('more')
  page.get_by_role('button',name='Plum Chat',exact=True).click()
  page.get_by_role('textbox',name='Benutzerdefinierte Anweisungen',exact=True).fill('Antworte auf Schweizer Hochdeutsch. '+label)
  page.keyboard.press('Escape');expect(page.get_by_role('dialog')).to_have_count(0)
  page.get_by_role('button',name='Schreibprobe',exact=False).click()
  page.get_by_role('textbox',name='Deine Schreibprobe',exact=True).fill('Das ist mein Schreibstil. '+label)
  page.get_by_role('button',name='Fertig',exact=True).click()
  voice=page.get_by_role('switch',name='Sprachchat',exact=True)
  if voice.get_attribute('aria-checked')=='true':voice.click()
  prompts=page.get_by_role('switch',name='Vorgeschlagene Prompts',exact=True)
  if prompts.get_attribute('aria-checked')=='true':prompts.click()
  page.get_by_role('button',name='Speichern',exact=True).click()
  expect(page.get_by_role('status')).to_contain_text('Gespeichert',timeout=15000)
  page.reload();expect(page.get_by_label('Wie soll Plum dich nennen?')).to_have_value('Vale '+label)
  page.locator('.personalization-page').evaluate('(e)=>e.scrollTop=0')
  expect(page.get_by_role('heading',name='Personalisierung',exact=True)).to_be_visible()
  assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
  page.screenshot(path=f'.probe/plum-assistant/personalization-{label}.png',full_page=True)
  page.get_by_role('button',name='Verwalten',exact=True).click()
  expect(page.get_by_role('dialog',name='Erinnerungen',exact=True)).to_be_visible()
  page.get_by_label('Titel',exact=True).fill('Erinnerung '+label)
  page.get_by_label('Neue Erinnerung',exact=True).fill('Mein bevorzugter Stil '+label)
  page.get_by_role('button',name='Erinnerung speichern',exact=True).click()
  expect(page.get_by_role('heading',name='Erinnerung '+label,exact=True)).to_be_visible()
  page.keyboard.press('Escape')
  page.get_by_label('Referenzfoto hinzufügen',exact=True).set_input_files({'name':'mein-portrait.png','mimeType':'image/png','buffer':pixel})
  expect(page.get_by_text('mein-portrait.png',exact=True)).to_be_visible()
  page.get_by_role('link',name='Zurück zum Chat',exact=True).click()
  page.get_by_role('button',name='Gesprächsoptionen',exact=True).click()
  page.get_by_role('button',name='Referenzfoto anhängen',exact=True).click()
  page.get_by_role('button',name='Fertig',exact=True).click()
  expect(page.get_by_text('mein-portrait.png',exact=True)).to_be_visible()
  page.goto(root+'/chat/personalization')
  page.get_by_role('button',name='Referenzfoto entfernen',exact=True).click()
  expect(page.get_by_text('mein-portrait.png',exact=True)).to_have_count(0)
  page.get_by_role('link',name='Zurück zum Chat',exact=True).click()
  expect(page.get_by_role('heading',name='Hallo Vale '+label+', was beschäftigt dich heute?',exact=True)).to_be_visible()
  expect(page.get_by_role('button',name='Sprache',exact=True)).to_be_disabled()
  expect(page.get_by_role('button',name='Plane mit mir meinen Tag',exact=True)).to_have_count(0)
  if width>=768:page.get_by_role('button',name='Personalisierung öffnen',exact=True).click()
  else:
   page.get_by_role('button',name='Navigation öffnen',exact=True).click()
   page.get_by_role('link',name='Personalisierung',exact=True).click()
  expect(page).to_have_url(root+'/chat/personalization')
  assert not errors,errors
  print('PASS personalisation',label,'real isolated REST save/reload, scoped instructions, writing sample, memory CRUD, photo upload/remove, chat nickname, voice/prompts withdrawal, keyboard and no overflow',flush=True)
  if os.environ.get('PLUM_REA_BROWSER') and label=='narrow':
   page.set_viewport_size({'width':1440,'height':1000})
   print('REA personalisation preview ready',flush=True)
   while True:page.wait_for_timeout(1000)
  context.close()
 browser.close()
