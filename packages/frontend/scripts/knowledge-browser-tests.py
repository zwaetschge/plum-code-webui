"""Source notebooks, model handoff and owner/editor/viewer UI in the rendered app; fake API."""
import copy, json
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright, expect
stamp = '2026-10-26T03:30:00Z'
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/local/bin/plum-chromium', headless=True)
    for width, height in [(1440, 1000), (390, 844)]:
        page = browser.new_page(viewport={'width': width, 'height': height}); page.set_default_timeout(20000)
        page.add_init_script("localStorage.setItem('claude-webui-auth',JSON.stringify({state:{token:'knowledge'},version:0}))")
        source = dict(id='source', kind='source', title='Projektquelle', revision=1, body=dict(text='Belegbarer Quellentext', citation='Original'), createdAt=stamp, updatedAt=stamp)
        notebook = dict(id='notebook', kind='collection', title='Wissensnotebook', revision=1, body=dict(knowledge=True, resourceIds=['source'], notes=''), createdAt=stamp, updatedAt=stamp)
        state = dict(role='owner', grants=[], questions=[], revoked=False)
        errors=[]; page.on('pageerror', lambda e: errors.append(str(e)))
        def api(route):
            req=route.request; path=urlsplit(req.url).path; body=json.loads(req.post_data) if req.post_data else {}; data=[]; status=200
            if path=='/auth/me': data=dict(id='knowledge-owner', role='admin', email='owner@example.invalid', username='Fixture')
            elif path=='/api/basic-auth/status': data=dict(enabled=False)
            elif path=='/api/assistant/personalization': data=dict(revision=1, nickname='', referencePhotos=dict(portrait=None, fullBody=None))
            elif path=='/api/assistant/overview': data=dict(counts={}, tasks=[], recent=[], agents=[])
            elif path=='/api/assistant/api-chat-providers': data=[dict(id='z-ai', name='GLM', protocol='openai', models=['glm-5.3-flash'])]
            elif path=='/api/assistant/collections': data=[notebook]
            elif path=='/api/assistant/sources': data=[source]
            elif path=='/api/assistant/references': data=[dict(id='source', title=source['title'], kind='source', revision=source['revision'])]
            elif path.endswith('/access'):
                if state['revoked']: status=404; data=None
                else: data=dict(resource=source if '/source/' in path else notebook, role=state['role'], ownerId='knowledge-owner', ownerEmail='owner@example.invalid')
            elif path.endswith('/members'):
                if req.method=='PUT':
                    if body['role']: state['grants']=[dict(email=body['email'], role=body['role'])]
                    else: state['grants']=[]
                    data=body
                else: data=state['grants']
            elif path.endswith('/content'):
                assert body['expectedRevision']==notebook['revision']; notebook['title']=body['title']; notebook['body']['notes']=body['notes']; notebook['revision']+=1
                data=dict(resource=notebook, role=state['role'], ownerId='knowledge-owner', ownerEmail='owner@example.invalid')
            elif path.endswith('/notebook/chat'):
                assert body['providerId']=='z-ai' and body['model']=='glm-5.3-flash'
                assert body['sourceIds']==['source']; state['questions'].append(body)
                data=dict(id='notebook-chat', kind='api-chat', title='Notebookfrage', revision=1, body=dict(providerId='z-ai', model='glm-5.3-flash', sourceIds=['source']), createdAt=stamp, updatedAt=stamp)
            elif path.endswith('/notebook-chat/turns'): data=dict(chat=dict(id='notebook-chat', kind='api-chat', title='Notebookfrage', revision=1, body=dict(providerId='z-ai', model='glm-5.3-flash', sourceIds=['source']), createdAt=stamp, updatedAt=stamp), turns=[])
            route.fulfill(status=status, content_type='application/json', body=json.dumps(dict(success=status==200, data=data, error=dict(message='Zugriff entzogen'))))
        page.route('**/api/**', api); page.route('**/auth/me',api); page.route('**/socket.io/**',lambda r:r.abort())
        page.goto('http://127.0.0.1:5188/assistant/knowledge?resource=notebook',wait_until='domcontentloaded')
        notes=page.get_by_role('textbox',name='Notebooknotizen',exact=True); expect(notes).to_be_enabled()
        notes.fill('Neue Notiz mit Herkunft'); page.get_by_role('button',name='Änderungen speichern',exact=True).click()
        expect(page.get_by_role('button',name='Änderungen speichern',exact=True)).to_be_disabled()
        page.get_by_text('Zugriff verwalten',exact=True).click(); page.get_by_role('textbox',name='Plum-Konto freigeben',exact=True).fill('reader@example.invalid')
        page.get_by_role('button',name='Freigeben',exact=True).click(); expect(page.get_by_text('reader@example.invalid · Lesen',exact=True)).to_be_visible()
        page.screenshot(path=f'.screenshots/knowledge-{width}.png')
        page.get_by_role('button',name='Entziehen',exact=True).click(); expect(page.get_by_text('reader@example.invalid · Lesen',exact=True)).to_have_count(0)
        page.get_by_role('textbox',name='Frage an das Notebook',exact=True).fill('Was steht in der Quelle?'); page.get_by_role('button',name='Fragen',exact=True).click()
        expect(page).to_have_url('http://127.0.0.1:5188/chat/model/notebook-chat'); assert len(state['questions'])==1
        state['role']='viewer'; page.goto('http://127.0.0.1:5188/assistant/knowledge?resource=notebook',wait_until='domcontentloaded')
        expect(page.get_by_role('textbox',name='Notebooknotizen',exact=True)).to_be_disabled(); expect(page.get_by_text('Zugriff verwalten',exact=True)).to_have_count(0)
        assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
        state['revoked']=True; page.reload(); expect(page.get_by_role('alert')).to_contain_text('Zugriff nicht mehr verfügbar')
        assert not errors,errors
        print(f'PASS {width}px: notebook notes, source selection, roles, revoke, GLM chat handoff; fake API/model')
        page.close()
    browser.close()
