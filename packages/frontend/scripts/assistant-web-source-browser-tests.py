import json,os
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright,expect
url=os.environ.get('PLUM_FIXTURE_URL','http://127.0.0.1:5188')
assert url.startswith(('http://127.0.0.1:','http://localhost:'))
date='2026-10-10T00:00:00Z'
user={'id':'web-browser-alice','email':'alice@example.invalid','role':'admin'}
source={'id':'web-source-fixture','kind':'source','revision':1,'title':'Öffentliche Quelle','body':{'text':'Originaler Dokumentbeleg','url':'https://source.fixture.invalid/article','capture':'public-web','sourceIds':[]},'createdAt':date,'updatedAt':date}
watch={'revision':0,'enabled':False,'intervalMinutes':60,'checkedAt':None,'nextCheckAt':None,'error':None}
posts=[];errors=[]
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/local/bin/plum-chromium',headless=True)
    page=browser.new_page(viewport={'width':390,'height':844})
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.add_init_script("localStorage.setItem('claude-webui-auth',JSON.stringify({state:{token:'web-browser-fixture'},version:0}))")
    def api(route):
        request=route.request;path=urlsplit(request.url).path
        payload=json.loads(request.post_data) if 'application/json' in request.headers.get('content-type','') and request.post_data else {}
        data={} if 'settings' in path else []
        if request.method=='POST':
            posts.append((path,payload))
            if path.endswith('/import-url'):data=source
            elif path.endswith('/watch'):
                assert payload['expectedWatchRevision']==watch['revision'];watch.update({'revision':watch['revision']+1,'enabled':payload['enabled'],'intervalMinutes':payload['intervalMinutes']});data=watch
            elif path.endswith('/refresh'):
                source['revision']+=1;source['body']['text']='Neuer Dokumentbeleg';watch['checkedAt']=date;data={'source':source,'changed':True,'checkedAt':date}
        elif path=='/auth/me':data=user
        elif path=='/api/basic-auth/status':data={'enabled':False}
        elif path=='/api/assistant/overview':data={'counts':{},'recent':[],'tasks':[],'agents':[]}
        elif path=='/api/assistant/sources/web-source-fixture':data=source
        elif path.endswith('/watch'):data=watch
        elif path=='/api/assistant/sources':data=[source] if posts else []
        route.fulfill(content_type='application/json',body=json.dumps({'success':True,'data':data}))
    page.route('**/api/**',api);page.route('**/auth/me',api);page.route('**/socket.io/**',lambda r:r.abort())
    page.goto(url+'/assistant/sources')
    importer=page.get_by_role('region',name='Webquelle übernehmen',exact=True)
    importer.get_by_role('textbox',name='Webadresse',exact=True).fill('https://source.fixture.invalid/article')
    importer.get_by_role('button',name='Webquelle übernehmen',exact=True).click()
    expect(page).to_have_url(url+'/assistant/sources?resource=web-source-fixture')
    expect(page.get_by_text('Originaler Dokumentbeleg',exact=True)).to_be_visible()
    observer=page.get_by_role('region',name='Webquelle beobachten',exact=True)
    observer.get_by_role('checkbox',name='Regelmässig prüfen',exact=True).check()
    observer.get_by_role('combobox',name='Abrufintervall',exact=True).select_option('30')
    observer.get_by_role('button',name='Beobachtung speichern',exact=True).click()
    expect(observer.get_by_text('Beobachtung aktiviert. Änderungen erhalten eine neue Quellenrevision.',exact=True)).to_be_visible()
    observer.get_by_role('button',name='Jetzt prüfen',exact=True).click()
    expect(page.get_by_text('Neuer Dokumentbeleg',exact=True)).to_be_visible()
    expect(observer.get_by_text('Neue Quellenrevision gespeichert.',exact=True)).to_be_visible()
    observer.get_by_role('checkbox',name='Regelmässig prüfen',exact=True).uncheck()
    observer.get_by_role('button',name='Beobachtung speichern',exact=True).click()
    expect(observer.get_by_text('Beobachtung beendet.',exact=True)).to_be_visible()
    assert watch['enabled'] is False and watch['intervalMinutes']==30
    assert [path.rsplit('/',1)[-1] for path,_ in posts]==['import-url','watch','refresh','watch']
    assert len({payload['commandId'] for _,payload in posts})==4
    assert not page.evaluate('()=>document.documentElement.scrollWidth>innerWidth')
    observer.scroll_into_view_if_needed();Path('.probe/plum-assistant').mkdir(parents=True,exist_ok=True)
    page.screenshot(path='.probe/plum-assistant/web-source-mobile.png',full_page=True)
    page.set_viewport_size({'width':1440,'height':1000});page.screenshot(path='.probe/plum-assistant/web-source-desktop.png',full_page=True)
    assert not errors,errors
    print('PASS: actual public-source import, pinned source selection, explicit interval/enable/stop, durable command identities, current revision after refresh and mobile/desktop layout')
    browser.close()
