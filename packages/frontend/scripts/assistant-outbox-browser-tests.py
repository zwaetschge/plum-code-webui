import os,json
from playwright.sync_api import sync_playwright,expect
url=os.environ.get('PLUM_FIXTURE_URL','http://127.0.0.1:5188')
assert url.startswith(('http://127.0.0.1:','http://localhost:'))
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/local/bin/plum-chromium',headless=True)
    page=browser.new_page();user={'id':'fixture','email':'fixture@example.invalid','username':'Fixture','role':'admin'}
    page.add_init_script("if(!localStorage.getItem('claude-webui-auth'))localStorage.setItem('claude-webui-auth',"+json.dumps(json.dumps({'state':{'user':user,'token':'fixture-only','isAuthenticated':True},'version':0}))+');')
    requests=[];reject=True
    def route(request):
        requests.append(json.loads(request.request.post_data))
        if reject:request.abort()
        else:request.fulfill(content_type='application/json',body=json.dumps({'success':True,'data':{'eventId':'$fixture'}}))
    page.route('**/api/assistant/matrix/rooms/**/events',route)
    page.goto(url+'/scripts/fixtures/assistant-outbox.html');page.get_by_role('button',name='Nachricht senden').click()
    expect(page.get_by_text('1 unbestätigte Assistenz-Zustellungen')).to_be_visible();assert len(requests)==1
    original=requests[0];page.reload();expect(page.get_by_text('1 unbestätigte Assistenz-Zustellungen')).to_be_visible();assert len(requests)==1
    page.get_by_text('1 unbestätigte Assistenz-Zustellungen').click();page.get_by_text('Inhalt und Ziel prüfen').click();expect(page.get_by_text('Unveränderter Originalauftrag',exact=False)).to_be_visible()
    reject=False;page.get_by_role('button',name='Zustellung prüfen / wiederholen').click();expect(page.get_by_text('1 unbestätigte Assistenz-Zustellungen')).to_have_count(0)
    assert requests[1]==original
    reject=True;page.get_by_role('button',name='Nachricht senden').click();expect(page.get_by_text('1 unbestätigte Assistenz-Zustellungen')).to_be_visible()
    page.get_by_role('button',name='Konto wechseln').click();expect(page.get_by_text('1 unbestätigte Assistenz-Zustellungen')).to_have_count(0)
    assert len(requests)==3
    assert page.evaluate("JSON.parse(localStorage.getItem('plum.assistant.outbox.v1:fixture')).length")==1
    page.evaluate("localStorage.setItem('plum.assistant.outbox.v1:other',JSON.stringify([{id:'expired',path:'/api/assistant/api-chats',payload:{commandId:'expired',temporary:true,title:'TEMPORARY PRIVATE DRAFT'},label:'Temporary draft',createdAt:'2000-01-01T00:00:00Z',expiresAt:'2000-01-02T00:00:00Z'}]));window.dispatchEvent(new Event('plum:assistant-outbox'))")
    assert page.evaluate("JSON.parse(localStorage.getItem('plum.assistant.outbox.v1:other')).length")==0
    assert len(requests)==3,'expired temporary drafts must never be resent'
    print('PASS: expired temporary outbox contents are deleted on opening without a network delivery')
    print('PASS: network loss/reload retains the exact transaction; explicit retry clears receipt; account change hides the prior owner outbox')
    browser.close()
