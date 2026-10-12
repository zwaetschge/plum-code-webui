from playwright.sync_api import sync_playwright,expect
root='http://127.0.0.1:5188'
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/local/bin/plum-chromium',headless=True)
 for mode in ['pending-permission','active-recording','pending-response','normal']:
  context=browser.new_context();page=context.new_page();requests=[];held=[];errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.add_init_script('''window.stoppedTracks=0;window.fakeStream={getTracks:()=>[{stop:()=>window.stoppedTracks++}]};
   window.mediaPending=new Promise(resolve=>window.resolveMedia=()=>resolve(window.fakeStream));
   Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:()=>window.mediaPending},configurable:true});
   window.MediaRecorder=class {constructor(stream){this.state='inactive';this.mimeType='audio/webm';} start(){this.state='recording';} stop(){this.state='inactive';if(this.ondataavailable)this.ondataavailable({data:new Blob(['recorded-audio'])});queueMicrotask(()=>{if(this.onstop)this.onstop();});}};
  ''')
  page.route('**/voice-policy-test',lambda r:r.fulfill(content_type='text/html',body='<html><body><div id="root"></div><script type="module" src="/scripts/fixtures/voice-policy-harness.tsx"></script></body></html>'))
  def transcribe(route):
   if route.request.url.endswith('/status'):route.fulfill(json={'success':True,'data':{'available':True}})
   else:
    requests.append(route.request)
    if mode=='pending-response':held.append(route)
    else:route.fulfill(json={'success':True,'data':{'text':'Erkannter Text'}})
  if mode=='pending-response':page.add_init_script("const originalFetch=window.fetch;window.fetch=(url,config)=>String(url).endsWith('/api/transcribe')?new Promise(resolve=>window.completeSpeech=()=>resolve(new Response(JSON.stringify({success:true,data:{text:'Altes Transkript'}}),{headers:{'Content-Type':'application/json'}}))):originalFetch(url,config);")
  page.route('**/api/transcribe**',transcribe)
  page.goto(root+'/voice-policy-test');button=page.get_by_role('button',name='Aufnahme',exact=True);expect(button).to_be_enabled(timeout=60000)
  if mode!='pending-permission':page.evaluate('window.resolveMedia()')
  button.click()
  if mode=='pending-permission':
   page.get_by_label('Sprachchat').uncheck();page.evaluate('window.resolveMedia()')
  elif mode=='active-recording':
   expect(button).to_have_attribute('aria-pressed','true');page.get_by_label('Sprachchat').uncheck()
  else:
   expect(button).to_have_attribute('aria-pressed','true');button.click()
   if mode=='pending-response':
    expect(page.locator('span[role=status]')).to_have_text('Transkription läuft')
    page.get_by_role('button',name='Gespräch wechseln',exact=True).click()
    page.wait_for_timeout(200)
    page.evaluate('window.completeSpeech()')
   else:expect(page.get_by_label('Transkript')).to_have_text('Erkannter Text')
  page.wait_for_timeout(250)
  assert page.evaluate('window.stoppedTracks')>0
  if mode in ['pending-permission','active-recording']:assert len(requests)==0
  if mode!='normal':expect(page.get_by_label('Transkript')).to_be_empty()
  assert not errors,errors
  print('PASS voice personalisation',mode,'mic released, withdrawn audio not uploaded/applied, happy path retained',flush=True)
  context.close()
 browser.close()
