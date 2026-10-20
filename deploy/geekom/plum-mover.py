#!/usr/bin/env python3
"""Plum mover: Geekom SSD is the cache tier, the Unraid array the storage tier.

Like Unraid's mover, data that has not been touched for a while moves to the
array. The local path stays usable: it is replaced by a symlink into the array
copy, and the WebUI container mounts /mnt/user at the same path, so sessions
keep reading and writing it (only slower). `promote <path>` brings a unit back.

A unit only moves when
  * nothing in it changed for `idle_days`,
  * no process (host or container) has a file or cwd inside it,
  * it holds no mountpoint and is not one of the NAS-only data paths,
  * the array copy verifies identical after a final sync.

Usage (root):  plum-mover.py run [--dry-run] [--force] [--tier N] | status | promote <path>
  --force   skip the "first writeback finished" check (whole top-level projects
            are safe during a running writeback; nested tiers are not)
  --tier N  only the N-th entry of TIERS (0 = whole projects)
"""
import json, os, shlex, shutil, subprocess, sys, time

ROOT = '/srv/plum'
ARRAY = '/mnt/user/Backup/Geekom-Plum'
REGISTRY = ROOT + '/tiered.json'
LOG = ROOT + '/logs/plum-mover.log'
STAGING = '.plum-mover-staging'
GB = 1 << 30

# path, depth of a unit below it, idle days, minimum size worth moving (bytes)
TIERS = [
    (ROOT + '/projects', 1, 10, 1 * GB),
    (ROOT + '/projects/skyrim-android/.work', 1, 5, 1 * GB),
    (ROOT + '/projects/skyrim-android/.work/agents', 1, 3, GB // 4),
    (ROOT + '/appdata/plum-code-webui/config/codex/sessions', 3, 21, 0),
    (ROOT + '/appdata/plum-code-webui/config/codex/generated_images', 1, 21, 64 << 20),
]
# Container paths of the same data, for the open-file check.
ALIASES = [
    ('/workspace/projects/', ROOT + '/projects/'),
    ('/mnt/cache/AI/plum-code/', ROOT + '/projects/'),
    ('/home/node/.codex/', ROOT + '/appdata/plum-code-webui/config/codex/'),
]
NEVER = {ROOT + '/projects/geekom-server'}
# Copies go over SSH straight onto an array disk: the NFS export is Unraid's
# FUSE user share, which crawls on small files (~1 GB in 40 min for a Gradle cache).
UNRAID = 'root@10.10.10.2'
SSH = ['ssh', '-i', ROOT + '/appdata/plum-code-webui/config/ssh/id_ed25519', '-o', 'BatchMode=yes',
       '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null', '-o', 'LogLevel=ERROR']


def log(msg):
    line = time.strftime('%Y-%m-%dT%H:%M:%S ') + msg
    print(line, flush=True)
    try:
        os.makedirs(os.path.dirname(LOG), exist_ok=True)
        with open(LOG, 'a') as f:
            f.write(line + '\n')
    except OSError:
        pass


def target_of(path):
    """Array location: projects reuse the writeback mirror, the rest goes to tiered/."""
    if path.startswith(ROOT + '/projects/'):
        return ARRAY + '/projects/' + path[len(ROOT + '/projects/'):]
    return ARRAY + '/tiered/' + path[len(ROOT) + 1:]


def registry():
    try:
        with open(REGISTRY) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_registry(data):
    tmp = REGISTRY + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(data, f, indent=1, sort_keys=True)
    os.replace(tmp, REGISTRY)


def nas_paths():
    out = set()
    try:
        for line in open(ROOT + '/deploy/local-projects-nas-paths.txt'):
            line = line.strip()
            if line and not line.startswith('#'):
                out.add(ROOT + '/projects/' + line.rstrip('/'))
    except OSError:
        pass
    return out


def open_paths():
    """Every file, cwd and root currently held by any process, as host paths."""
    seen = set()
    for pid in os.listdir('/proc'):
        if not pid.isdigit():
            continue
        base = '/proc/' + pid
        links = [base + '/cwd']
        try:
            links += [base + '/fd/' + fd for fd in os.listdir(base + '/fd')]
        except OSError:
            pass
        for link in links:
            try:
                p = os.readlink(link)
            except OSError:
                continue
            if not p.startswith('/'):
                continue
            for alias, host in ALIASES:
                if p.startswith(alias):
                    p = host + p[len(alias):]
            seen.add(p)
    return seen


def scan(path, budget_mtime):
    """(size, newest mtime, blocked, file_count); stops early once a fresh file is found.
    blocked: a mountpoint inside, or (when not root) entries owned by someone else."""
    size = newest = files = 0
    me = os.geteuid()
    stack = [path]
    while stack:
        d = stack.pop()
        try:
            st = os.lstat(d)
            newest = max(newest, st.st_mtime)
            with os.scandir(d) as it:
                for e in it:
                    try:
                        s = e.stat(follow_symlinks=False)
                    except OSError:
                        continue
                    newest = max(newest, s.st_mtime)
                    if me and s.st_uid != me:
                        return size, newest, True, files
                    if newest > budget_mtime:
                        return size, newest, False, files
                    if e.is_dir(follow_symlinks=False):
                        if os.path.ismount(e.path):
                            return size, newest, True, files
                        stack.append(e.path)
                    else:
                        size += s.st_blocks * 512
                        files += 1
        except OSError:
            continue
    return size, newest, False, files


def units():
    for base, depth, idle, minimum in TIERS:
        level = [base]
        for _ in range(depth):
            nxt = []
            for d in level:
                try:
                    with os.scandir(d) as it:
                        nxt += [e.path for e in it if e.is_dir(follow_symlinks=False)]
                except OSError:
                    pass
            level = nxt
        for p in sorted(level):
            yield p, idle, minimum


def remote(cmd):
    out = subprocess.run(SSH + [UNRAID, cmd], capture_output=True, text=True)
    if out.returncode:
        raise RuntimeError(f'unraid: {cmd[:80]}: {out.stderr.strip()[-300:]}')
    return out.stdout


def disk_path(dst, size):
    """(target, stale): write `dst` (a /mnt/user path) straight onto one array disk on
    the Unraid host. The writeback mirror may have spread the unit over several disks
    (high-water, no split level); the other disks' parts are `stale` and removed once
    the chosen disk holds the complete copy, so the user share shows exactly it."""
    rel = os.path.relpath(dst, '/mnt/user')
    share = os.path.relpath(ARRAY, '/mnt/user')
    found = remote(
        f'for d in /mnt/disk[0-9]*; do [ -d "$d"/{shlex.quote(share)} ] || continue; '
        f'[ -e "$d"/{shlex.quote(rel)} ] && h=1 || h=0; '
        f'echo "$d $h $(df -P --block-size=1 "$d" | awk \'NR==2{{print $4}}\')"; done; true')
    disks = [(d, h == '1', int(free)) for d, h, free in (l.split() for l in found.splitlines() if l)]
    room = [x for x in disks if x[2] > size * 1.2 + 50 * GB]
    if not room:
        raise RuntimeError('no array disk of the share has room for this unit')
    # Prefer a disk already holding part of the unit (less to copy), then free space.
    disk = max(room, key=lambda x: (x[1], x[2]))[0]
    target = disk + '/' + rel
    remote(f'mkdir -p {shlex.quote(target)}')
    return target, [d + '/' + rel for d, held, _ in disks if held and d != disk]


def rsync(src, target, check=False):
    """Local unit -> `target` on the Unraid host. --delete: the copy must equal the unit
    exactly (stale cache leftovers in the mirror would fail verification forever)."""
    args = ['rsync', '-aH', '--sparse', '--numeric-ids', '--delete', '--protect-args',
            '-e', ' '.join(shlex.quote(a) for a in SSH)]
    if check:
        args += ['-n', '--itemize-changes']
    out = subprocess.run(args + [src.rstrip('/') + '/', f'{UNRAID}:{target.rstrip("/")}/'],
                         capture_output=True, text=True)
    if out.returncode not in (0, 24):
        raise RuntimeError(f'rsync {src} -> {target} failed: {out.stderr.strip()[-500:]}')
    return out.stdout


def count_local(path):
    """Non-directory entries, symlinks counted as entries (matches `find ! -type d`)."""
    n, stack = 0, [path]
    while stack:
        with os.scandir(stack.pop()) as it:
            for e in it:
                if e.is_dir(follow_symlinks=False):
                    stack.append(e.path)
                else:
                    n += 1
    return n


def count_remote(target):
    return int(remote(f'find {shlex.quote(target)} ! -type d | wc -l').strip())


def traversable(dst):
    """Container sessions run as uid 1000: every directory leading to an array copy
    needs the search bit. Only x is added, so DB dumps and .env next to it stay private."""
    d = ARRAY
    for part in [''] + os.path.relpath(dst, ARRAY).split(os.sep):
        d = os.path.join(d, part) if part else d
        if not os.path.isdir(d):
            os.makedirs(d, mode=0o755, exist_ok=True)
            os.chmod(d, 0o755)  # makedirs honours the 077 umask of the writeback
        mode = os.stat(d).st_mode & 0o7777
        if mode & 0o111 != 0o111:
            os.chmod(d, mode | 0o111)


def move(path, size, dry):
    dst = target_of(path)
    log(f'{"would move" if dry else "moving"} {path} ({size / GB:.1f} GB) -> {dst}')
    if dry:
        return True
    free = shutil.disk_usage(ARRAY).free
    if free < size * 1.2 + 50 * GB:
        log(f'skip {path}: array has only {free / GB:.0f} GB free')
        return False
    traversable(dst)
    target, stale = disk_path(dst, size)
    rsync(path, target)  # bulk copy while the unit is still in place
    if stale:  # complete copy now on one disk; drop the mirror's scattered parts
        remote('rm -rf ' + ' '.join(shlex.quote(p) for p in stale))
    staging = os.path.join(os.path.dirname(path), STAGING + '-' + os.path.basename(path))
    os.rename(path, staging)  # anything opening the old path now gets the symlink
    os.symlink(dst, path)
    try:
        rsync(staging, target)  # catch writes since the bulk copy
        diff = [l for l in rsync(staging, target, check=True).splitlines()
                if l and not l.startswith('.d')]
        local, there = count_local(staging), count_remote(target)
        if diff or local != there:
            raise RuntimeError(f'verify failed: {len(diff)} differences, files {local} vs {there}')
        if sorted(os.listdir(staging)) != sorted(os.listdir(dst)):
            raise RuntimeError('array copy is not visible through the NFS user share')
    except Exception as exc:
        os.unlink(path)
        os.rename(staging, path)
        log(f'rolled back {path}: {exc}')
        return False
    data = registry()
    data[path] = {'target': dst, 'bytes': size, 'movedAt': time.strftime('%Y-%m-%dT%H:%M:%S')}
    save_registry(data)
    shutil.rmtree(staging)
    log(f'moved {path}, freed {size / GB:.1f} GB')
    return True


def run(dry, force=False):
    if not dry and not force and not os.path.exists(ROOT + '/project-writeback-last-success'):
        log('no successful writeback yet; mover waits')
        return
    if subprocess.run(['findmnt', '-rn', '-t', 'nfs4', '-T', '/mnt/user'],
                      capture_output=True).returncode:
        log('array not mounted; mover waits')
        return
    held = open_paths()
    blocked = nas_paths() | NEVER
    now = time.time()
    total = 0
    for path, idle, minimum in units():
        if os.path.basename(path).startswith(STAGING) or path in blocked:
            continue
        if any(b.startswith(path + '/') for b in blocked):
            continue
        if any(t[0] == path for t in TIERS):
            continue  # a tier root itself is never moved whole
        if any(h == path or h.startswith(path + '/') for h in held):
            continue
        size, newest, has_mount, _ = scan(path, now - idle * 86400)
        if has_mount or newest > now - idle * 86400 or size < minimum:
            continue
        try:
            if move(path, size, dry):
                total += size
        except Exception as exc:  # one unit failing must not stop the others
            log(f'skip {path}: {exc}')
    log(f'{"would free" if dry else "freed"} {total / GB:.1f} GB')


def promote(path):
    path = os.path.abspath(path)
    data = registry()
    entry = data.get(path)
    if not entry or not os.path.islink(path):
        sys.exit(f'{path} is not a moved unit')
    staging = os.path.join(os.path.dirname(path), STAGING + '-' + os.path.basename(path))
    pull = ['rsync', '-aH', '--sparse', '--numeric-ids', '--delete']
    subprocess.run(pull + [entry['target'] + '/', staging + '/'], check=True)
    os.unlink(path)
    os.rename(staging, path)
    subprocess.run(pull + [entry['target'] + '/', path + '/'], check=True)  # writes made meanwhile
    del data[path]
    save_registry(data)
    log(f'promoted {path} back to the Geekom SSD (array copy kept)')


def status():
    data = registry()
    total = sum(e['bytes'] for e in data.values())
    for p, e in sorted(data.items()):
        print(f'{e["bytes"] / GB:8.1f} GB  {e["movedAt"]}  {p}')
    print(f'{len(data)} units, {total / GB:.1f} GB on the array')


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'status'
    if cmd == 'run':
        if '--tier' in sys.argv:
            TIERS[:] = [TIERS[int(sys.argv[sys.argv.index('--tier') + 1])]]
        run('--dry-run' in sys.argv, '--force' in sys.argv)
    elif cmd == 'promote' and len(sys.argv) == 3:
        promote(sys.argv[2])
    elif cmd == 'status':
        status()
    else:
        sys.exit(__doc__)
