import io,json,os
from urllib.parse import urlsplit
from PIL import Image
from playwright.sync_api import sync_playwright,expect
url=os.environ.get('PLUM_FIXTURE_URL','http://127.0.0.1:5188');assert url.startswith(('http://127.0.0.1:','http://localhost:'))
output=io.BytesIO();Image.new('RGB',(256,192),(0,120,50)).save(output,format='PNG');png=output.getvalue()
errors=[];reads=[];posts=[];bare=[]
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/local/bin/plum-chromium',headless=True);page=browser.new_page(viewport={'width':390,'height':844})
    page.on('pageerror',lambda error:errors.append(str(error)))
    def api(route):
        request=route.request;path=urlsplit(request.url).path
        if path.endswith('/images/image-original'):
            assert request.headers.get('authorization')=='Bearer artifact-fixture-only';reads.append(request.url)
            route.fulfill(content_type='image/png',body=png);return
        if path.endswith('/image-edit'):
            assert path=='/api/assistant/artifacts/image-artifact/image-edit'
            data=request.post_data_json;posts.append(data)
            assert data['assetId']=='image-original' and data['sourceRevision']==2 and data['mode']=='inpaint'
            result={'id':'new-image-task','kind':'task','title':'Meine Bildbearbeitung','revision':1,'body':{'status':'draft'},'createdAt':'','updatedAt':''}
            route.fulfill(content_type='application/json',body=json.dumps({'data':result}));return
        route.fulfill(content_type='application/json',body=json.dumps({'data':[]}))
    page.route('**/api/**',api)
    page.route('**/generated/**',lambda route:(bare.append(route.request.url),route.abort('failed')))
    page.goto(url+'/scripts/fixtures/assistant-artifact-images.html')
    expect(page.get_by_role('img',name='Meine Zeichnung',exact=True)).to_be_visible()
    assert page.get_by_role('img',name='Meine Zeichnung',exact=True).get_attribute('src').startswith('blob:')
    assert 'revision=2' in reads[0]
    with page.expect_download() as download:
        page.get_by_role('button',name='Originalbild herunterladen',exact=True).click()
    assert download.value.suggested_filename=='Zeichnung.png'
    with open(download.value.path(),'rb') as original:assert original.read()==png
    page.get_by_role('button',name='Bild bearbeiten: Zeichnung.png',exact=True).click()
    expect(page.get_by_role('img',name='Unverändertes Bildoriginal',exact=True)).to_be_visible()
    page.get_by_role('button',name='Bereich hinzufügen',exact=True).click()
    page.get_by_label('Gewünschte Änderung',exact=True).fill('Mitte blau färben.')
    page.get_by_role('button',name='Als neuen Task vorbereiten',exact=True).click()
    expect(page.get_by_role('link',name='Meine Bildbearbeitung',exact=True)).to_have_attribute('href','/tasks?resource=new-image-task')
    assert len(posts)==1 and not bare
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');page.screenshot(path='.probe/plum-assistant/artifact-image-mobile.png',full_page=True)
    page.set_viewport_size({'width':1440,'height':900});page.screenshot(path='.probe/plum-assistant/artifact-image-desktop.png',full_page=True)
    page.get_by_role('button',name='Freigabeansicht',exact=True).click()
    expect(page.get_by_role('img',name='Meine Zeichnung',exact=True)).to_be_visible()
    expect(page.get_by_role('button',name='Bild bearbeiten: Zeichnung.png',exact=True)).to_have_count(0)
    assert any('/shared/fixture-share/images/image-original' in path for path in reads)
    assert not errors,errors
    print('PASS: authentic JWT private original, Blob preview without cookie-only generated path, exact original download, artifact-to-masked-Task draft, pinned revision, read-only snapshot image route and narrow/desktop view')
    browser.close()
