"""Actual SwarmPage and delivery outbox; all server responses are isolated fixtures."""
import os,json
from datetime import datetime,timedelta,timezone
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright,expect
url=os.environ.get('PLUM_FIXTURE_URL','http://127.0.0.1:5188');assert url.startswith(('http://127.0.0.1:','http://localhost:'))
user={'id':'order-alice','email':'order@fixture.invalid','username':'Alice','role':'admin'};posts=[]
rooms=[{'id':'!lobby:fixture.invalid','name':'Testlobby','alias':'#schwarm-lobby:fixture.invalid','encrypted':False,'agents':[],'state':[]},{'id':'!other:fixture.invalid','name':'Anderer Raum','alias':None,'encrypted':False,'agents':[],'state':[]}]
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/local/bin/plum-chromium',headless=True);page=browser.new_page(viewport={'width':390,'height':900});errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.set_default_timeout(15000)
    page.add_init_script("localStorage.setItem('claude-webui-auth',"+json.dumps(json.dumps({'state':{'user':user,'token':'isolated-fixture','isAuthenticated':True},'version':0}))+');')
    def api(route):
        req=route.request;path=urlparse(req.url).path;data=[]
        if path.endswith('/auth/me'):data=user
        elif path.endswith('/matrix/status'):data={'configured':True,'connected':True,'userId':'@alice:fixture.invalid','epoch':'order-epoch'}
        elif path.endswith('/matrix/rooms'):data=rooms
        elif path.endswith('/messages'):data={'chunk':[]}
        elif req.method=='POST':
            assert path.endswith('/events'),path
            posts.append((path,req.post_data_json));data={'eventId':'$fixture-'+str(len(posts))}
        elif 'settings' in path:data={}
        route.fulfill(content_type='application/json',body=json.dumps({'success':True,'data':data}))
    page.route('**/api/**',api);page.route('**/auth/me',api);page.route('**/socket.io/**',lambda r:r.abort());page.goto(url+'/swarm')
    composer=page.get_by_role('textbox',name='Neue Nachricht',exact=True);expect(composer).to_be_visible();stamp=datetime.now(timezone.utc);page.clock.install(time=stamp);page.clock.pause_at(stamp+timedelta(seconds=1))
    composer.fill('!auftrag @brian Meine Unterlagen zusammenfassen');page.get_by_role('button',name='Senden',exact=True).click()
    expect(page.get_by_role('button',name='Auftrag zurücknehmen',exact=True)).to_be_visible();expect(composer).to_be_disabled();assert not posts
    page.screenshot(path='.probe/plum-assistant/native-order-mobile.png',full_page=True);assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.clock.fast_forward(3000);assert not posts;page.get_by_role('button',name='Auftrag zurücknehmen',exact=True).click();page.clock.fast_forward(6000);assert not posts;expect(composer).to_have_value('!auftrag @brian Meine Unterlagen zusammenfassen')
    page.get_by_role('button',name='Senden',exact=True).click();page.clock.fast_forward(4900);assert not posts;page.clock.fast_forward(200);expect(composer).to_have_value('')
    assert len(posts)==1;path,packet=posts[0];assert path.endswith('/%21lobby%3Afixture.invalid/events') or path.endswith('/!lobby%3Afixture.invalid/events')
    assert packet['identityEpoch']=='order-epoch' and packet['nativeUserId']=='@alice:fixture.invalid' and packet['content']['body']=='!auftrag @brian Meine Unterlagen zusammenfassen';assert packet['commandId']
    composer.fill('Eine normale Rückfrage');page.get_by_role('button',name='Senden',exact=True).click();expect(composer).to_have_value('');assert len(posts)==2 and posts[-1][1]['content']['body']=='Eine normale Rückfrage'
    composer.fill('!auftrag @brian Nur in der Lobby');page.get_by_role('button',name='Senden',exact=True).click();page.get_by_role('combobox',name='Raum',exact=True).select_option('!other:fixture.invalid');expect(page.get_by_role('button',name='Auftrag zurücknehmen',exact=True)).to_have_count(0);page.clock.fast_forward(6000);assert len(posts)==2
    composer.fill('!auftrag @brian Nicht nach Kontowechsel');page.get_by_role('button',name='Senden',exact=True).click();page.evaluate("async()=>{const {useAuthStore}=await import('/src/stores/authStore.ts');useAuthStore.setState({user:{id:'order-bob',email:'bob@fixture.invalid'},isAuthenticated:true});}");page.clock.fast_forward(6000);assert len(posts)==2
    assert not errors,errors;browser.close();print('PASS: actual SwarmPage five-second native order grace, no command/request before deadline or after Undo, frozen room/identity/epoch/body/UUID, normal immediate messages, target/account cancellation and mobile controls; no live Matrix send')
