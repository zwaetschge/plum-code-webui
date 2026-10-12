"""Actual React routes with isolated API fixtures; never connects to a live account."""
import json
import os
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright, expect

url = os.environ.get('PLUM_FIXTURE_URL', 'http://127.0.0.1:5188')
assert url.startswith(('http://127.0.0.1:', 'http://localhost:'))
user = {'id': 'fixture-alice', 'username': 'Fixture Alice', 'email': 'alice@fixture.invalid', 'role': 'admin'}


def resource(kind, ident, title, body):
    return {'id': ident, 'kind': kind, 'title': title, 'body': body, 'revision': 1, 'createdAt': '2026-10-10T00:00:00Z', 'updatedAt': '2026-10-10T00:00:00Z'}


source = resource('source', 'office-fixture', 'Meine Vorbereitung.xlsx', {'text': 'Wissen', 'office': {'kind': 'xlsx', 'sheets': [{'name': 'Daten', 'grid': [['2', '=SUM(A1,3)']]}], 'warnings': ['Layout steht im Original.']}})
artifact = resource('artifact', 'editable-fixture', 'Private Datei Alice', {'type': 'table', 'format': 'json', 'content': json.dumps({'type': 'plum-sheet', 'version': 1, 'cells': [['2', '=SUM(A1,3)']]}), 'sourceIds': [source['id']], 'tags': []})
sources = [resource('source', f'source-{i}', f'Notiz {i}', {'text': f'Inhalt {i}'}) for i in range(55)] + [source]
courses = []
posts = []
joined = False
account = user
room = '!lobby:fixture.invalid'
hub = '@schwarm:fixture.invalid'
models = {'type': 'ch.zwaetschge.swarm.modelle', 'state_key': 'brian', 'sender': hub, 'content': {'v': 1, 'agent': 'brian', 'einstellbar': True, 'modell': 'glm-5.1', 'modelle': [{'id': 'glm-5.1'}, {'id': 'glm-5.2'}, {'id': 'gpt-fixture'}], 'fallback': [], 'fallback_max': 2, 'fallback_aenderbar': True, 'aufwaende': ['low', 'high'], 'aufwand': 'low'}}

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/local/bin/plum-chromium', headless=True)
    page = browser.new_page(viewport={'width': 390, 'height': 844})
    page.set_default_timeout(15000)
    page.add_init_script("localStorage.setItem('claude-webui-auth', " + json.dumps(json.dumps({'state': {'user': user, 'token': 'isolated-fixture', 'isAuthenticated': True}, 'version': 0})) + ");")

    def api(route):
        global joined
        u = urlparse(route.request.url)
        path, method = u.path, route.request.method
        data = []
        status = 200
        if method == 'POST':
            body = json.loads(route.request.post_data or '{}')
            posts.append((path, body))
            if path == '/api/assistant/references':
                data = [item for item in sources + courses if item['id'] in body['ids']]
            elif path == '/api/assistant/courses':
                data = resource('course', 'course-fixture', body['title'], body['body'])
                courses.append(data)
            elif path.endswith('/office-artifact'):
                assert body['expectedRevision'] == 1 and body['sheet'] == 0 and body['commandId']
                data = artifact
            elif path.endswith('/membership'):
                assert body['nativeUserId'] == '@alice:fixture.invalid'
                joined = body['action'] == 'join'
                data = {'roomId': '!invited:fixture.invalid', 'action': body['action']}
        elif path == '/auth/me':
            data = account
        elif path == '/api/basic-auth/status':
            data = {'enabled': False}
        elif path == '/api/assistant/overview':
            data = {'counts': {}, 'tasks': [], 'recent': [], 'agents': []}
        elif path == '/api/assistant/projects':
            data = [resource('project','health-workspace','Meine Befunde',{'instructions':'Eigene Unterlagen'})]
        elif path == '/api/assistant/sources':
            query = parse_qs(u.query)
            term = query.get('search', [''])[0].lower()
            offset = int(query.get('offset', ['0'])[0])
            data = [item for item in sources if term in item['title'].lower()][offset:offset+50]
        elif path == '/api/assistant/sources/office-fixture':
            data = source
        elif path == '/api/assistant/courses':
            data = courses
        elif path == '/api/assistant/artifacts/editable-fixture':
            data = artifact if account['id'] == user['id'] else {}
            status = 200 if account['id'] == user['id'] else 404
        elif path == '/api/assistant/matrix/status':
            data = {'configured': True, 'connected': True, 'userId': '@alice:fixture.invalid', 'epoch': 'fixture-epoch'}
        elif path == '/api/assistant/matrix/rooms':
            data = [{'id': room, 'name': 'Fixture Lobby', 'alias': '#schwarm-lobby:fixture.invalid', 'encrypted': False, 'agents': [], 'state': [models]}]
        elif path == '/api/assistant/matrix/invitations':
            data = [] if joined else [{'id': '!invited:fixture.invalid', 'name': 'Gemeinsam', 'invitedBy': '@friend:fixture.invalid'}]
        elif path.endswith('/messages'):
            data = {'chunk': []}
        elif 'settings' in path:
            data = {}
        route.fulfill(status=status, content_type='application/json', body=json.dumps({'success': status == 200, 'data': data, **({'error': 'Nicht gefunden'} if status != 200 else {})}))

    page.route('**/api/**', api)
    page.route('**/auth/me', api)
    page.route('**/socket.io/**', lambda route: route.abort())
    page.goto(url + '/assistant/courses')
    page.get_by_role('button', name='Neu', exact=True).click()
    page.get_by_label('Name', exact=True).fill('Eigenes Lernen')
    page.get_by_role('button', name='Lektion hinzufügen', exact=True).click()
    page.get_by_label('Titel', exact=True).first.fill('Lektion 1')
    page.get_by_label('Lektionsquellen durchsuchen', exact=True).fill('Meine Vorbereitung')
    page.get_by_role('checkbox', name='Meine Vorbereitung.xlsx', exact=True).check()
    page.get_by_role('button', name='Quizfrage hinzufügen', exact=True).click()
    page.get_by_label('Frage', exact=True).fill('Frage eins')
    page.get_by_label('Antwort 1', exact=True).fill('Falsch')
    page.get_by_label('Antwort 2', exact=True).fill('Richtig')
    page.get_by_role('radio', name='Antwort 2 ist richtig', exact=True).check()
    page.get_by_role('button', name='Quizfrage hinzufügen', exact=True).click()
    page.get_by_label('Frage', exact=True).nth(1).fill('Frage zwei')
    page.get_by_label('Antwort 1', exact=True).nth(1).fill('Erste')
    page.get_by_label('Antwort 2', exact=True).nth(1).fill('Zweite')
    page.get_by_role('radio', name='Antwort 1 ist richtig', exact=True).nth(1).check()
    assert page.get_by_role('radio', name='Antwort 2 ist richtig', exact=True).first.is_checked()
    page.get_by_role('button', name='Speichern', exact=True).click()
    page.get_by_role('button', name='Neu', exact=True).wait_for()
    assert courses[0]['body']['lessons'][0]['sourceIds'] == [source['id']]
    assert [item['correct'] for item in courses[0]['body']['lessons'][0]['questions']] == [1, 0]
    print('PASS: actual course authoring, paginated source search and independent question choices', flush=True)
    page.goto(url + '/assistant/sources?project=health-workspace')
    expect(page.get_by_role('combobox',name='Wissensprojekt',exact=True)).to_have_value('health-workspace')
    print('PASS: personal document workspace link preselects the actual own source-import project', flush=True)
    page.goto(url + '/assistant/sources?resource=office-fixture')
    page.get_by_role('button', name='Als Plum-Tabelle bearbeiten', exact=True).click()
    page.get_by_role('heading', name=artifact['title'], exact=True).wait_for()
    expect(page.get_by_role('cell', name='5', exact=True)).to_be_visible()
    print('PASS: Office source to actual formula-table route', flush=True)
    page.goto(url + '/swarm')
    page.get_by_text('Schwarm steuern', exact=True).click()
    page.get_by_label('Bereich', exact=True).select_option('modelle')
    page.get_by_label('Hauptmodell', exact=True).select_option('glm-5.2')
    page.get_by_label('Ersatzmodell hinzufügen', exact=True).select_option('gpt-fixture')
    page.get_by_label('Reasoning-Aufwand', exact=True).select_option('high')
    page.get_by_role('button', name='Modelländerung vorbereiten', exact=True).click()
    expect(page.get_by_role('textbox', name='Neue Nachricht', exact=True)).to_have_value('!modell @brian glm-5.2 fallback gpt-fixture aufwand high')
    assert not any(path.endswith('/events') for path, _ in posts)
    page.get_by_label('Räume und Mitglieder', exact=True).locator('summary').click()
    page.get_by_role('button', name='Beitreten', exact=True).click()
    expect(page.get_by_text('Keine offenen Einladungen.', exact=True)).to_be_visible()
    assert joined
    print('PASS: native model/fallback/effort command preparation and identity-bound invitation', flush=True)
    page.goto(url + '/assistant/artifacts?resource=editable-fixture')
    page.get_by_role('heading', name=artifact['title'], exact=True).wait_for()
    account = {**user, 'id': 'fixture-bob', 'username': 'Fixture Bob'}
    page.evaluate("async user=>{const {useAuthStore}=await import('/src/stores/authStore.ts');useAuthStore.setState({user,isAuthenticated:true});}", account)
    expect(page.get_by_role('heading', name=artifact['title'], exact=True)).to_have_count(0)
    print('PASS: account switch remounts personal state and separates query caches', flush=True)
    browser.close()
