import base64,json,os
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright,expect
url=os.environ.get('PLUM_FIXTURE_URL','http://127.0.0.1:5188');assert url.startswith(('http://127.0.0.1:','http://localhost:'))
png=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=')
task={'id':'photo-task','kind':'task','title':'Foto analysieren','revision':1,'createdAt':'','updatedAt':'','body':{'goal':'Original erhalten','status':'draft','inputImageIds':[]}}
image={'id':'image-fixture','filename':'Äpfel.png','mimeType':'image/png','byteLength':len(png)};lost=True;delay=False;waiting=[];errors=[];uploads=[]
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/local/bin/plum-chromium',headless=True);page=browser.new_page(viewport={'width':390,'height':844})
    page.on('pageerror',lambda error:errors.append(str(error)))
    def api(route):
        global lost,delay
        request=route.request;path=urlsplit(request.url).path
        if path.endswith('/images/image-fixture') and request.method=='GET':route.fulfill(content_type='image/png',body=png);return
        if request.method=='POST':
            body=request.post_data_buffer;assert png in body;uploads.append(body)
            if delay:
                waiting.append((route,json.loads(json.dumps(task))));return
            if not task['body']['inputImageIds']:task['body']['inputImageIds']=[image['id']];task['revision']+=1
            if lost:lost=False;route.abort('failed');return
            data={'task':task,'image':image}
        elif request.method=='DELETE':task['body']['inputImageIds']=[];task['revision']+=1;data=task
        elif path.endswith('/images'):data=[image] if 'photo-task-2' not in path and task['body']['inputImageIds'] else []
        else:raise AssertionError(path)
        route.fulfill(content_type='application/json',body=json.dumps({'data':data}))
    page.route('**/api/**',api);page.goto(url+'/scripts/fixtures/assistant-task-images.html')
    upload={'name':'Äpfel.png','mimeType':'image/png','buffer':png}
    page.get_by_label('Auftragsbild auswählen',exact=True).set_input_files(upload)
    expect(page.get_by_role('button',name='Bild erneut zustellen',exact=True)).to_be_visible()
    expect(page.get_by_role('button',name='Starten',exact=True)).to_be_disabled()
    page.get_by_role('button',name='Bild erneut zustellen',exact=True).click()
    expect(page.get_by_role('img',name='Bildanhang 1',exact=True)).to_be_visible();expect(page.get_by_role('button',name='Starten',exact=True)).to_be_enabled()
    assert len(uploads)==2 and task['revision']==2
    page.get_by_role('button',name='Äpfel.png aus Auftrag entfernen',exact=True).click();expect(page.get_by_role('img')).to_have_count(0)
    page.get_by_label('Auftragsbild auswählen',exact=True).set_input_files(upload);expect(page.get_by_role('img',name='Bildanhang 1',exact=True)).to_be_visible()
    page.get_by_role('button',name='Starten',exact=True).click();expect(page.get_by_label('Auftragsbild auswählen',exact=True)).to_have_count(0)
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');page.screenshot(path='.probe/plum-assistant/task-images-mobile.png',full_page=True)
    page.set_viewport_size({'width':1440,'height':900});page.screenshot(path='.probe/plum-assistant/task-images-desktop.png',full_page=True)
    # A request completing after the component is unmounted cannot reopen the old task.
    page.reload();delay=True;page.get_by_label('Auftragsbild auswählen',exact=True).set_input_files(upload);expect(page.get_by_text('Bild wird übertragen …',exact=True)).to_be_visible()
    page.get_by_role('button',name='Anderen Auftrag öffnen',exact=True).click();expect(page.get_by_role('heading',name='Zweiter Auftrag',exact=True)).to_be_visible()
    assert waiting
    for route,snapshot in waiting:route.fulfill(content_type='application/json',body=json.dumps({'data':{'task':snapshot,'image':image}}))
    page.wait_for_timeout(150)
    expect(page.get_by_role('heading',name='Zweiter Auftrag',exact=True)).to_be_visible();expect(page.get_by_role('img')).to_have_count(0)
    assert not errors,errors
    print('PASS: actual multipart original upload, lost-answer/manual SHA retry, start blocked until resolved, removal/pinned view, private thumbnail, narrow/desktop layout and late-response task-switch fence')
    browser.close()
