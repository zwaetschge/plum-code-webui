"""Actual local canvas/video frames. Native OS picker is a fixture, no capture service or model is called."""
import os
from playwright.sync_api import sync_playwright,expect
url=os.environ.get('PLUM_FIXTURE_URL','http://127.0.0.1:5188');assert url.startswith(('http://127.0.0.1:','http://localhost:'))
fake='''
window.__captures=[];window.__surface='window';window.__delay=0;
const capture=async(options)=>{
 const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;
 const c=canvas.getContext('2d');c.fillStyle='#12635b';c.fillRect(0,0,640,360);c.fillStyle='white';c.font='32px sans-serif';c.fillText('Ausgewähltes Appfenster',20,100);
 const stream=canvas.captureStream(10),track=stream.getVideoTracks()[0];
 const getSettings=track.getSettings.bind(track);track.getSettings=()=>({...getSettings(),displaySurface:window.__surface});
 Object.defineProperty(track,'label',{value:'Notizen – ausgewähltes Fenster'});
 window.__captures.push({stream,options,tracks:stream.getTracks()});
 if(window.__delay) await new Promise(r=>setTimeout(r,window.__delay));return stream;
};
Object.defineProperty(navigator,'mediaDevices',{value:{getDisplayMedia:capture}});
'''
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/local/bin/plum-chromium',headless=True)
    page=browser.new_page(viewport={'width':390,'height':844});page.add_init_script(fake)
    requests=[];errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.route('**/api/**',lambda route:(requests.append(route.request.url),route.abort()))
    path=url+'/scripts/fixtures/assistant-screen-history.html'
    def open_panel():
        page.get_by_text('Fensterverlauf für eine Aufgabe aufnehmen',exact=True).click()
    def tracks_ended():
        page.wait_for_function('window.__captures.every(c=>c.tracks.every(t=>t.readyState==="ended"))')
    page.goto(path);page.clock.install();open_panel()
    page.get_by_role('button',name='Fensterverlauf starten',exact=True).click()
    expect(page.get_by_role('img',name='Lokales Fensterbild 1',exact=True)).to_be_visible()
    assert page.evaluate('window.__captures[0].options.audio===false')
    page.clock.fast_forward(16000)
    expect(page.get_by_role('img',name='Lokales Fensterbild 2',exact=True)).to_be_visible()
    page.get_by_role('button',name='Fensteraufnahme stoppen',exact=True).click();tracks_ended()
    page.get_by_label('Fensterbild 1 auswählen',exact=True).check();page.get_by_label('Fensterbild 2 auswählen',exact=True).check()
    page.screenshot(path='.probe/plum-assistant/screen-history-mobile.png',full_page=True)
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    assert page.evaluate('Array.from(document.querySelectorAll("button")).every(e=>e.getBoundingClientRect().right<=innerWidth+1)')
    page.set_viewport_size({'width':1440,'height':1000});page.screenshot(path='.probe/plum-assistant/screen-history-desktop.png',full_page=True)
    page.get_by_role('button',name='Ausgewählte Fensterbilder im Entwurf verwenden',exact=True).click()
    pixels=page.evaluate('''async()=>{const value=window.__chosen,f=value.files[0],bitmap=await createImageBitmap(f),c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;c.getContext('2d').drawImage(bitmap,0,0);return {count:value.files.length,mime:f.type,width:bitmap.width,height:bitmap.height,pixel:Array.from(c.getContext('2d').getImageData(0,0,1,1).data),context:value.context};}''')
    assert pixels['count']==2 and pixels['mime']=='image/png' and pixels['width']==640 and pixels['height']==360 and pixels['pixel']==[18,99,91,255],pixels
    assert 'Notizen' in pixels['context'] and 'Fenster-' in pixels['context']
    expect(page.get_by_role('img',name='Lokales Fensterbild 1',exact=True)).to_have_count(0)
    assert not requests
    # Guide conversion remains an editable local prompt, with actual selected frames.
    page.get_by_role('button',name='Fensterverlauf starten',exact=True).click()
    expect(page.get_by_role('img',name='Lokales Fensterbild 1',exact=True)).to_be_visible()
    page.get_by_role('button',name='Fensteraufnahme stoppen',exact=True).click();tracks_ended()
    page.get_by_label('Fensterbild 1 auswählen',exact=True).check()
    page.get_by_role('button',name='Wiederverwendbare Anleitung im Entwurf vorbereiten',exact=True).click()
    assert page.evaluate('window.__chosen.files.length')==1
    assert 'SKILL.md' in page.evaluate('window.__chosen.context') and 'nicht automatisch installiert' in page.evaluate('window.__chosen.context')
    assert not requests
    # Selecting a whole monitor is refused and immediately releases all tracks.
    page.evaluate("window.__surface='monitor'");page.get_by_role('button',name='Fensterverlauf starten',exact=True).click()
    expect(page.get_by_role('alert')).to_contain_text('ein einzelnes Fenster wählen');tracks_ended()
    page.evaluate("window.__surface='window'");page.get_by_role('button',name='Fensterverlauf starten',exact=True).click()
    expect(page.get_by_role('img',name='Lokales Fensterbild 1',exact=True)).to_be_visible()
    page.clock.fast_forward(61000);tracks_ended()
    expect(page.get_by_role('button',name='Fensteraufnahme stoppen',exact=True)).to_have_count(0)
    page.clock.fast_forward(31*60000)
    expect(page.get_by_role('img',name='Lokales Fensterbild 1',exact=True)).to_have_count(0)
    # Owner switch and closing the disclosure destroy the capture and local snapshots.
    page.get_by_role('button',name='Fensterverlauf starten',exact=True).click();expect(page.get_by_role('img',name='Lokales Fensterbild 1',exact=True)).to_be_visible()
    page.get_by_role('button',name='Konto wechseln',exact=True).click();tracks_ended();open_panel()
    expect(page.get_by_role('img',name='Lokales Fensterbild 1',exact=True)).to_have_count(0)
    page.get_by_role('button',name='Fensterverlauf starten',exact=True).click();expect(page.get_by_role('img',name='Lokales Fensterbild 1',exact=True)).to_be_visible()
    open_panel();tracks_ended();open_panel()
    expect(page.get_by_role('img',name='Lokales Fensterbild 1',exact=True)).to_have_count(0)
    page.get_by_role('button',name='Fensterverlauf starten',exact=True).click();expect(page.get_by_role('img',name='Lokales Fensterbild 1',exact=True)).to_be_visible()
    page.get_by_role('button',name='Antwort läuft',exact=True).click();tracks_ended()
    assert not errors,errors
    assert not requests
    print('PASS: real timed local window video→PNG frames and exact pixels, explicit selection without HTTP, monitor refusal, deadline/expiry, stop, account/disclosure/busy cleanup and desktop/mobile widths; OS picker not verified')
    browser.close()
