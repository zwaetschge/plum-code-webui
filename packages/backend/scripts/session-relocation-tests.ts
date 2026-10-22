// Sessions follow project folders that moved between the Geekom SSD and the
// Unraid array. Runs against an isolated schema and temporary folders.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'relocation-fixture-session-secret-00000000';
process.env.JWT_SECRET = 'relocation-fixture-jwt-secret-000000000000';
process.env.ENCRYPTION_KEY = 'relocation-fixture-encryption-key-0000000';
const { useTestSchema, createTestSchema, dropTestSchema, databaseReachable } =
  await import('../src/db/testing.js');
useTestSchema();
const { run, get, closePool } = await import('../src/db/pg.js');
const { findRelocatedDirectory, rebasePath } = await import('../src/utils/projectRelocation.js');

const base = await mkdtemp(path.join(tmpdir(), 'plum-relocation-'));
const ssd = path.join(base, 'ssd');
const array = path.join(base, 'array');
const loose = path.join(base, 'loose');
const roots = { equivalent: [ssd, array], search: [ssd, array, loose] };
try {
  // Same relative path under an equivalent root, including nested folders.
  await mkdir(path.join(array, 'game', 'android'), { recursive: true });
  assert.deepEqual(await findRelocatedDirectory(path.join(ssd, 'game', 'android'), roots), {
    path: path.join(array, 'game', 'android'),
    reason: 'equivalent-root',
  });
  // A hand-moved folder found by its unique name.
  await mkdir(path.join(loose, 'notes'), { recursive: true });
  assert.deepEqual(await findRelocatedDirectory('/gone/elsewhere/notes', roots), {
    path: path.join(loose, 'notes'),
    reason: 'unique-name',
  });
  // Two different folders with the same name never rebind a session.
  await mkdir(path.join(ssd, 'twin'), { recursive: true });
  await mkdir(path.join(loose, 'twin'), { recursive: true });
  assert.equal(await findRelocatedDirectory('/gone/twin', roots), null);
  assert.equal(await findRelocatedDirectory('/gone/nowhere', roots), null);
  assert.equal(rebasePath('/a/b/c', '/a/b', '/x'), '/x/c');
  assert.equal(rebasePath('/a/bc', '/a/b', '/x'), '/a/bc');
  console.log('PASS: equivalent roots, unique names, ambiguous and missing folders, path rebasing');

  if (!(await databaseReachable())) throw new Error('isolated database unavailable');
  await createTestSchema();
  try {
    for (const id of ['move-alice', 'move-bob'])
      await run(
        "INSERT INTO users(id,email,provider,provider_id) VALUES (?,?,'test',?)",
        id,
        `${id}@example.invalid`,
        id
      );
    // The real roots: a folder that left /mnt/cache/AI/plum-code for good.
    const missing = '/mnt/cache/AI/plum-code/relocation-fixture-' + path.basename(base);
    const target = path.join(loose, path.basename(missing));
    await mkdir(target, { recursive: true });
    const { relocateSessionDirectories } =
      await import('../src/services/claude/sessionRelocation.js');
    const insert = (id: string, user: string, dir: string, allowed: string[]) =>
      run(
        "INSERT INTO sessions(id,user_id,name,working_directory,allowed_directories,surface) VALUES(?,?,?,?,?,'chat')",
        id,
        user,
        id,
        dir,
        JSON.stringify(allowed)
      );
    await insert('s-root', 'move-alice', missing, [missing + '/data', '/tmp']);
    await insert('s-nested', 'move-alice', missing + '/app', []);
    await insert('s-other', 'move-bob', missing, []);
    await insert('s-prefix', 'move-alice', missing + '-copy', []);
    // The production roots do not include the fixture folder, so pass through the resolver.
    const moved = await relocateSessionDirectories('move-alice', missing, rootsWith(target));
    assert.equal(moved?.to, target);
    assert.equal(moved?.sessions, 2);
    const row = (id: string) =>
      get('SELECT working_directory, allowed_directories FROM sessions WHERE id=?', id);
    assert.equal((await row('s-root')).working_directory, target);
    assert.deepEqual(JSON.parse((await row('s-root')).allowed_directories), [
      target + '/data',
      '/tmp',
    ]);
    assert.equal((await row('s-nested')).working_directory, target + '/app');
    assert.equal((await row('s-other')).working_directory, missing, 'other users untouched');
    assert.equal(
      (await row('s-prefix')).working_directory,
      missing + '-copy',
      'prefix is not a match'
    );
    console.log(
      'PASS: sessions of the owner follow the folder; other users and lookalike paths untouched'
    );
  } finally {
    await dropTestSchema();
  }
} finally {
  await closePool();
  await rm(base, { recursive: true, force: true });
}

function rootsWith(target: string) {
  return { equivalent: [], search: [path.dirname(target)] };
}
