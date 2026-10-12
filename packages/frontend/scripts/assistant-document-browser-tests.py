import json,os,io,hashlib
from email.parser import BytesParser
from email.policy import default
from PIL import Image
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright,expect
url=os.environ.get('PLUM_FIXTURE_URL','http://127.0.0.1:5188');assert url.startswith(('http://127.0.0.1:','http://localhost:'))
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/local/bin/plum-chromium',headless=True)
    page=browser.new_page(viewport={'width':390,'height':844});errors=[];requests=[];chat_requests=[];image_requests=[]
    image_id="9cdd71b0-dc99-4771-9e18-5c81f90c6b38"
    output=io.BytesIO();Image.new("RGB",(320,160),(20,120,70)).save(output,format="PNG");image_bytes=output.getvalue()
    page.on('pageerror',lambda error:errors.append(str(error)))
    def api(route):
        path=urlsplit(route.request.url).path
        if route.request.method=='POST' and path=='/api/assistant/artifacts/document-fixture/images':
            request=route.request
            parts=BytesParser(policy=default).parsebytes(('Content-Type: '+request.headers['content-type']+'\r\nMIME-Version: 1.0\r\n\r\n').encode()+request.post_data_buffer)
            fields={part.get_param('name',header='content-disposition'):part.get_payload(decode=True) for part in parts.iter_parts()}
            assert fields['file']==image_bytes and fields['expectedRevision']==b'2'
            assert len(fields['commandId'])==36
            image_requests.append(fields)
            if len(image_requests)==1:
                body=page.evaluate('window.__savedBody');doc=json.loads(body['content']);doc['blocks'].append({'type':'image','assetId':image_id,'alt':'Original.png','caption':''});body['content']=json.dumps(doc);body['images']=[{'assetId':image_id,'url':'/assistant-images/'+image_id,'filename':'Original.png','mimeType':'image/png','sha256':hashlib.sha256(image_bytes).hexdigest(),'byteLength':len(image_bytes)}];page.evaluate('(body)=>window.__savedBody=body',body)
                route.abort();return
            assert image_requests[0]==fields,'Retry must keep command, exact file and revision'
            data={'id':'document-fixture','revision':3,'body':page.evaluate('window.__savedBody')}
        elif path.endswith('/images/'+image_id):
            assert route.request.headers.get('authorization')=='Bearer document-fixture-token'
            route.fulfill(content_type='image/png',body=image_bytes);return
        elif route.request.method=='PATCH':
            payload=json.loads(route.request.post_data);requests.append(payload)
            page.evaluate('(body)=>window.__savedBody=body',payload['body'])
            data={'id':'document-fixture'}
        elif path.endswith('/api-chat-providers'):data=[{'id':'fixture-api','name':'Fixture API','protocol':'openai','models':['fixture-model']}]
        elif path.endswith(('/references','/profiles','/sources')):data=[]
        elif path.endswith('/api-chats'):
            payload=json.loads(route.request.post_data);chat_requests.append(payload)
            page.evaluate('(payload)=>window.__selectionPayload=payload',payload)
            data={'id':'selection-fixture','kind':'api-chat','revision':1,'body':{'providerId':'fixture-api','model':'fixture-model'}}
        elif path.endswith('/turns'):data={'id':'turn-fixture'}
        else:raise AssertionError(path)
        route.fulfill(content_type='application/json',body=json.dumps({'data':data}))
    page.route('**/api/**',api)
    page.goto(url+'/scripts/fixtures/assistant-document.html');expect(page.get_by_role('heading',name='Dokument bearbeiten')).to_be_visible()
    page.get_by_role('button',name='Als formatiertes Plum-Dokument bearbeiten').click()
    expect(page.get_by_role('textbox',name='Absatz 2',exact=True)).to_have_value('Äpfel und Birnen')
    field=page.get_by_role('textbox',name='Absatz 2',exact=True);field.focus();field.press('Home')
    for _ in range(5):field.press('Shift+ArrowRight')
    page.get_by_role('button',name='Fett',exact=True).click()
    page.get_by_role('button',name='Rückgängig',exact=True).click();page.get_by_role('button',name='Wiederholen',exact=True).click()
    field.focus();field.press('Home')
    for _ in range(10):field.press('ArrowRight')
    field.press('Shift+End')
    page.get_by_label('Weblink',exact=True).fill('javascript:alert(1)');page.get_by_role('button',name='Link übernehmen').click();expect(page.get_by_role('alert')).to_contain_text('HTTP-/HTTPS')
    page.get_by_label('Weblink',exact=True).fill('https://example.invalid/fruit');page.get_by_role('button',name='Link übernehmen').click()
    page.get_by_role('combobox',name='Ausrichtung 1',exact=True).select_option('center')
    page.get_by_role('button',name='Tabelle hinzufügen').click()
    page.get_by_label('Tabelle 3, Zeile 2, Spalte 1',exact=True).fill('Preis');page.get_by_label('Tabelle 3, Zeile 2, Spalte 2',exact=True).fill('10 €')
    # Empty a cell completely: a valid empty run must survive.
    page.get_by_label('Tabelle 3, Zeile 1, Spalte 2',exact=True).fill('')
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.get_by_role('button',name='Neue Revision speichern',exact=True).click()
    expect(page.get_by_role('link',name='Birnen',exact=True)).to_have_attribute('href','https://example.invalid/fruit')
    expect(page.locator('strong').filter(has_text='Äpfel')).to_be_visible()
    expect(page.get_by_role('cell',name='10 €',exact=True)).to_be_visible()
    page.screenshot(path='.probe/plum-assistant/document-mobile.png',full_page=True)
    page.set_viewport_size({'width':1440,'height':900});page.screenshot(path='.probe/plum-assistant/document-desktop.png',full_page=True)
    assert len(requests)==1;body=requests[0]['body'];doc=json.loads(body['content'])
    assert body['format']=='json' and doc['blocks'][0]['align']=='center'
    assert doc['blocks'][1]['runs'][0]=={'text':'Äpfel','bold':True}
    assert doc['blocks'][1]['runs'][-1]['href']=='https://example.invalid/fruit'
    assert requests[0]['expectedRevision']==1
    page.get_by_role('button',name='Bearbeiten',exact=True).click()
    paragraph=page.get_by_role('textbox',name='Absatz 2',exact=True);paragraph.focus();paragraph.press('Home')
    for _ in range(5):paragraph.press('Shift+ArrowRight')
    page.get_by_role('button',name='Auswahl mit Plum ändern',exact=True).click()
    expect(page.get_by_role('heading',name='Änderung für die Textauswahl vorschlagen',exact=True)).to_be_visible()
    # A new cell selection replaces the previous target before any request.
    cell=page.get_by_label('Tabelle 3, Zeile 2, Spalte 2',exact=True);cell.focus();cell.press('Home')
    for _ in range(2):cell.press('Shift+ArrowRight')
    page.get_by_role('button',name='Auswahl mit Plum ändern',exact=True).click()
    page.get_by_label('Deine Nachricht',exact=True).fill('Formuliere diese Zahl anders')
    page.set_viewport_size({'width':390,'height':844})
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.screenshot(path='.probe/plum-assistant/document-selection-mobile.png',full_page=True)
    page.get_by_role('button',name='Änderung vorschlagen lassen',exact=True).click()
    page.wait_for_function('window.__selectionPayload !== undefined')
    assert len(chat_requests)==1,chat_requests
    edit=chat_requests[0]['artifactEdit'];assert edit=={'artifactId':'document-fixture','revision':2,'documentPath':{'block':2,'row':1,'column':1},'start':0,'end':2,'selectedText':'10'},edit
    assert chat_requests[0]['commandId']
    upload=page.get_by_role('region',name='Dokumentbild hinzufügen',exact=True)
    upload.get_by_label('Eigenes Bild am Dokumentende einfügen',exact=True).set_input_files({'name':'Original.png','mimeType':'image/png','buffer':image_bytes})
    expect(upload.get_by_role('button',name='Bildübernahme erneut bestätigen',exact=True)).to_be_visible()
    expect(page.get_by_role('button',name='Vorschau',exact=True)).to_be_disabled()
    upload.get_by_role('button',name='Bildübernahme erneut bestätigen',exact=True).click()
    expect(page.get_by_role('img',name='Original.png',exact=True)).to_be_visible()
    assert len(image_requests)==2
    page.get_by_role('button',name='Bearbeiten',exact=True).click()
    page.get_by_label('Alternativtext 4',exact=True).fill('Eigenes Originalbild')
    page.get_by_label('Bildunterschrift 4',exact=True).fill('Unveränderte Bilddatei')
    expect(page.get_by_label('Eigenes Bild am Dokumentende einfügen',exact=True)).to_be_disabled()
    blocks=page.get_by_role('region',name='Plum-Dokument',exact=True).locator(':scope > div').filter(has=page.get_by_label('Alternativtext 4',exact=True))
    blocks.get_by_role('button',name='Nach oben',exact=True).click()
    expect(page.get_by_label('Alternativtext 3',exact=True)).to_have_value('Eigenes Originalbild')
    page.get_by_role('button',name='Neue Revision speichern',exact=True).click()
    expect(page.get_by_role('img',name='Eigenes Originalbild',exact=True)).to_be_visible()
    expect(page.locator('figcaption').filter(has_text='Unveränderte Bilddatei')).to_be_visible()
    saved=page.evaluate('window.__savedBody');rich=json.loads(saved['content'])
    assert rich['blocks'][2]=={'type':'image','assetId':image_id,'alt':'Eigenes Originalbild','caption':'Unveränderte Bilddatei'}
    assert requests[-1]['expectedRevision']==3
    page.get_by_role('img',name='Eigenes Originalbild',exact=True).scroll_into_view_if_needed()
    page.screenshot(path='.probe/plum-assistant/document-image-mobile.png',full_page=True)
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.set_viewport_size({'width':1440,'height':1000});page.screenshot(path='.probe/plum-assistant/document-image-desktop.png',full_page=True)
    assert not errors,errors
    print('PASS: actual artifact conversion, exact-span formatting/link review, undo/redo, alignment/table editing, hostile-link rejection, revision save, paragraph/cell AI selection bound to exact persisted path/text atomic upload after lost acknowledgement with exact UUID/file, image caption/reordering and authenticated Blob on mobile/desktop')
    browser.close()
