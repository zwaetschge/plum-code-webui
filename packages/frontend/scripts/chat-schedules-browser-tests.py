"""Schedule editor/actions and normal result chat link, with fake API."""
import json
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright, expect
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/local/bin/plum-chromium',headless=True)
    for width,height in [(1440,1000),(390,844)]:
        page=browser.new_page(viewport={'width':width,'height':height}); page.set_default_timeout(20000)
        page.add_init_script("localStorage.setItem('claude-webui-auth',JSON.stringify({state:{token:'schedule'},version:0}))")
        state={'rows':[],'runs':0}; errors=[]; page.on('pageerror',lambda e:errors.append(str(e)))
        def api(route):
            req=route.request;path=urlsplit(req.url).path;body=json.loads(req.post_data) if req.post_data else {};data=[]
            if path=='/auth/me':data=dict(id='schedule-owner',role='admin',username='Fixture',email='fixture@example.invalid')
            elif path=='/api/basic-auth/status':data=dict(enabled=False)
            elif path=='/api/assistant/personalization':data=dict(revision=1,nickname='',referencePhotos=dict(portrait=None,fullBody=None))
            elif path=='/api/assistant/overview':data=dict(counts={},tasks=[],recent=[],agents=[])
            elif path=='/api/assistant/api-chats':data=[dict(id='chat',kind='api-chat',revision=1,title='Mein Chat',body={},createdAt='',updatedAt='')]
            elif path=='/api/assistant/chat-schedules':
                if req.method=='POST':
                    assert body['chatId']=='chat';assert body['plan']['days']==[1,4]
                    row=dict(id='schedule',revision=1,title=body['title'],prompt=body['prompt'],plan=body['plan'],chatId='chat',paused=False,nextAt='2026-12-01T06:00:00Z',runs=[]);state['rows']=[row];data=row
                else:data=state['rows']
            elif path=='/api/assistant/chat-schedules/schedule':
                if req.method=='DELETE':assert body['expectedRevision']==state['rows'][0]['revision'];state['rows']=[];data=dict(removed=True)
                else:
                    row=state['rows'][0];assert body['expectedRevision']==row['revision'];row.update(title=body['title'],prompt=body['prompt'],plan=body['plan'],paused=not body['enabled'],revision=row['revision']+1);data=row
            elif path.endswith('/schedule/run'):
                state['runs']+=1;state['rows'][0]['runs']=[dict(id='turn',slotAt='manual:'+body['commandId'],status='accepted')];data=dict(id='turn',chatId='chat')
            route.fulfill(content_type='application/json',body=json.dumps(dict(success=True,data=data)))
        page.route('**/api/**',api);page.route('**/auth/me',api);page.route('**/socket.io/**',lambda r:r.abort())
        page.goto('http://127.0.0.1:5188/assistant/schedules?chat=chat',wait_until='domcontentloaded')
        page.get_by_role('textbox',name='Zeitplantitel',exact=True).fill('Wochenüberblick')
        page.get_by_role('textbox',name='Geplante Nachricht',exact=True).fill('Fasse meine Quellen zusammen')
        page.get_by_role('combobox',name='Häufigkeit',exact=True).select_option('weekly')
        for day in ['Di','Mi','Fr']:page.get_by_role('checkbox',name=day,exact=True).uncheck()
        page.get_by_role('button',name='Zeitplan aktivieren',exact=True).click()
        expect(page.get_by_role('heading',name='Wochenüberblick',exact=True)).to_be_visible()
        page.get_by_role('button',name='Pausieren',exact=True).click();expect(page.get_by_role('button',name='Fortsetzen',exact=True)).to_be_visible()
        page.get_by_role('button',name='Fortsetzen',exact=True).click();expect(page.get_by_role('button',name='Pausieren',exact=True)).to_be_visible()
        page.get_by_role('button',name='Jetzt ausführen',exact=True).click();page.get_by_text('Letzte Läufe',exact=True).click();expect(page.get_by_text('Manuell · Im Chat',exact=True)).to_be_visible()
        expect(page.get_by_role('link',name='Ergebnisse im Chat',exact=True)).to_have_attribute('href','/chat/model/chat')
        page.screenshot(path=f'.screenshots/chat-schedules-{width}.png')
        page.get_by_role('button',name='Bearbeiten',exact=True).click();page.get_by_role('textbox',name='Zeitplantitel',exact=True).fill('Geänderter Überblick');page.get_by_role('button',name='Zeitplan ändern',exact=True).click()
        expect(page.get_by_role('heading',name='Geänderter Überblick',exact=True)).to_be_visible()
        page.get_by_role('button',name='Entfernen',exact=True).click();expect(page.get_by_role('heading',name='Geänderter Überblick',exact=True)).to_have_count(0)
        assert state['runs']==1;assert not errors,errors
        assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
        print(f'PASS {width}px: schedule weekdays/timezone, save/pause/resume/run/edit/remove and result chat; fake API')
        page.close()
    browser.close()
