"""Rendered API-chat workbench checks; HTTP data fixtures, real sandbox/Pyodide."""
import json, os, threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright, expect

static_server = None
production_dist = os.environ.get('PLUM_PRODUCTION_DIST')
if production_dist:
    dist = Path(production_dist).resolve()
    assert (dist/'index.html').is_file() and (dist/'chat-sandbox.html').is_file(), 'Build production frontend first'
    class ProductionHandler(SimpleHTTPRequestHandler):
        def __init__(self,*args,**kwargs): super().__init__(*args,directory=str(dist),**kwargs)
        def log_message(self,*args): pass
        def do_GET(self):
            if not (dist/urlsplit(self.path).path.lstrip('/')).is_file(): self.path='/index.html'
            super().do_GET()
        def end_headers(self):
            runtime='http://'+self.headers['Host']+'/python-runtime/'
            if urlsplit(self.path).path=='/chat-sandbox.html':
                policy=f"default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval' blob: {runtime}; worker-src blob:; connect-src {runtime}; frame-src about:; img-src data: blob:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'"
                self.send_header('Cross-Origin-Resource-Policy','cross-origin')
            else:
                policy="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https:; connect-src 'self' ws: wss:; media-src 'self' blob:; font-src 'self' data: https://fonts.gstatic.com; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
            if urlsplit(self.path).path.startswith('/python-runtime/'):
                self.send_header('Access-Control-Allow-Origin','*');self.send_header('Cross-Origin-Resource-Policy','cross-origin')
            self.send_header('Content-Security-Policy',policy)
            super().end_headers()
    static_server=ThreadingHTTPServer(('127.0.0.1',0),ProductionHandler)
    threading.Thread(target=static_server.serve_forever,daemon=True).start()
    URL='http://127.0.0.1:'+str(static_server.server_port)
    print('SCENARIO: production built app, strict parent script-src self, separate sandbox CSP and runtime CORS',flush=True)
else:
    URL = os.environ.get('PLUM_FIXTURE_URL', 'http://127.0.0.1:5192')
assert URL.startswith(('http://127.0.0.1:', 'http://localhost:'))
OUT = Path('.screenshots'); OUT.mkdir(exist_ok=True)
USER = {'id':'workbench-user','email':'browser@example.invalid','username':'Browser','role':'admin'}
PROVIDERS = [{'id':'fixture','name':'Persönliche API','protocol':'openai','models':['fixture-model']}, {'id':'other','name':'Zweites Modell','protocol':'openai','models':['other-model']}]
chat = {'id':'workbench-chat','kind':'api-chat','revision':1,'title':'Chat-Arbeitsplatz','body':{'providerId':'fixture','model':'fixture-model','sourceIds':[]},'createdAt':'2026-10-25T00:00:00Z','updatedAt':'2026-10-25T00:00:00Z'}
rich = '''## Belegte Antwort

**Formatiert** und eine Formel: $E=mc^2$.

| Werkzeug | Ergebnis |
| --- | --- |
| Python | 42 |

```python
print(6 * 7)
```

```html
<h1>Lokale Vorschau</h1><script>document.body.dataset.preview='ready';</script>
```
'''
source = {'id':'source-fixture','revision':3,'title':'Originalbeleg.txt','text':'Die Originalstelle bestätigt die Antwort 42.','page':2,'retrieval':'hybrid'}
turns = [{'id':'rich-turn','seq':1,'prompt':'Zeige alle Chat-Werkzeuge.','response':rich,'status':'completed','error':None,'model':'fixture-model','sourceVersions':[{'id':'source-fixture','revision':3}],'imageAssetIds':[],'usage':None,'createdAt':'2026-10-25T00:00:00Z','sources':[source], 'toolEvents':[{'id':'web-1','name':'web_search','status':'completed','result':'Gefundener Originalbeleg'}], 'comparisons':[{'providerId':'other','model':'other-model','response':'Die zweite Antwort ist **42**.','status':'completed'}]}]
requests=[]; shares=[]; errors=[]; blocked=[]; runtime_requests=[]; sandbox_messages=[]

def api(route):
    global chat, shares
    req=route.request; path=urlsplit(req.url).path
    raw=req.post_data or ''
    payload=json.loads(raw) if 'application/json' in req.headers.get('content-type','') and raw else {}
    requests.append((req.method,path,payload,raw,req.url))
    data={} if 'settings' in path else []
    if req.method=='PUT' and path.endswith('/options'):
        chat={**chat,'revision':chat['revision']+1,'body':{**chat['body'],'chatOptions':payload['options']}};data=chat
    elif req.method=='POST':
        if path.endswith('/documents'): data={'id':'uploaded-document','title':'beleg.txt','kind':'source','revision':1,'body':{'text':'Dokumentinhalt'}}
        elif path.endswith('/turns'):
            turns.append({'id':payload['commandId'],'seq':len(turns)+1,'prompt':payload['prompt'],'response':'Dokument empfangen.','status':'completed','error':None,'model':'fixture-model','sourceVersions':[],'imageAssetIds':[],'usage':None,'createdAt':'2026-10-25T00:00:00Z'});data=turns[-1]
        elif path.endswith('/share'):
            shares=[{'id':'share-fixture','expiresAt':'2030-10-25T00:00:00Z','revoked':0}];data={'viewPath':'/shared/share-token'}
        elif path.endswith('/import'): data={'chats':[{'id':chat['id']}],'count':1}
        elif path.endswith('/references'): data=[]
    elif req.method=='DELETE' and path.endswith('/share-fixture'): shares=[]
    elif path=='/auth/me': data=USER
    elif path=='/api/basic-auth/status': data={'enabled':False}
    elif path=='/api/assistant/personalization': data={'revision':0,'nickname':'','voiceChat':False,'suggestedPrompts':False,'referencePhotos':{'portrait':None,'fullBody':None}}
    elif path=='/api/assistant/overview':data={'counts':{},'recent':[],'tasks':[],'agents':[]}
    elif path=='/api/assistant/api-chat-providers':data=PROVIDERS
    elif path=='/api/assistant/api-chats':data=[chat]
    elif path.endswith('/turns'):data={'chat':chat,'turns':turns}
    elif path=='/api/mcp':data=[{'id':'read-mcp','name':'Lesender MCP','enabled':True}]
    elif path.endswith('/shares'): data=shares
    elif path.endswith('/file'):route.fulfill(body='Originalbeleg',content_type='text/plain',headers={'Content-Disposition':'attachment; filename="originalbeleg.txt"'});return
    route.fulfill(content_type='application/json',body=json.dumps({'success':True,'data':data}))

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/local/bin/plum-chromium',headless=True)
    page=browser.new_page(viewport={'width':1440,'height':1000})
    page.expose_binding('captureSandboxMessage',lambda binding,data:sandbox_messages.append(data))
    page.add_init_script("if (window !== window.top) window.addEventListener('message', e => { if (e.source === parent) window.captureSandboxMessage({keys:Object.keys(e.data),serialized:JSON.stringify(e.data),fileNames:(e.data.files||[]).map(f=>f.name)}); });")
    page.add_init_script("if (window === window.top) localStorage.setItem('claude-webui-auth',JSON.stringify({state:{token:'workbench-browser-fixture'},version:0}))")
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('console',lambda m: print('BROWSER:',m.text) if m.type=='error' else None)
    page.on('request',lambda r:runtime_requests.append(r.url) if '/python-runtime/' in r.url else None)
    page.route('**/api/**',api);page.route('**/auth/me',api);page.route('**/socket.io/**',lambda r:r.abort())
    page.route('https://network-probe.invalid/**',lambda r:(blocked.append(r.request.url),r.abort()))
    initial=page.goto(URL+'/chat/model/'+chat['id'])
    if production_dist: assert "script-src 'self';" in initial.headers['content-security-policy']
    expect(page.get_by_role('heading',name='Belegte Antwort',exact=True)).to_be_visible(timeout=30000)
    expect(page.locator('table')).to_have_count(1);expect(page.locator('.katex')).to_have_count(1)
    assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
    page.screenshot(path=str(OUT/'chat-workbench-desktop.png'),full_page=True)
    page.set_viewport_size({'width':390,'height':844});page.wait_for_timeout(300)
    assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
    page.screenshot(path=str(OUT/'chat-workbench-mobile.png'),full_page=True)
    print('PASS: desktop and mobile real rich response, table and formula; screenshots saved',flush=True)
    page.get_by_role('button',name='Originalbeleg.txt · S. 2',exact=True).click()
    dialog=page.get_by_role('dialog');expect(dialog.get_by_text(source['text'],exact=True)).to_be_visible();expect(dialog.get_by_text('Revision 3 · Seite 2 · Hybride Suche',exact=True)).to_be_visible()
    page.screenshot(path=str(OUT/'chat-workbench-source-mobile.png'));page.keyboard.press('Escape')
    page.get_by_role('button',name='Chat-Werkzeuge',exact=True).click();dialog=page.get_by_role('dialog')
    dialog.get_by_role('checkbox',name='Websuche und Seitenabruf',exact=True).check();dialog.get_by_role('checkbox',name='Volltext statt Fundstellensuche',exact=True).check()
    dialog.get_by_text('MCP-Werkzeuge',exact=True).click();dialog.get_by_role('checkbox',name='Lesender MCP',exact=True).check()
    dialog.get_by_text('Modelle vergleichen',exact=True).click();dialog.get_by_role('combobox',name='Vergleichsmodell hinzufügen',exact=True).select_option(json.dumps(['other','other-model'],separators=(',',':')))
    dialog.get_by_text('Modellparameter',exact=True).click();dialog.get_by_role('spinbutton',name='Temperatur',exact=True).fill('0.4');dialog.get_by_role('spinbutton',name='Ausgabetokens',exact=True).fill('4096');dialog.get_by_role('spinbutton',name='Kontext-Turns',exact=True).fill('12')
    page.screenshot(path=str(OUT/'chat-workbench-options-mobile.png'))
    dialog.get_by_role('button',name='Speichern',exact=True).click();expect(dialog).not_to_be_visible()
    saved=next(r[2] for r in reversed(requests) if r[0]=='PUT' and r[1].endswith('/options'))
    assert saved['options']=={'webSearch':True,'mcpServerIds':['read-mcp'],'allowToolWrites':False,'comparisonModels':[{'providerId':'other','model':'other-model'}],'maxOutputTokens':4096,'contextTurns':12,'fullDocuments':True,'temperature':0.4},saved
    print('PASS: source original context and saved actual workbench options payload',flush=True)
    page.get_by_role('button',name='Antworten zusammenführen',exact=True).click()
    page.wait_for_timeout(500)
    assert any(r[2].get('mergeTurnId')=='rich-turn' for r in requests),requests
    print('PASS: comparison merge submits the selected original turn',flush=True)
    page.get_by_role('button',name='Chat-Werkzeuge',exact=True).click();dialog=page.get_by_role('dialog')
    dialog.get_by_role('button',name='Chat teilen',exact=True).click();expect(dialog.get_by_role('textbox',name='Freigabelink',exact=True)).to_have_value(URL+'/shared/share-token')
    dialog.get_by_role('button',name='Widerrufen',exact=True).click();expect(dialog.get_by_role('button',name='Widerrufen',exact=True)).to_have_count(0)
    assert any(r[0]=='DELETE' and r[1]=='/api/assistant/shares/share-fixture' for r in requests)
    print('PASS: share creation/revocation',flush=True)
    if page.get_by_role('dialog').count():page.keyboard.press('Escape')
    page.get_by_role('button',name='Anhänge und Vorgaben',exact=True).click()
    page.get_by_role('menuitem',name='Anhänge und Kamera',exact=True).click()
    page.get_by_label('Dateien anhängen',exact=True).set_input_files({'name':'beleg.txt','mimeType':'text/plain','buffer':b'Antwort 42 aus dem Originaldokument.'})
    page.get_by_role('textbox',name='Deine Nachricht',exact=True).fill('Was steht im Beleg?');page.get_by_role('button',name='Senden',exact=True).click();page.wait_for_timeout(500)
    assert any(r[1].endswith('/documents') and 'beleg.txt' in r[3] for r in requests)
    assert any(r[2].get('documentSourceIds')==['uploaded-document'] for r in requests)
    assert not errors,errors
    print('PASS: document upload source ID linked to next message; no page errors',flush=True)
    if not os.environ.get('SKIP_RUNTIME'):
        page.get_by_role('button',name='Python ausführen',exact=True).first.click();dialog=page.get_by_role('dialog')
        frame=page.frame_locator('iframe[title="Python-Ergebnis"]')
        expect(frame.locator('#out')).to_have_text('42',timeout=60000)
        assert runtime_requests, 'Python must load real self-hosted runtime'
        # The normal chat poll must not unmount the running playground.
        page.wait_for_timeout(5500)
        expect(frame.locator('#out')).to_have_text('42')
        page.screenshot(path=str(OUT/'chat-workbench-python-mobile.png'))
        print('PASS: real self-hosted Python evaluates print(6*7) to 42',flush=True)
        dialog.get_by_role('textbox',name='Code',exact=True).fill("print(open('originalbeleg.txt').read())")
        dialog.get_by_role('button',name='Ausführen',exact=True).click()
        expect(page.frame_locator('iframe[title="Python-Ergebnis"]').locator('#out')).to_have_text('Originalbeleg',timeout=60000)
        assert any(r[1]=='/api/assistant/sources/source-fixture/file' and r[4].endswith('?revision=3') for r in requests)
        assert sandbox_messages and all(sorted(m['keys'])==['code','files','kind'] for m in sandbox_messages),sandbox_messages
        assert all('workbench-browser-fixture' not in m['serialized'] and USER['email'] not in m['serialized'] for m in sandbox_messages)
        assert all(m['fileNames']==['originalbeleg.txt'] for m in sandbox_messages)
        page.screenshot(path=str(OUT/'chat-workbench-python-file-mobile.png'))
        print('PASS: attached original revision preloaded into Python FS; iframe receives code/files only, no authentication data',flush=True)
        code="""import js\nprint('parent blocked' if not hasattr(js, 'parent') else 'UNSAFE')\nfor url in ['https://network-probe.invalid/probe', '"""+URL+"""/api/protected-probe']:\n    try:\n        await js.fetch(url)\n        print('UNSAFE')\n    except Exception:\n        print('blocked')\n"""
        before=len(requests);dialog.get_by_role('textbox',name='Code',exact=True).fill(code);dialog.get_by_role('button',name='Ausführen',exact=True).click()
        expect(page.frame_locator('iframe[title="Python-Ergebnis"]').locator('#out')).to_have_text('parent blocked\nblocked\nblocked',timeout=60000)
        assert not blocked,'Cross-origin probe escaped Python CSP';assert not any(r[1]=='/api/protected-probe' for r in requests[before:]),'Protected API probe escaped Python CSP'
        print('PASS: Python network and protected API fetch blocked before requests',flush=True)
        dialog.get_by_role('textbox',name='Code',exact=True).fill('while True: pass')
        dialog.get_by_role('button',name='Ausführen',exact=True).click()
        page.frame_locator('iframe[title="Python-Ergebnis"]').get_by_role('button',name='Stoppen',exact=True).click()
        expect(page.frame_locator('iframe[title="Python-Ergebnis"]').locator('#out')).to_contain_text('Gestoppt')
        print('PASS: infinite Python execution can be stopped without freezing the UI',flush=True)
        dialog.get_by_role('button',name='Close',exact=True).click();page.get_by_role('button',name='Vorschau',exact=True).first.click();dialog=page.get_by_role('dialog')
        expect(page.frame_locator('iframe[title="HTML-Vorschau"]').frame_locator('iframe[title="HTML-Ergebnis"]').get_by_role('heading',name='Lokale Vorschau',exact=True)).to_be_visible()
        page.wait_for_timeout(350)  # Let dialog enter animation and iframe compositing settle.
        page.screenshot(path=str(OUT/'chat-workbench-html-mobile.png'))
        html="""<h1>Isoliert</h1><script>let out=[];try{parent.document.body.dataset.escaped='yes';out.push('UNSAFE')}catch(e){out.push('parent blocked')};Promise.all(['https://network-probe.invalid/html','"""+URL+"""/api/protected-probe'].map(u=>fetch(u).then(()=>out.push('UNSAFE')).catch(()=>out.push('fetch blocked')))).then(()=>document.body.innerText=out.join('|'));</script>"""
        before=len(requests);dialog.get_by_role('textbox',name='Code',exact=True).fill(html);dialog.get_by_role('button',name='Aktualisieren',exact=True).click()
        expect(page.frame_locator('iframe[title="HTML-Vorschau"]').frame_locator('iframe[title="HTML-Ergebnis"]').locator('body')).to_have_text('parent blocked|fetch blocked|fetch blocked')
        assert page.evaluate('document.body.dataset.escaped') is None;assert not blocked;assert not any(r[1]=='/api/protected-probe' for r in requests[before:])
        print('PASS: HTML preview cannot access parent DOM or network/API',flush=True)
    if page.get_by_role('dialog').count():page.keyboard.press('Escape')
    page.get_by_role('button',name='Chat-Werkzeuge',exact=True).click()
    page.get_by_label('Chats importieren',exact=True).set_input_files({'name':'openwebui.json','mimeType':'application/json','buffer':b'[{"title":"Altes Gespraech","messages":[{"role":"user","content":"Hallo"}]}]'})
    page.wait_for_timeout(500);assert any(r[1].endswith('/import') and 'openwebui.json' in r[3] for r in requests)
    print('PASS: actual multipart chat import',flush=True)
    assert not errors,errors
    assert all(sorted(m['keys'])==['code','files','kind'] and 'workbench-browser-fixture' not in m['serialized'] for m in sandbox_messages),sandbox_messages
    browser.close()
    if static_server: static_server.shutdown();static_server.server_close()
