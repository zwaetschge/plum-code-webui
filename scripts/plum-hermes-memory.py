#!/usr/bin/env python3
"""Hermes memory file interoperability: native delimiter, lock and atomic replace."""
import fcntl, hashlib, json, os, sys, tempfile, ast, re
from typing import Optional
from pathlib import Path

request = json.load(sys.stdin)
root = Path(request['root']).resolve(strict=True)
target = request['target']
if target not in ('memory', 'user'):
    raise ValueError('Invalid target')
path = root / ('MEMORY.md' if target == 'memory' else 'USER.md')
if path.is_symlink():
    raise ValueError('Symlink memory files are not supported')
delimiter = '\n§\n'
digest = lambda s: hashlib.sha256(s.encode('utf-8')).hexdigest()
with open(str(path)+'.lock', 'a+') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    raw = path.read_text(encoding='utf-8') if path.exists() else ''
    if len(raw.encode('utf-8')) > 1000000:
        raise ValueError('Memory file too large')
    entries = [s.strip() for s in raw.split(delimiter) if s.strip()]
    if request['action'] != 'read':
        if request['expectedHash'] != digest(raw):
            print(json.dumps({'error':'REVISION_CONFLICT'})); sys.exit(0)
        old = request['entryHash']
        index = next((i for i,s in enumerate(entries) if digest(s)==old), None)
        if index is None:
            print(json.dumps({'error':'NOT_FOUND'})); sys.exit(0)
        if request['action'] == 'forget':
            entries = [s for s in entries if digest(s)!=old]
        elif request['action'] == 'revise':
            text = request['text'].strip()
            if not text or delimiter in text or len(text)>50000:
                raise ValueError('Invalid memory text')
            guard = root.parent.parent / 'code' / 'tools' / 'memory_tool.py'
            if guard.exists():
                tree=ast.parse(guard.read_text())
                chosen=[n for n in tree.body if (isinstance(n,ast.FunctionDef) and n.name=='_scan_memory_content') or (isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id in ('_MEMORY_THREAT_PATTERNS','_INVISIBLE_CHARS') for t in n.targets))]
                scope={'re':re,'Optional':Optional}
                exec(compile(ast.Module(body=chosen,type_ignores=[]),str(guard),'exec'),scope)
                blocked=scope['_scan_memory_content'](text)
            else:
                blocked=re.search(r'ignore\s+(?:previous|all|above|prior)\s+instructions|system\s+prompt\s+override|you\s+are\s+now',text,re.I)
            if blocked:
                print(json.dumps({'error':'MEMORY_UNSAFE'})); sys.exit(0)
            entries[index]=text
        else:
            raise ValueError('Invalid action')
        value=delimiter.join(entries)
        # Preserve existing configured larger memories, otherwise honour Hermes' defaults.
        cap=max(len(raw),int(request.get('limit',2200 if target=='memory' else 1375)))
        if len(value)>cap:
            print(json.dumps({'error':'MEMORY_LIMIT'})); sys.exit(0)
        fd,tmp=tempfile.mkstemp(dir=root,prefix='.mem_',suffix='.tmp')
        try:
            with os.fdopen(fd,'w',encoding='utf-8') as f:
                f.write(value); f.flush(); os.fsync(f.fileno())
            if path.exists(): os.chmod(tmp,path.stat().st_mode & 0o777)
            os.replace(tmp,path); raw=value
        finally:
            if os.path.exists(tmp): os.unlink(tmp)
    print(json.dumps({'hash':digest(raw),'entries':[{'hash':digest(s),'text':s} for s in entries]},ensure_ascii=False))
