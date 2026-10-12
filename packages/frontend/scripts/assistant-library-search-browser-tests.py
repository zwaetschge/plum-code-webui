import os,json
from urllib.parse import urlsplit,parse_qs
from playwright.sync_api import sync_playwright,expect
url=os.environ.get('PLUM_FIXTURE_URL','http://127.0.0.1:5188');assert url.startswith(('http://127.0.0.1:','http://localhost:'))
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/local/bin/plum-chromium',headless=True);page=browser.new_page(viewport={'width':390,'height':844});errors=[];requests=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    def api(route):
        parsed=urlsplit(route.request.url);assert parsed.path=='/api/assistant/library-search'
        values=parse_qs(parsed.query);requests.append(values);offset=int(values['offset'][0]);code=values['category'][0]=='code'
        hits=[{'id':str(n),'entryType':'cli-message' if code else 'resource','kind':'session' if code else 'source','title':f'Originalbericht {n}','category':'code' if code else 'library','revision':None if code else 4,'updatedAt':'2026-10-10T10:00:00Z','excerpt':'Birnen mit Äpfeln — 100%_ <script>kein Code</script>','href':f'/session/code?message={n}' if code else f'/assistant/sources?resource={n}&revision=4'} for n in range(offset,offset+(1 if offset or code else 30))]
        route.fulfill(content_type='application/json',body=json.dumps({'data':{'hits':hits,'hasMore':not offset and not code}}))
    page.route('**/api/**',api);page.goto(url+'/scripts/fixtures/assistant-search.html')
    assert not requests
    page.get_by_label('Suchtext',exact=True).fill('Birnen');page.get_by_role('button',name='Suchen',exact=True).click()
    expect(page.get_by_role('link',name='Originalbericht 0',exact=True)).to_have_attribute('href','/assistant/sources?resource=0&revision=4')
    page.get_by_role('button',name='Weitere Treffer',exact=True).click();expect(page.get_by_role('link',name='Originalbericht 30',exact=True)).to_be_visible()
    page.get_by_label('Bereich',exact=True).select_option('code');expect(page.get_by_role('link',name='Originalbericht 0',exact=True)).to_have_attribute('href','/session/code?message=0')
    assert page.get_by_role('link',name='Originalbericht 30',exact=True).count()==0
    expect(page.get_by_text('Birnen mit Äpfeln — 100%_ <script>kein Code</script>',exact=True)).to_be_visible()
    assert page.locator('section script').count()==0 and page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.screenshot(path='.probe/plum-assistant/search-mobile.png',full_page=True);page.set_viewport_size({'width':1440,'height':900});page.screenshot(path='.probe/plum-assistant/search-desktop.png',full_page=True)
    assert requests[0]['query']==['Birnen'] and requests[1]['offset']==['30'] and requests[-1]['category']==['code']
    assert not errors,errors
    print('PASS: explicit common search, revision/message links, page extension, category reset, literal hostile excerpt and mobile/desktop render')
    browser.close()
