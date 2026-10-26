"""Rendered live editor: autosave, remote refresh and typing during an unacknowledged write."""
import copy,json
from playwright.sync_api import sync_playwright,expect
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/local/bin/plum-chromium',headless=True)
    for width,height in [(1440,1000),(390,844)]:
        page=browser.new_page(viewport={'width':width,'height':height});page.set_default_timeout(20000)
        resource=dict(id='shared-document-fixture',kind='artifact',title='Gemeinsamer Bericht',revision=2,body=dict(type='document',format='text',content='Alpha\nBeta\nGamma'),createdAt='',updatedAt='')
        state=dict(hold=True,pending=None,revoked=False,writes=[]);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        def api(route):
            req=route.request;status=200
            if state['revoked']:status=404;data=None
            elif req.url.endswith('/edits'):
                body=req.post_data_json;assert body['autoMerge'] is True;assert body['expectedRevision']==resource['revision']
                state['writes'].append(body);resource['body']['content']=body['content'];resource['revision']+=1
                data=dict(resource=copy.deepcopy(resource),role='editor',ownerId='owner',ownerEmail='owner@example.invalid')
                if state['hold']:state['hold']=False;state['pending']=(route,data);return
            else:data=dict(resource=copy.deepcopy(resource),role='editor',ownerId='owner',ownerEmail='owner@example.invalid')
            route.fulfill(status=status,content_type='application/json',body=json.dumps(dict(success=status==200,data=data,error=dict(message='Zugriff entzogen'))))
        page.route('**/api/assistant/documents/**',api)
        page.goto('http://127.0.0.1:5188/scripts/fixtures/assistant-document-access.html',wait_until='domcontentloaded')
        editor=page.get_by_role('textbox',name='Gemeinsamer Dokumenttext',exact=True);expect(editor).to_have_value('Alpha\nBeta\nGamma')
        editor.fill('Alpha geändert\nBeta\nGamma');expect(page.get_by_text('Wird gespeichert …',exact=True).last).to_be_visible()
        expect(editor).to_be_enabled();editor.fill('Alpha geändert\nBeta weitergetippt\nGamma')
        held,data=state['pending'];held.fulfill(content_type='application/json',body=json.dumps(dict(success=True,data=data)))
        expect(page.get_by_text('Gespeichert',exact=True)).to_be_visible();expect(editor).to_have_value('Alpha geändert\nBeta weitergetippt\nGamma')
        assert len(state['writes'])==2;assert state['writes'][0]['commandId']!=state['writes'][1]['commandId']
        resource['body']['content']='Alpha geändert\nBeta weitergetippt\nGamma von anderem Konto';resource['revision']+=1
        expect(editor).to_have_value(resource['body']['content'],timeout=10000)
        page.screenshot(path=f'.screenshots/document-live-{width}.png')
        state['revoked']=True;expect(page.get_by_role('alert')).to_contain_text('Zugriff ist nicht mehr verfügbar',timeout=10000)
        expect(editor).to_have_count(0);assert not errors,errors
        print(f'PASS {width}px: auto-save, in-flight typing retained, next revision, remote refresh and revocation; fake API')
        page.close()
    browser.close()
