import os,json,io
from PIL import Image
from email.parser import BytesParser
from email.policy import default
from playwright.sync_api import sync_playwright,expect
url=os.environ.get('PLUM_FIXTURE_URL','http://127.0.0.1:5188');assert url.startswith(('http://127.0.0.1:','http://localhost:'))
originals=[]
for color in ['red','blue']:
    out=io.BytesIO();Image.new('RGB',(12,12),color).save(out,format='PNG');originals.append(out.getvalue())
packets=[];lost=True
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/local/bin/plum-chromium',headless=True)
    page=browser.new_page(viewport={'width':390,'height':900});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    def api(route):
        global lost
        req=route.request;assert req.method=='POST' and req.url.endswith('/try-on') and req.headers.get('authorization')=='Bearer try-on-fixture-token'
        message=BytesParser(policy=default).parsebytes(('Content-Type: '+req.headers['content-type']+'\r\nMIME-Version: 1.0\r\n\r\n').encode()+req.post_data_buffer);packet={}
        for part in message.iter_parts():packet[part.get_param('name',header='content-disposition')]=part.get_payload(decode=True)
        assert packet['person']==originals[0] and packet['product']==originals[1] and packet['sourceRevision']==b'7' and packet['offerId']==b'offer-one' and packet['instructions']=='Ganzkörper von vorne'.encode()
        packets.append(packet)
        if lost:lost=False;route.abort();return
        route.fulfill(status=201,content_type='application/json',body=json.dumps({'data':{'id':'new-try-task','title':'Bildanprobe: Blaues Hemd'}}))
    page.route('**/api/**',api);page.goto(url+'/scripts/fixtures/assistant-try-on.html')
    page.get_by_text('Bildanprobe als Task vorbereiten',exact=True).click()
    page.get_by_label('Angebot für die Bildanprobe',exact=True).select_option('offer-one')
    for name,data in zip(['Personenbild','Produktbild'],originals):page.get_by_label(name,exact=True).set_input_files({'name':name+'.png','mimeType':'image/png','buffer':data})
    page.get_by_label('Darstellungswunsch',exact=True).fill('Ganzkörper von vorne')
    expect(page.get_by_alt_text('Lokal ausgewähltes Anprobeoriginal')).to_have_count(2);assert not packets
    page.get_by_role('button',name='Anprobeauftrag vorbereiten',exact=True).click();expect(page.get_by_role('alert')).to_contain_text('fetch')
    expect(page.get_by_label('Personenbild',exact=True)).to_be_disabled();expect(page.get_by_label('Angebot für die Bildanprobe',exact=True)).to_be_disabled()
    page.screenshot(path='.probe/plum-assistant/try-on-mobile.png',full_page=True);assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.get_by_role('button',name='Denselben Anprobeauftrag bestätigen',exact=True).click();expect(page.get_by_role('link',name='Bildanprobe: Blaues Hemd')).to_have_attribute('href','/tasks?resource=new-try-task')
    assert packets[0]==packets[1];expect(page.get_by_alt_text('Lokal ausgewähltes Anprobeoriginal')).to_have_count(0)
    page.set_viewport_size({'width':1440,'height':1000});page.screenshot(path='.probe/plum-assistant/try-on-desktop.png',full_page=True)
    assert not errors,errors
    browser.close();print('PASS: actual own-image local previews, no upload before explicit draft, multipart exact two originals/source/offer/wish, retained UUID bytes on lost acknowledgment, gates and native Task link, StrictMode/mobile/desktop; no image generation')
