import json,os
from playwright.sync_api import sync_playwright,expect
url=os.environ.get('PLUM_FIXTURE_URL','http://127.0.0.1:5188');assert url.startswith(('http://127.0.0.1:','http://localhost:'))
refs=[{'id':'document-fixture','kind':'artifact','title':'Äpfelbericht','revision':3},{'id':'source-fixture','kind':'source','title':'Preisbeleg','revision':2}]
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/local/bin/plum-chromium',headless=True)
    page=browser.new_page(viewport={'width':390,'height':844});saved=[];errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    def api(route):
        if route.request.url.endswith('/references'):
            ids=json.loads(route.request.post_data)['ids'];data=[ref for ref in refs if ref['id'] in ids]
        elif route.request.method=='PATCH':
            payload=json.loads(route.request.post_data);saved.append(payload);data={'id':'collection-fixture','kind':'collection','title':'Meine Sammlung','revision':payload['expectedRevision']+1,'createdAt':'','updatedAt':'','body':payload['body']}
        else:raise AssertionError(route.request.url)
        route.fulfill(content_type='application/json',body=json.dumps({'data':data}))
    page.route('**/api/**',api);page.goto(url+'/scripts/fixtures/assistant-collection.html')
    expect(page.get_by_role('link',name='Preisbeleg',exact=True)).to_be_visible()
    expect(page.get_by_text('Eintrag nicht mehr verfügbar',exact=True)).to_be_visible()
    page.get_by_role('button',name='Eintrag aus Sammlung entfernen',exact=True).click()
    page.get_by_role('button',name='Äpfelbericht als Favorit',exact=True).click()
    page.get_by_role('button',name='Preisbeleg nach vorne',exact=True).click()
    page.get_by_role('checkbox',name='Nur Favoriten').check()
    page.get_by_label('Sammlung durchsuchen',exact=True).fill('äpfel')
    expect(page.get_by_role('link',name='Preisbeleg',exact=True)).not_to_be_visible()
    expect(page.get_by_role('link',name='Äpfelbericht',exact=True)).to_be_visible()
    page.get_by_label('Sammlung durchsuchen',exact=True).fill('');page.get_by_role('checkbox',name='Nur Favoriten').uncheck()
    page.get_by_role('button',name='Sammlung speichern',exact=True).click()
    expect(page.get_by_role('button',name='Sammlung speichern',exact=True)).not_to_be_visible()
    assert saved[0]['body']['resourceIds']==['source-fixture','document-fixture']
    assert saved[0]['body']['favoriteIds']==['source-fixture','document-fixture']
    assert saved[0]['expectedRevision']==1
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.screenshot(path='.probe/plum-assistant/collection-mobile.png',full_page=True)
    page.set_viewport_size({'width':1440,'height':900});page.screenshot(path='.probe/plum-assistant/collection-desktop.png',full_page=True)
    assert not errors,errors
    print('PASS: actual collection search/favorites/order, unavailable references, original links, revision save and narrow/desktop layout')
    browser.close()
