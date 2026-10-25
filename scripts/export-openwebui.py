#!/usr/bin/env python3
"""Read a consistent Open WebUI snapshot; keep originals in a private migration archive."""
import hashlib,json,os,pathlib,shutil,sqlite3,sys,datetime
source=pathlib.Path(sys.argv[1]).resolve(); target=pathlib.Path(sys.argv[2]).resolve()
target.mkdir(parents=True,exist_ok=True);target.chmod(0o700)
snapshot=target/'snapshot.sqlite'
if not snapshot.exists():
 with sqlite3.connect(f'file:{source}/webui.db?mode=ro',uri=True) as origin, sqlite3.connect(snapshot) as backup:origin.backup(backup)
 snapshot.chmod(0o600)
c=sqlite3.connect(f'file:{snapshot}?mode=ro',uri=True);c.row_factory=sqlite3.Row
(target/'chats').mkdir(exist_ok=True);(target/'files').mkdir(exist_ok=True)
manifest={'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'users':[],'chats':[],'files':[]}
for row in c.execute('SELECT id,email FROM user'):manifest['users'].append(dict(row))
for row in c.execute('SELECT id,user_id,title,chat,archived,created_at,updated_at FROM chat ORDER BY created_at,id'):
 item=dict(row);payload=json.loads(item.pop('chat')); path=target/'chats'/(item['id']+'.json')
 path.write_text(json.dumps({'id':item['id'],'chat':payload},ensure_ascii=False,separators=(',',':')));path.chmod(0o600)
 manifest['chats'].append({**item,'archive':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
for row in c.execute('SELECT id,user_id,filename,meta,data,path FROM file ORDER BY id'):
 item=dict(row);filename=pathlib.Path(item['path'] or item['filename']).name; original=(source/'uploads'/filename).resolve()
 if not original.is_relative_to((source/'uploads').resolve()):raise ValueError('Invalid original path')
 folder=target/'files'/item['id'];folder.mkdir(exist_ok=True)
 if not original.is_file():item['missing']=True
 else:
  dest=folder/filename
  if not dest.exists():shutil.copy2(original,dest)
  dest.chmod(0o600);item['original']=str(dest);item['bytes']=dest.stat().st_size;item['sha256']=hashlib.sha256(dest.read_bytes()).hexdigest()
 manifest['files'].append(item)
path=target/'manifest.json';path.write_text(json.dumps(manifest,ensure_ascii=False,separators=(',',':')));path.chmod(0o600)
print(json.dumps({'archive':str(target),'chats':len(manifest['chats']),'files':len(manifest['files']),'missingOriginals':sum(bool(f.get('missing')) for f in manifest['files'])}))
