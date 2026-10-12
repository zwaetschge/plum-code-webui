import json, os
from playwright.sync_api import sync_playwright, expect
url=os.environ.get('PLUM_FIXTURE_URL','http://127.0.0.1:5188');assert url.startswith(('http://127.0.0.1:','http://localhost:'))
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/local/bin/plum-chromium',headless=True)
    page=browser.new_page(viewport={'width':390,'height':844},reduced_motion='reduce');errors=[];requests=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    def api(route):
        assert route.request.method=='PATCH'
        payload=json.loads(route.request.post_data);requests.append(payload)
        page.evaluate('(body)=>window.__savedBody=body',payload['body'])
        route.fulfill(content_type='application/json',body=json.dumps({'data':{'id':'motion-fixture'}}))
    page.route('**/api/**',api);page.goto(url+'/scripts/fixtures/assistant-motion.html')
    page.get_by_role('button',name='Als Animation gestalten',exact=True).click()
    expect(page.get_by_role('button',name='Abspielen',exact=True)).to_be_visible()
    page.get_by_label('Ziel X 1',exact=True).fill('420');page.get_by_label('Ziel X 1',exact=True).press('Tab')
    page.get_by_label('Animationstext 2',exact=True).fill('Übersicht <script>kein Code</script>')
    page.get_by_label('Animationszeitpunkt',exact=True).fill('39')
    expect(page.locator('svg circle')).to_have_attribute('cx','460')
    expect(page.locator('svg text')).to_contain_text('<script>kein Code</script>')
    assert page.locator('svg script').count()==0
    page.get_by_role('button',name='Element hinzufügen',exact=True).click()
    page.get_by_role('combobox',name='Form 3',exact=True).select_option('text')
    page.get_by_label('Animationstext 3',exact=True).fill('Neues Element')
    page.get_by_role('button',name='Neue Revision speichern',exact=True).click()
    expect(page.get_by_role('button',name='MP4',exact=True)).to_be_visible()
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.screenshot(path='.probe/plum-assistant/motion-mobile.png',full_page=True)
    page.set_viewport_size({'width':1440,'height':900});page.screenshot(path='.probe/plum-assistant/motion-desktop.png',full_page=True)
    page.get_by_role('button',name='Abspielen',exact=True).click();expect(page.get_by_role('button',name='Anhalten',exact=True)).to_be_visible()
    page.get_by_role('button',name='Anhalten',exact=True).click();expect(page.get_by_role('button',name='Abspielen',exact=True)).to_be_visible()
    assert len(requests)==1 and requests[0]['expectedRevision']==1
    model=json.loads(requests[0]['body']['content']);assert model['shapes'][0]['toX']==420 and len(model['shapes'])==3
    page.get_by_role('button',name='Bearbeiten',exact=True).click()
    page.get_by_label('Bewegungsmodell',exact=True).select_option('physics')
    expect(page.get_by_label('Ziel X 1',exact=True)).to_have_count(0)
    page.get_by_label('Schwerkraft (px/s²)',exact=True).fill('120');page.get_by_label('Schwerkraft (px/s²)',exact=True).press('Tab')
    page.get_by_label('Startgeschwindigkeit X (px/s)',exact=True).fill('60');page.get_by_label('Startgeschwindigkeit X (px/s)',exact=True).press('Tab')
    page.get_by_label('Animationszeitpunkt',exact=True).fill('10')
    assert float(page.locator('svg circle').get_attribute('cy'))>190
    page.get_by_role('button',name='Neue Revision speichern',exact=True).click()
    expect(page.get_by_label('Bewegungsmodell',exact=True)).to_have_count(0)
    assert json.loads(requests[-1]['body']['content'])['physics']['gravity']==120
    page.set_viewport_size({'width':390,'height':844});page.screenshot(path='.probe/plum-assistant/motion-physics-mobile.png',full_page=True)
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    assert not errors,errors
    print('PASS: animation conversion, explicit preview time, escaped text, element creation, revision save, explicit playback under reduced motion, editable gravity/velocity simulation and narrow/desktop view')
    browser.close()
