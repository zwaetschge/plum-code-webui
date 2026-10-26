"""Binary MCP result cards in the actual chat, preview/download and artifact handoff; fake API."""
import base64,json
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright,expect
csv='spalte,wert\nä,2\n'.encode()
png=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4p8AAAAASUVORK5CYII=')
stamp='2026-10-26T04:00:00Z'
chat=dict(id='file-chat',kind='api-chat',title='Dateiergebnisse',revision=1,body=dict(providerId='z-ai',model='glm-5.3-flash',sourceIds=[],memoryRead=False,memoryLearn=False),createdAt=stamp,updatedAt=stamp)
files=[dict(id='csv',filename='ergebnis.csv',mimeType='text/csv',byteLength=len(csv),sha256='a'*64,artifactId='csv-artifact'),dict(id='png',filename='vorschau.png',mimeType='image/png',byteLength=len(png),sha256='b'*64,artifactId='png-artifact')]
turn=dict(id='turn',seq=1,prompt='Erzeuge Ergebnisse',response='Die Dateien sind bereit.',status='completed',model='glm-5.3-flash',providerId='z-ai',sourceVersions=[],imageAssetIds=[],createdAt=stamp,usage=None,toolEvents=[dict(id='tool',name='export',status='completed',result='Gespeichert',files=files)])
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/local/bin/plum-chromium',headless=True)
    for width,height in [(1440,1000),(390,844)]:
        page=browser.new_page(viewport={'width':width,'height':height},accept_downloads=True);page.set_default_timeout(20000)
        page.add_init_script("localStorage.setItem('claude-webui-auth',JSON.stringify({state:{token:'files'},version:0}))")
        errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        def api(route):
            path=urlsplit(route.request.url).path;data={} if 'settings' in path else []
            if '/tool-files/' in path:route.fulfill(content_type='image/png' if path.endswith('/png') else 'text/csv',body=png if path.endswith('/png') else csv);return
            if path=='/auth/me':data=dict(id='file-owner',role='admin',username='Fixture',email='fixture@example.invalid')
            elif path=='/api/basic-auth/status':data=dict(enabled=False)
            elif path=='/api/assistant/personalization':data=dict(revision=1,nickname='',voiceChat=False,suggestedPrompts=False,referencePhotos=dict(portrait=None,fullBody=None))
            elif path=='/api/assistant/overview':data=dict(counts={},tasks=[],recent=[],agents=[])
            elif path=='/api/assistant/api-chat-providers':data=[dict(id='z-ai',name='GLM',protocol='openai',models=['glm-5.3-flash'])]
            elif path=='/api/assistant/api-chats':data=[chat]
            elif path=='/api/assistant/api-chats/file-chat/turns':data=dict(chat=chat,turns=[turn])
            route.fulfill(content_type='application/json',body=json.dumps(dict(success=True,data=data)))
        page.route('**/api/**',api);page.route('**/auth/me',api);page.route('**/socket.io/**',lambda r:r.abort())
        page.goto('http://127.0.0.1:5188/chat/model/file-chat',wait_until='domcontentloaded')
        expect(page.get_by_role('img',name='vorschau.png',exact=True)).to_be_visible()
        figure=page.locator('figure').filter(has_text='ergebnis.csv')
        expect(figure.get_by_role('link',name='In Ergebnissen öffnen',exact=True)).to_have_attribute('href','/assistant/artifacts?resource=csv-artifact')
        with page.expect_download() as download:
            figure.get_by_role('button',name='Datei herunterladen',exact=True).click()
        assert download.value.suggested_filename=='ergebnis.csv';assert Path(download.value.path()).read_bytes()==csv
        page.screenshot(path=f'.screenshots/chat-tool-files-{width}.png')
        page.reload();expect(page.get_by_role('img',name='vorschau.png',exact=True)).to_be_visible()
        assert not page.evaluate('document.documentElement.scrollWidth>innerWidth');assert not errors,errors
        print(f'PASS {width}px: actual chat tool file cards, image preview, exact CSV download, artifact link and reload; fake API/model')
        page.close()
    browser.close()
