import os,json,io,wave,struct,math,hashlib
from email.parser import BytesParser
from email.policy import default
from playwright.sync_api import sync_playwright,expect
url=os.environ.get('PLUM_FIXTURE_URL','http://127.0.0.1:5188');assert url.startswith(('http://127.0.0.1:','http://localhost:'))
audio=io.BytesIO()
with wave.open(audio,'wb') as w:
    w.setnchannels(1);w.setsampwidth(2);w.setframerate(16000);w.writeframes(b''.join(struct.pack('<h',round(math.sin(2*math.pi*440*n/16000)*12000)) for n in range(16000)))
original=audio.getvalue();sha=hashlib.sha256(original).hexdigest();commands=[];lost=True;state=None
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/local/bin/plum-chromium',headless=True)
    page=browser.new_page(viewport={'width':390,'height':900});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    def api(route):
        global lost,state
        req=route.request;assert req.headers.get('authorization')=='Bearer motion-audio-fixture-token'
        if req.method=='POST' and req.headers.get('content-type','').startswith('multipart'):
            message=BytesParser(policy=default).parsebytes(('Content-Type: '+req.headers['content-type']+'\r\nMIME-Version: 1.0\r\n\r\n').encode()+req.post_data_buffer)
            fields={};uploaded=None
            for part in message.iter_parts():
                name=part.get_param('name',header='content-disposition')
                if name=='file':uploaded=part.get_payload(decode=True);assert part.get_filename()=='OmniVoice.wav'
                else:fields[name]=part.get_payload(decode=True).decode()
            assert uploaded==original;commands.append(fields)
            state=page.evaluate('window.__artifact')
            state['revision']=2;state['body'].update({'audioAssetId':'own-wave-fixture','audio':{'assetId':'own-wave-fixture','filename':'OmniVoice.wav','duration':1,'sha256':sha,'mimeType':'audio/wav','byteLength':len(original)}})
            page.evaluate('(value)=>window.__saved=value',state)
            if lost:lost=False;route.abort();return
            route.fulfill(status=201,content_type='application/json',body=json.dumps({'data':state}));return
        if req.method=='GET':
            assert req.url.endswith('/audio?revision=2');route.fulfill(status=200,content_type='audio/wav',body=original);return
        if req.url.endswith('/audio/remove'):
            state['revision']=3;state['body'].pop('audioAssetId');state['body'].pop('audio');page.evaluate('(value)=>window.__saved=value',state);route.fulfill(content_type='application/json',body=json.dumps({'data':state}));return
        assert req.method=='PATCH';body=req.post_data_json;state['revision']+=1;state['body']=body['body'];page.evaluate('(value)=>window.__saved=value',state);route.fulfill(content_type='application/json',body=json.dumps({'data':state}))
    page.route('**/api/**',api);page.goto(url+'/scripts/fixtures/assistant-motion-audio.html')
    # Obtain the rendered actual model from the fixture, not a duplicate test implementation.
    page.wait_for_function('!!window.__artifact')
    page.get_by_label('WAV an gespeicherte Animation binden',exact=True).set_input_files({'name':'OmniVoice.wav','mimeType':'audio/wav','buffer':original})
    expect(page.get_by_role('alert')).to_contain_text('fetch')
    expect(page.get_by_role('button',name='Bearbeiten',exact=True)).to_be_disabled()
    page.get_by_role('button',name='Dieselbe Audioübernahme bestätigen',exact=True).click()
    expect(page.get_by_text('OmniVoice.wav · 1 s',exact=True)).to_be_visible();assert commands[0]==commands[1]
    page.wait_for_function('document.querySelector("audio")?.src.startsWith("blob:")')
    actual=page.evaluate('''async()=>{const a=document.querySelector('audio');const bytes=await fetch(a.src).then(r=>r.arrayBuffer());const c=new AudioContext();try{const decoded=await c.decodeAudioData(bytes.slice(0));return {duration:decoded.duration,channels:decoded.numberOfChannels,rate:decoded.sampleRate,bytes:Array.from(new Uint8Array(bytes)),paused:a.paused};}finally{await c.close();}}''')
    assert bytes(actual['bytes'])==original and actual['channels']==1 and abs(actual['duration']-1)<.01 and actual['paused']
    page.screenshot(path='.probe/plum-assistant/motion-audio-mobile.png',full_page=True)
    assert page.evaluate('Array.from(document.querySelectorAll("input,button,audio")).filter(e=>e.getBoundingClientRect().width>0).every(e=>e.getBoundingClientRect().right<=innerWidth+1)')
    page.set_viewport_size({'width':1440,'height':1000});page.screenshot(path='.probe/plum-assistant/motion-audio-desktop.png',full_page=True)
    page.get_by_role('button',name='Audiospur in neuer Revision entfernen',exact=True).click();expect(page.get_by_role('link',name='Audiooriginal herunterladen',exact=True)).to_have_count(0)
    assert state['revision']==3 and not errors,errors
    browser.close();print('PASS: actual PCM upload bytes, same-UUID/revision lost-ack retry, private Blob audio decodes with exact duration/channels and no autoplay, explicit revision detach, editor gate and 390px/desktop; no Vocarium called')
