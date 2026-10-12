"""Run against an isolated Vite instance, never the live Plum service."""
import os,json,struct
from playwright.sync_api import sync_playwright,expect
url=os.environ.get('PLUM_FIXTURE_URL','http://127.0.0.1:5188')
assert url.startswith(('http://127.0.0.1:','http://localhost:')), 'Fixture must be loopback'
fake='''
window.__recorders=[];window.__streams=[];window.__micCalls=0;
Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>{window.__micCalls++;await new Promise(r=>setTimeout(r,80));const track={stopped:false,stop(){this.stopped=true;}};const stream={getTracks:()=>[track]};window.__streams.push(stream);return stream;}}});
window.MediaRecorder=class {constructor(stream){this.stream=stream;this.state='inactive';this.mimeType='audio/webm';window.__recorders.push(this);}start(){this.state='recording';}stop(){if(this.state!=='recording')return;this.state='inactive';queueMicrotask(()=>{this.ondataavailable?.({data:new Blob(['test recording'])});this.onstop?.();});}};
window.AudioContext=class {state='running';createAnalyser(){return {fftSize:1024,getFloatTimeDomainData(buffer){buffer.fill(0);}};}createMediaStreamSource(){return {connect(){}};}async close(){this.state='closed';}};
HTMLMediaElement.prototype.play=function(){return Promise.resolve();};HTMLMediaElement.prototype.pause=function(){};
'''
wav=b'RIFF'+struct.pack('<I',36)+b'WAVEfmt '+struct.pack('<IHHIIHH',16,1,1,8000,16000,2,16)+b'data'+struct.pack('<I',0)
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/local/bin/plum-chromium',headless=True)
    page=browser.new_page(viewport={'width':390,'height':844});page.add_init_script(fake)
    speech=[];transcripts=[];held=[];hold=False
    def api(route):
        global hold
        path=route.request.url
        if path.endswith('/voice/speech'):
            speech.append(json.loads(route.request.post_data)['text']);route.fulfill(content_type='audio/wav',body=wav)
        elif path.endswith('/voice/transcribe'):
            transcripts.append(path)
            if hold:held.append(route)
            else:route.fulfill(content_type='application/json',body=json.dumps({'data':{'text':'Äpfel essen'}}))
        else:route.abort()
    page.route('**/api/**',api)
    page.goto(url+'/scripts/fixtures/assistant-voice.html');expect(page.get_by_role('heading',name='Voice verification fixture')).to_be_visible()
    page.get_by_role('button',name='Nachricht einsprechen',exact=True).click();expect(page.get_by_text('Das Mikrofon nimmt auf.',exact=True)).to_be_visible()
    page.get_by_role('button',name='Aufnahme verwerfen',exact=True).click();page.wait_for_timeout(150);assert not transcripts
    page.get_by_role('button',name='Nachricht einsprechen',exact=True).click();expect(page.get_by_text('Das Mikrofon nimmt auf.',exact=True)).to_be_visible()
    page.get_by_role('button',name='Aufnahme beenden und transkribieren').click();expect(page.get_by_label('Diktat')).to_have_text('Äpfel essen');expect(page.get_by_label('Gesendet')).to_have_text('')
    page.get_by_role('button',name='Mit OmniVoice vorlesen').click()
    for n in range(3):
        expect(page.locator('audio')).to_have_attribute('src',__import__('re').compile(r'blob:'))
        page.wait_for_timeout(150)
        page.locator('audio').evaluate("audio=>audio.dispatchEvent(new Event('ended'))")
    page.wait_for_timeout(250);assert ''.join(speech)=='Langer Text '*1100;assert all(len(s)<=4500 for s in speech)
    hold=True
    page.get_by_role('button',name='Nachricht einsprechen',exact=True).click();expect(page.get_by_text('Das Mikrofon nimmt auf.',exact=True)).to_be_visible()
    page.get_by_role('button',name='Aufnahme beenden und transkribieren').click();expect(page.get_by_text('Vocarium verarbeitet die Aufnahme …',exact=True)).to_be_visible()
    page.get_by_role('button',name='Chat wechseln').click()
    for route in held:
        try:route.fulfill(content_type='application/json',body=json.dumps({'data':{'text':'STALE WRONG CHAT'}}))
        except Exception:pass
    hold=False;page.wait_for_timeout(200);expect(page.get_by_label('Diktat')).to_have_text('Äpfel essen')
    # Ending while getUserMedia is pending must stop the eventual stream.
    page.get_by_role('button',name='Sprachgespräch starten',exact=True).click();page.get_by_role('button',name='Sprachgespräch beenden',exact=True).click();page.wait_for_timeout(200)
    assert page.evaluate('window.__streams.every(stream=>stream.getTracks().every(track=>track.stopped))')
    before=page.evaluate('window.__micCalls');page.get_by_role('button',name='Sprachgespräch starten',exact=True).click();expect(page.get_by_text('Das Mikrofon nimmt auf.',exact=True)).to_be_visible()
    assert page.evaluate('window.__micCalls')==before+1
    page.evaluate('window.__recorders.at(-1).stop()');expect(page.get_by_label('Gesendet')).to_have_text('Äpfel essen')
    page.get_by_role('button',name='Antwort abschliessen').click();page.wait_for_timeout(350);assert speech[-1]=='Die Antwort ist vollständig.'
    page.locator('audio').evaluate("audio=>audio.dispatchEvent(new Event('ended'))");expect(page.get_by_text('Das Mikrofon nimmt auf.',exact=True)).to_be_visible()
    page.get_by_role('button',name='Sprachgespräch beenden',exact=True).click();page.wait_for_timeout(100)
    assert page.evaluate('window.__streams.every(stream=>stream.getTracks().every(track=>track.stopped))')
    assert not page.get_by_text('Invalid hook call').count()
    print('PASS: discarded recording, manual draft, complete long reading, stale-ASR scope rejection, pending microphone cancellation and turn-based OmniVoice conversation')
    browser.close()
