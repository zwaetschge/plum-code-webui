from pathlib import Path
import json,base64
from playwright.sync_api import sync_playwright,expect
source=Path('packages/android/app/src/main/java/com/claudewebui/app/ui/screens/dashboard/AssistantWebWorkspace.kt').read_text()
script=source.split('val prelude = """',1)[1].split('""".trimIndent()',1)[0].split('<script>',1)[1].split('</script>',1)[0]
script=script.replace('$config',json.dumps({'apiBase':'http://127.0.0.1:5189/mobile','token':'bootstrap-fixture-only'}))
for key,value in [('theme','dark'),('background.id','aurora'),('route','/chat')]:script=script.replace('${JSONObject.quote('+key+')}',json.dumps(value))
checks=[]
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/local/bin/plum-chromium',headless=True)
 context=browser.new_context(viewport={'width':390,'height':844})
 setup="window.offers=[];window.PlumDownloads={offer:(data,name)=>offers.push({data,name})};window.stopped=0;Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,writable:true,value:async()=>({getTracks:()=>[{readyState:'live',addEventListener:()=>{},stop:()=>stopped++},{readyState:'live',addEventListener:()=>{},stop:()=>stopped++}]})});"
 context.add_init_script(setup+script)
 page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.route('**/mobile/**',lambda r:r.fulfill(content_type='application/json',body=json.dumps({'success':True,'data':{'enabled':False}})))
 page.route('**/socket.io/**',lambda r:r.abort())
 page.goto('http://127.0.0.1:5189/chat')
 page.evaluate("""async()=>{const stream=await navigator.mediaDevices.getUserMedia({video:true});window.__plumStopMedia();if(stopped!==2)throw Error('Camera tracks survived background pause');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['private-export'],{type:'text/plain'}));a.download='export.txt';document.body.append(a);a.click();a.remove();}""")
 page.wait_for_function('offers.length===1')
 offer=page.evaluate('offers[0]');assert offer['name']=='export.txt' and base64.b64decode(offer['data'])==b'private-export'
 native=[]
 def redirect(route):native.append(route.request.url);route.fulfill(content_type='text/html',body='Native screen handoff fixture')
 page.route('**/__plum_native_*/**',redirect)
 page.evaluate("history.pushState({},'', '/chat/session/owned-id')")
 page.wait_for_url('**/__plum_native_session/owned-id')
 assert native[-1].endswith('/__plum_native_session/owned-id')
 page.goto('http://127.0.0.1:5189/chat');page.evaluate("history.pushState({},'', '/swarm')");page.wait_for_url('**/__plum_native_area/swarm')
 assert native[-1].endswith('/__plum_native_area/swarm')
 assert not errors,errors
 checks=['exact_native_bootstrap_valid','blob_download_bridge_payload','camera_tracks_stopped_on_pause','session_opens_native_chat','swarm_opens_native_module']
 context.close();browser.close()
Path('reports/plum-android-bootstrap-2026-10-11.json').write_text(json.dumps({'checks':checks,'passed':True,'nativeDeviceExecution':False},indent=2))
print('PASS exact APK bootstrap: download payload, lifecycle media cleanup, native session and swarm navigation')
