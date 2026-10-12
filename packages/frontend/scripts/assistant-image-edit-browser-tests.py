import io,json,os
from urllib.parse import urlsplit
from PIL import Image
from playwright.sync_api import sync_playwright,expect
url=os.environ.get('PLUM_FIXTURE_URL','http://127.0.0.1:5188');assert url.startswith(('http://127.0.0.1:','http://localhost:'))
output=io.BytesIO();Image.new('RGB',(256,192),(0,120,50)).save(output,format='PNG');png=output.getvalue()
requests=[];errors=[];lost=True;held=[];hold=False
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/local/bin/plum-chromium',headless=True);page=browser.new_page(viewport={'width':390,'height':844})
    page.on('pageerror',lambda error:errors.append(str(error)))
    def api(route):
        global lost
        request=route.request;path=urlsplit(request.url).path
        if request.method=='GET' and path.endswith('/images/image-fixture'):route.fulfill(content_type='image/png',body=png);return
        assert request.method=='POST' and path.endswith('/image-edit'),path
        data=request.post_data_json;requests.append(data)
        result={'data':{'id':'new-edit-task','kind':'task','revision':1,'title':'Bildbearbeitung','body':{'goal':data['prompt'],'status':'draft'},'createdAt':'','updatedAt':''}}
        if hold:held.append((route,result));return
        if lost:lost=False;route.abort('failed');return
        route.fulfill(content_type='application/json',body=json.dumps(result))
    page.route('**/api/**',api);page.goto(url+'/scripts/fixtures/assistant-image-edit.html')
    expect(page.get_by_role('img',name='Unverändertes Bildoriginal')).to_be_visible()
    page.get_by_label('Links (%)',exact=True).fill('90');page.get_by_label('Breite (%)',exact=True).fill('40')
    page.get_by_role('button',name='Bereich hinzufügen',exact=True).click();expect(page.get_by_role('alert')).to_contain_text('innerhalb')
    page.get_by_label('Links (%)',exact=True).fill('25');page.get_by_label('Oben (%)',exact=True).fill('10');page.get_by_label('Breite (%)',exact=True).fill('40');page.get_by_label('Höhe (%)',exact=True).fill('50')
    page.get_by_role('button',name='Bereich hinzufügen',exact=True).click();expect(page.get_by_text('1 markierte Bereiche',exact=True)).to_be_visible()
    page.get_by_label('Gewünschte Änderung',exact=True).fill('Die Mitte blau färben, den Rand erhalten.')
    svg=page.get_by_label('Bereiche auf dem Bild markieren',exact=True);bounds=svg.bounding_box()
    page.mouse.move(bounds['x']+bounds['width']*.1,bounds['y']+bounds['height']*.15);page.mouse.down();page.mouse.move(bounds['x']+bounds['width']*.2,bounds['y']+bounds['height']*.3);page.mouse.up()
    expect(page.get_by_text('2 markierte Bereiche',exact=True)).to_be_visible();assert svg.locator('rect').count()==2
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');page.screenshot(path='.probe/plum-assistant/image-edit-mobile.png',full_page=True)
    page.set_viewport_size({'width':1440,'height':1000});page.screenshot(path='.probe/plum-assistant/image-edit-desktop.png',full_page=True)
    page.get_by_role('button',name='Als neuen Task vorbereiten',exact=True).click();expect(page.get_by_role('alert')).to_be_visible()
    page.get_by_role('button',name='Als neuen Task vorbereiten',exact=True).click();expect(page.get_by_role('heading',name='Neuer Bildauftrag',exact=True)).to_be_visible()
    assert len(requests)==2 and requests[0]==requests[1] and requests[0]['rectangles'][0]=={'x':.25,'y':.1,'width':.4,'height':.5}
    expect(page.get_by_text('Entwurf – noch nicht gestartet',exact=True)).to_be_visible()
    page.reload();page.get_by_label('Bearbeitungsart',exact=True).select_option('edit');expect(page.get_by_label('Bereiche auf dem Bild markieren',exact=True)).to_have_count(0)
    page.get_by_label('Gewünschte Änderung',exact=True).fill('Als klare Zeichnung neu gestalten.');hold=True
    page.get_by_role('button',name='Als neuen Task vorbereiten',exact=True).click();expect(page.get_by_role('button',name='Wird vorbereitet …',exact=True)).to_be_visible()
    page.get_by_role('button',name='Konto wechseln',exact=True).click()
    for route,result in held:route.fulfill(content_type='application/json',body=json.dumps(result))
    page.wait_for_timeout(150);expect(page.get_by_role('heading',name='Neuer Bildauftrag',exact=True)).to_have_count(0)
    assert requests[-1]['mode']=='edit' and requests[-1]['rectangles']==[]
    assert not errors,errors
    print('PASS: actual private image, keyboard/pointer regions, SVG overlay, full-image mode, durable lost-answer UUID reuse, new draft without generation, account-switch late-response fence and narrow/desktop layout')
    browser.close()
