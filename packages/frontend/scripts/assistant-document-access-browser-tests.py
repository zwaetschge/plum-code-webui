"""Real collaborative page/member editor with controlled authorization/CAS replies. Own PostgreSQL concurrency is a separate backend suite."""
import os,json,copy
from playwright.sync_api import sync_playwright,expect
url=os.environ.get('PLUM_FIXTURE_URL','http://127.0.0.1:5188');assert url.startswith(('http://127.0.0.1:','http://localhost:'))
resource={'id':'shared-document-fixture','kind':'artifact','title':'Gemeinsamer Bericht','revision':2,'body':{'type':'document','format':'markdown','content':'Original ä','images':[]},'createdAt':'','updatedAt':''}
access={'resource':resource,'role':'editor','ownerId':'doc-owner','ownerEmail':'doc-owner@fixture.invalid'}
members=[];edit_commands=[];member_commands=[];receipts={};lost_edit=True;lost_member=True;revoked=False;force_conflict=False
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/local/bin/plum-chromium',headless=True)
    def route_api(route):
        global lost_edit,lost_member,revoked,force_conflict
        req=route.request;assert req.headers.get('authorization')==('Bearer document-owner-fixture-jwt' if 'owner=1' in page.url else 'Bearer document-access-fixture-jwt')
        path=req.url.split('/api/assistant/documents',1)[1];body=req.post_data_json if req.method=='POST' else None
        data=None;status=200
        if path=='/shared' or path.startswith('/shared?'):data=[access] if not revoked else []
        elif path.endswith('/access'):
            if revoked:status=404;data=None
            else:data=access
        elif path.endswith('/edits'):
            edit_commands.append(body)
            if force_conflict:status=409;data=None
            elif body['commandId'] in receipts:data=receipts[body['commandId']]
            else:
                assert body['expectedRevision']==resource['revision']
                resource.update({'revision':resource['revision']+1,'title':body['title']});resource['body']['content']=body['content'];data=copy.deepcopy(access);receipts[body['commandId']]=data
            if lost_edit:lost_edit=False;route.abort();return
        elif path.endswith('/members'):
            if body:
                member_commands.append(body)
                if body['role']:
                    members[:]=[{'userId':'doc-editor','email':body['email'],'role':body['role'],'grantedRevision':2}]
                else:members.clear()
                data={'revision':2}
                if lost_member:lost_member=False;route.abort();return
            else:data={'members':members,'audit':[]}
        route.fulfill(status=status,content_type='application/json',body=json.dumps({'success':status==200,'data':data,'error':{'message':'Dokument wurde inzwischen geändert' if status==409 else 'Zugriff entzogen'}}))
    page=browser.new_page(viewport={'width':390,'height':844});page.route('**/api/assistant/documents/**',route_api);errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    path=url+'/scripts/fixtures/assistant-document-access.html';page.goto(path)
    expect(page.get_by_role('textbox',name='Gemeinsamer Dokumenttext',exact=True)).to_have_value('Original ä')
    page.get_by_role('textbox',name='Gemeinsamer Dokumenttext',exact=True).fill('Editor Änderung 🍎');page.get_by_role('button',name='Neue Dokumentrevision speichern',exact=True).click()
    expect(page.get_by_role('alert')).to_contain_text('fetch');expect(page.get_by_role('textbox',name='Gemeinsamer Dokumenttext',exact=True)).to_be_disabled()
    page.get_by_role('button',name='Dieselbe Speicherung bestätigen',exact=True).click()
    expect(page.get_by_role('textbox',name='Gemeinsamer Dokumenttext',exact=True)).to_be_enabled();assert edit_commands[0]==edit_commands[1]
    expect(page.get_by_role('textbox',name='Gemeinsamer Dokumenttext',exact=True)).to_have_value('Editor Änderung 🍎');expect(page.get_by_text('doc-owner@fixture.invalid · Bearbeiten · Revision 3',exact=True)).to_be_visible()
    # Explicit reload must discard a local change even when server revision is unchanged.
    page.get_by_role('textbox',name='Gemeinsamer Dokumenttext',exact=True).fill('Ungespeichert')
    page.get_by_role('button',name='Aktuellen Stand laden und lokale Änderungen verwerfen',exact=True).click()
    expect(page.get_by_role('textbox',name='Gemeinsamer Dokumenttext',exact=True)).to_have_value('Editor Änderung 🍎')
    force_conflict=True;page.get_by_role('textbox',name='Gemeinsamer Dokumenttext',exact=True).fill('Bleibt lokal bei Konflikt')
    page.get_by_role('button',name='Neue Dokumentrevision speichern',exact=True).click()
    expect(page.get_by_role('alert')).to_contain_text('inzwischen geändert');expect(page.get_by_role('textbox',name='Gemeinsamer Dokumenttext',exact=True)).to_have_value('Bleibt lokal bei Konflikt')
    page.screenshot(path='.probe/plum-assistant/document-access-mobile.png',full_page=True)
    assert page.evaluate('Array.from(document.querySelectorAll("button,input,textarea")).every(e=>e.getBoundingClientRect().right<=innerWidth+1)')
    page.set_viewport_size({'width':1440,'height':1000});page.screenshot(path='.probe/plum-assistant/document-access-desktop.png',full_page=True)
    # Reader UI exposes no editor; revoked access disappears on explicit refresh.
    access['role']='viewer';page.reload();expect(page.get_by_role('heading',name=resource['title'],exact=True)).to_be_visible()
    expect(page.get_by_role('textbox',name='Gemeinsamer Dokumenttext',exact=True)).to_have_count(0);expect(page.get_by_role('button',name='Neue Dokumentrevision speichern',exact=True)).to_have_count(0)
    revoked=True;page.get_by_role('button',name='Aktuellen Stand laden und lokale Änderungen verwerfen',exact=True).click()
    expect(page.get_by_role('alert')).to_contain_text('Zugriff ist nicht mehr verfügbar')
    revoked=False;page.goto(path+'?index=1');page.get_by_role('link',name=resource['title'],exact=True).click();expect(page.get_by_role('heading',name=resource['title'],exact=True)).to_be_visible()
    # Owner grants/revokes remain same UUID after unknown acknowledgement, also in StrictMode.
    page.goto(path+'?owner=1');page.get_by_text('Dokument gemeinsam bearbeiten',exact=True).click()
    page.get_by_label('Plum-Konto (E-Mail)',exact=True).fill('doc-editor@fixture.invalid');page.get_by_role('combobox',name='Dokumentrecht',exact=True).select_option('editor')
    page.get_by_role('button',name='Zugriff erteilen',exact=True).click();expect(page.get_by_role('alert')).to_contain_text('fetch')
    page.get_by_role('button',name='Dieselbe Zugriffsänderung bestätigen',exact=True).click()
    expect(page.get_by_text('doc-editor@fixture.invalid · Bearbeiten · ab Revision 2',exact=True)).to_be_visible();assert member_commands[0]==member_commands[1]
    page.get_by_role('button',name='Zugriff entziehen',exact=True).click();expect(page.get_by_role('button',name='Zugriff entziehen',exact=True)).to_have_count(0)
    assert member_commands[-1]['role'] is None
    assert not errors,errors
    browser.close();print('PASS: actual collaborative list/editor/reader and membership controls, same-UUID lost replies, no overwrite on CAS conflict, same-revision explicit discard, revocation UI, StrictMode and 390px/desktop; no live accounts changed')
