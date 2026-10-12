import json,os
from urllib.parse import urlsplit,parse_qs
from playwright.sync_api import sync_playwright,expect
url=os.environ.get('PLUM_FIXTURE_URL','http://127.0.0.1:5188');assert url.startswith(('http://127.0.0.1:','http://localhost:'))
user={'id':'board-browser-alice','email':'alice@example.invalid','role':'admin'}
date='2026-10-10T08:00:00Z'
tasks=[{'id':f'board-{i}','kind':'task','revision':1,'title':f'Auftrag {i:02}','createdAt':date,'updatedAt':date,'body':{'status':'running' if i in [1,51] else 'draft','goal':'Gespeicherter Auftrag','provider':'codex','priority':i,'sourceIds':[],'parentId':'board-51' if i==1 else None,**({'dueAt':'2000-01-01T00:00:00Z'} if i==1 else {})}} for i in range(1,52)]
queries=[];errors=[]
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/local/bin/plum-chromium',headless=True);page=browser.new_page(viewport={'width':1440,'height':1000})
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.add_init_script("localStorage.setItem('claude-webui-auth',JSON.stringify({state:{token:'board-browser-fixture'},version:0}))")
    def api(route):
        request=route.request;parsed=urlsplit(request.url);path=parsed.path;q=parse_qs(parsed.query);data={} if 'settings' in path else []
        assert request.method=='GET', 'Board must not mutate or start work'
        if path=='/auth/me':data=user
        elif path=='/api/basic-auth/status':data={'enabled':False}
        elif path=='/api/assistant/overview':data={'counts':{},'recent':[],'tasks':[],'agents':[]}
        elif path=='/api/assistant/tasks':
            queries.append(q);data=tasks
            if q.get('status'):data=[t for t in data if t['body']['status']==q['status'][0]]
            if q.get('sort')==['priority']:data=sorted(data,key=lambda t:-t['body']['priority'])
            elif q.get('sort')==['deadline']:data=sorted(data,key=lambda t:t['body'].get('dueAt','9999'))
            offset=int(q.get('offset',['0'])[0]);limit=int(q.get('limit',['50'])[0]);data=data[offset:offset+limit]
        elif path.startswith('/api/assistant/tasks/board-') and '/' not in path[len('/api/assistant/tasks/'):]:data=next(t for t in tasks if t['id']==path.split('/')[-1])
        elif path.endswith('/limits'):data={'knownCostUsd':0,'budgetUsd':None,'scope':'cli'}
        route.fulfill(content_type='application/json',body=json.dumps({'success':True,'data':data}))
    page.route('**/api/**',api);page.route('**/auth/me',api);page.route('**/socket.io/**',lambda r:r.abort())
    page.goto(url+'/assistant/tasks')
    board=page.get_by_role('region',name='Task-Board',exact=True)
    expect(board.get_by_role('button')).to_have_count(50)
    expect(board.get_by_role('link',name='Übergeordneten Auftrag öffnen (nicht in den geladenen Treffern)',exact=True)).to_have_attribute('href','/assistant/tasks?resource=board-51')
    page.get_by_role('button',name='Weitere Einträge laden',exact=True).click()
    expect(board.get_by_role('button')).to_have_count(51)
    expect(board.get_by_role('link',name='Übergeordnet: Auftrag 51',exact=True)).to_be_visible()
    child=board.get_by_role('button',name='Auftrag 01 In Arbeit',exact=True).locator('xpath=ancestor::li[1]')
    assert child.evaluate('el=>el.style.paddingInlineStart')=='12px'
    page.get_by_label('Teilaufträge als Baum',exact=True).uncheck()
    assert child.evaluate('el=>el.style.paddingInlineStart')=='0px'
    page.get_by_label('Teilaufträge als Baum',exact=True).check()
    page.get_by_role('combobox',name='Taskstatus',exact=True).select_option('running')
    expect(board.get_by_role('button')).to_have_count(2)
    assert queries[-1]['status']==['running'] and queries[-1]['offset']==['0']
    page.get_by_role('combobox',name='Taskreihenfolge',exact=True).select_option('priority')
    expect(board.get_by_role('button').first).to_have_text('Auftrag 51In Arbeit')
    assert queries[-1]['sort']==['priority'] and queries[-1]['status']==['running']
    expect(board.get_by_text('Überfällig:',exact=False)).to_be_visible()
    page.screenshot(path='.probe/plum-assistant/task-board-desktop.png',full_page=True,timeout=90000,animations='disabled')
    page.set_viewport_size({'width':390,'height':844});page.screenshot(path='.probe/plum-assistant/task-board-mobile.png',full_page=True,timeout=90000,animations='disabled')
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    board.get_by_role('link',name='Übergeordnet: Auftrag 51',exact=True).click()
    expect(page).to_have_url(url+'/assistant/tasks?resource=board-51')
    expect(page.get_by_role('heading',name='Auftrag 51',exact=True)).to_be_visible()
    expect(page.locator('#assistant-selected-title')).to_be_in_viewport()
    assert not errors,errors
    print('PASS: real Task board, honest missing parent, next-page tree reconciliation, list/tree switch, whole-result status/sort requests and offset reset, overdue deadline, parent navigation and desktop/mobile widths')
    browser.close()
