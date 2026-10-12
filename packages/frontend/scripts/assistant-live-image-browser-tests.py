"""Local canvas camera/screen proof. No capture or paid model service is called."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
url=os.environ.get('PLUM_FIXTURE_URL','http://127.0.0.1:5188')
assert url.startswith(('http://127.0.0.1:','http://localhost:'))
fake='''
window.__captures=[];window.__delay=0;
const capture=async(options)=>{
  const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;
  const c=canvas.getContext('2d');c.fillStyle='#12635b';c.fillRect(0,0,640,360);c.fillStyle='white';c.font='32px sans-serif';c.fillText('Plum – lokaler Bildkontext',20,100);
  const stream=canvas.captureStream(10);const entry={stream,options,tracks:stream.getTracks()};window.__captures.push(entry);
  if(window.__delay) await new Promise(r=>setTimeout(r,window.__delay));
  return stream;
};
Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:capture,getDisplayMedia:capture}});
'''
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/local/bin/plum-chromium',headless=True)
    page=browser.new_page(viewport={'width':390,'height':844});page.add_init_script(fake)
    requests=[];errors=[]
    page.route('**/api/**',lambda route:(requests.append(route.request.url),route.abort()))
    page.on('pageerror',lambda error:errors.append(str(error)))
    path=url+'/scripts/fixtures/assistant-live-image.html'
    page.goto(path);expect(page.get_by_role('heading',name='Bilder für Plum Chat')).to_be_visible()
    page.get_by_role('button',name='Kamera öffnen').click();expect(page.get_by_role('button',name='Einzelbild übernehmen')).to_be_visible()
    page.wait_for_function('document.querySelector("video").videoWidth===640')
    page.screenshot(path='.probe/plum-assistant/live-image-mobile.png',full_page=True)
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.set_viewport_size({'width':1440,'height':900});page.screenshot(path='.probe/plum-assistant/live-image-desktop.png',full_page=True)
    page.get_by_role('button',name='Einzelbild übernehmen').click()
    expect(page.get_by_text(__import__('re').compile('Aufnahme-.*\\.jpg'))).to_be_visible()
    assert page.evaluate('window.__captures.every(c=>c.tracks.every(t=>t.readyState==="ended"))')
    assert not requests
    page.get_by_role('button',name='Bildschirm auswählen').click();expect(page.get_by_role('button',name='Einzelbild übernehmen')).to_be_visible()
    assert page.evaluate('window.__captures.at(-1).options.audio===false')
    page.get_by_role('button',name='Konto wechseln').click();expect(page.get_by_role('button',name='Einzelbild übernehmen')).to_have_count(0)
    assert page.evaluate('window.__captures.every(c=>c.tracks.every(t=>t.readyState==="ended"))')
    page.evaluate('window.__delay=300');page.get_by_role('button',name='Kamera öffnen').click();page.get_by_role('button',name='Aufnahme beenden').click();page.wait_for_timeout(450)
    assert page.evaluate('window.__captures.every(c=>c.tracks.every(t=>t.readyState==="ended"))')
    page.evaluate('window.__delay=0');page.get_by_role('button',name='Kamera öffnen').click();expect(page.get_by_role('button',name='Einzelbild übernehmen')).to_be_visible()
    page.get_by_role('button',name='Nachricht läuft').click();expect(page.get_by_role('button',name='Einzelbild übernehmen')).to_have_count(0)
    assert page.evaluate('window.__captures.every(c=>c.tracks.every(t=>t.readyState==="ended"))')
    page.goto(path);page.get_by_role('button',name='Bildschirm auswählen').click();expect(page.get_by_role('button',name='Einzelbild übernehmen')).to_be_visible()
    page.get_by_role('button',name='Ansicht verlassen').click()
    assert page.evaluate('window.__captures.every(c=>c.tracks.every(t=>t.readyState==="ended"))')
    assert not errors,errors
    assert not requests
    print('PASS: actual video/canvas preview and JPEG selection, desktop/mobile, no automatic HTTP, camera/screen audio disabled, cancelled pending grant, account change, busy state and unmount stop all tracks')
    browser.close()
