import json,os
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright,expect
url=os.environ.get('PLUM_FIXTURE_URL','http://127.0.0.1:5188');assert url.startswith(('http://127.0.0.1:','http://localhost:'))
stamp='2026-10-10T10:00:00Z';source={'id':'source-fixture','kind':'source','title':'Angebot Rucksack','revision':7,'createdAt':stamp,'updatedAt':stamp,'body':{'url':'https://example.invalid/rucksack','text':'Rucksack blau — 129 CHF — lieferbar'}}
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/local/bin/plum-chromium',headless=True);page=browser.new_page(viewport={'width':390,'height':844});saved=[];created=[];errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    def api(route):
        path=urlsplit(route.request.url).path;data=[]
        if path.endswith('/artifacts/comparison'):
            payload=json.loads(route.request.post_data);created.append(payload);assert payload['commandId'];data={'id':'comparison-fixture','kind':'artifact','title':payload['title'],'revision':1,'createdAt':stamp,'updatedAt':stamp,'body':{'type':'comparison','format':'json','content':json.dumps({'type':'plum-comparison','version':1,'offers':[],'decision':''})}}
        elif route.request.method=='PATCH':
            payload=json.loads(route.request.post_data);saved.append(payload);page.evaluate('(body)=>window.__savedBody=body',payload['body']);data={'id':'comparison-fixture'}
        elif path.endswith('/sources'):data=[source]
        elif path.endswith('/sources/source-fixture'):data=source
        elif path.endswith('/references'):data=[{'id':source['id'],'kind':'source','title':source['title'],'revision':source['revision']}]
        else:raise AssertionError(path)
        route.fulfill(content_type='application/json',body=json.dumps({'data':data}))
    page.route('**/api/**',api);page.goto(url+'/scripts/fixtures/assistant-comparison.html')
    page.get_by_label('Vergleichstitel',exact=True).fill('Rucksäcke');page.get_by_role('button',name='Vergleich erstellen',exact=True).click()
    page.get_by_role('button',name='Bearbeiten',exact=True).click();page.get_by_role('checkbox',name='Angebot Rucksack',exact=True).check()
    page.get_by_label('Produktname',exact=True).fill('Rucksack blau');page.get_by_label('Preis wie im Original',exact=True).fill('99 CHF');page.get_by_label('Originalauszug mit Preis',exact=True).fill(source['body']['text'])
    page.get_by_role('button',name='Angebot übernehmen',exact=True).click();expect(page.get_by_role('alert')).to_contain_text('exakt')
    page.get_by_label('Preis wie im Original',exact=True).fill('129 CHF');page.get_by_label('Eigene Kriterien / Notizen',exact=True).fill('Grösse und Material prüfen');page.get_by_role('button',name='Angebot übernehmen',exact=True).click()
    page.get_by_role('button',name='Rucksack blau als Favorit',exact=True).click();page.get_by_label('Eigene Entscheidung',exact=True).fill('Preisstand festhalten, später entscheiden')
    page.get_by_role('button',name='Neue Revision speichern',exact=True).click()
    expect(page.get_by_role('link',name='Originalangebot öffnen',exact=True)).to_have_attribute('href',source['body']['url']);expect(page.get_by_text('129 CHF',exact=True)).to_be_visible();expect(page.get_by_text('Quellenstand:',exact=False)).to_be_visible()
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.screenshot(path='.probe/plum-assistant/comparison-mobile.png',full_page=True);page.set_viewport_size({'width':1440,'height':900});page.screenshot(path='.probe/plum-assistant/comparison-desktop.png',full_page=True)
    assert len(created)==1 and len(saved)==1 and saved[0]['expectedRevision']==1
    model=json.loads(saved[0]['body']['content']);offer=model['offers'][0];assert offer['sourceRevision']==7 and offer['asOf']==stamp and offer['favorite'];assert offer['quote']==source['body']['text']
    assert not errors,errors
    print('PASS: comparison create with durable command, own source selection/exact price guard, immutable offer metadata, favorite/decision, save, original links and mobile/desktop render')
    browser.close()
