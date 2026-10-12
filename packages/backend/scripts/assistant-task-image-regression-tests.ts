import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, rm, readFile, stat, writeFile, symlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import jwt from 'jsonwebtoken';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'photo-fixture-jwt-secret-00000000000';
const { useTestSchema, createTestSchema, dropTestSchema, databaseReachable } =
  await import('../src/db/testing.js');
useTestSchema();
const { run, get, closePool } = await import('../src/db/pg.js');
const { createResource, reviseResource, BODY_SCHEMAS } =
  await import('../src/services/assistant/resources.js');
const { uploadTaskImage, taskImage, taskImages, removeTaskImage } =
  await import('../src/services/assistant/taskFiles.js');
const { uploadApiImage } = await import('../src/services/assistant/apiFiles.js');
const { purgeTemporaryApiChat } = await import('../src/services/assistant/apiChats.js');
const { executeAssistantTool } = await import('../src/services/assistant/tools.js');
const image = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);
const workspace = await mkdtemp(path.join(tmpdir(), 'plum-task-photo-'));
if (!(await databaseReachable())) {
  await closePool();
  throw new Error('Isolated test database unavailable');
}
try {
  await createTestSchema();
  for (const user of ['photo-alice', 'photo-bob'])
    await run(
      'INSERT INTO users(id,email,provider,provider_id) VALUES(?,?,?,?)',
      user,
      `${user}@fixture.invalid`,
      'test',
      user
    );
  const task = await createResource(
    'photo-alice',
    'task',
    'Bild analysieren',
    BODY_SCHEMAS.task.parse({ goal: 'Originalfarben beschreiben' })
  );
  const uploaded = await uploadTaskImage('photo-alice', task.id, 1, {
    buffer: image,
    originalname: 'Äpfel.png',
  });
  assert.equal(uploaded.task.revision, 2);
  assert.equal(uploaded.image.mimeType, 'image/png');
  assert.equal(uploaded.image.byteLength, image.length);
  assert.deepEqual(
    await uploadTaskImage('photo-alice', task.id, 1, { buffer: image, originalname: 'Retry.png' }),
    uploaded,
    'same bytes reuse confirmed attachment despite stale expected revision'
  );
  assert.deepEqual((await taskImage('photo-alice', task.id, uploaded.image.id)).bytes, image);
  assert.equal((await taskImages('photo-alice', task.id))[0]!.mimeType, 'image/png');
  await assert.rejects(taskImage('photo-bob', task.id, uploaded.image.id));
  const other = await createResource(
    'photo-alice',
    'task',
    'Andere Eingabe',
    BODY_SCHEMAS.task.parse({ goal: 'Separat' })
  );
  await assert.rejects(taskImage('photo-alice', other.id, uploaded.image.id));
  await assert.rejects(
    uploadTaskImage('photo-alice', task.id, 2, {
      buffer: Buffer.from('<script>fixture</script>'),
      originalname: 'fake.png',
    })
  );
  await assert.rejects(
    uploadTaskImage('photo-alice', task.id, 2, {
      buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
      originalname: 'big.png',
    })
  );
  const race = await Promise.allSettled(
    [1, 2].map((n) =>
      uploadTaskImage('photo-alice', task.id, 2, {
        buffer: Buffer.concat([image, Buffer.from(String(n))]),
        originalname: `Bild-${n}.png`,
      })
    )
  );
  assert.equal(race.filter((r) => r.status === 'fulfilled').length, 1);
  const removed = await removeTaskImage('photo-alice', task.id, uploaded.image.id, 3);
  assert.deepEqual(await removeTaskImage('photo-alice', task.id, uploaded.image.id, 3), removed);
  assert.equal(removed.body.inputImageIds instanceof Array, true);
  await assert.rejects(taskImage('photo-alice', task.id, uploaded.image.id));
  assert.deepEqual(
    (await taskImage('photo-alice', task.id, uploaded.image.id, undefined, 2)).bytes,
    image,
    'the own historical revision still exposes its explicitly selected original'
  );
  await assert.rejects(taskImage('photo-alice', task.id, uploaded.image.id, undefined, 1));
  let current = removed;
  for (let i = 0; i < 3; i++)
    current = (
      await uploadTaskImage('photo-alice', task.id, current.revision, {
        buffer: Buffer.concat([image, Buffer.from('other-' + i)]),
        originalname: `Extra-${i}.png`,
      })
    ).task;
  assert.equal((await taskImages('photo-alice', task.id)).length, 4);
  await assert.rejects(
    uploadTaskImage('photo-alice', task.id, current.revision, {
      buffer: Buffer.concat([image, Buffer.from('fifth')]),
      originalname: 'Fifth.png',
    })
  );
  await run(
    "INSERT INTO sessions(id,user_id,name,working_directory,surface) VALUES('photo-worker','photo-alice','fixture',?,'task')",
    workspace
  );
  current = await reviseResource('photo-alice', task.id, current.revision, current.title, {
    ...current.body,
    sessionId: 'photo-worker',
  });
  const chosen = (current.body.inputImageIds as string[])[0]!;
  const result = (await executeAssistantTool('photo-worker', 'photo-alice', {
    name: 'plum_read_task_upload',
    arguments: { taskId: task.id, assetId: chosen },
  })) as { image: { data: string; mimeType: string }; path: string };
  assert.equal(result.image.mimeType, 'image/png');
  assert(Buffer.from(result.image.data, 'base64').subarray(0, image.length).equals(image));
  assert.deepEqual(await readFile(result.path), Buffer.from(result.image.data, 'base64'));
  assert.equal((await stat(result.path)).mode & 0o777, 0o600);
  const { taskImageWorkspace } = await import('../src/services/assistant/taskImageWorkspace.js');
  const chosenFile = await taskImage('photo-alice', task.id, chosen);
  const parallel = await Promise.all(
    Array.from({ length: 4 }, () => taskImageWorkspace('photo-worker', 'photo-alice', chosenFile))
  );
  assert(parallel.every((value) => value === result.path));
  const { comfyui } = await import('../src/services/comfyui/index.js');
  assert.deepEqual(
    (await comfyui.readOwnedImage('photo-alice', result.path)).bytes,
    chosenFile.bytes
  );
  await assert.rejects(comfyui.readOwnedImage('photo-bob', result.path));
  await writeFile(result.path, Buffer.alloc(chosenFile.bytes.length));
  await assert.rejects(taskImageWorkspace('photo-worker', 'photo-alice', chosenFile));
  await rm(result.path);
  await symlink(path.join(workspace, 'outside.png'), result.path);
  await assert.rejects(taskImageWorkspace('photo-worker', 'photo-alice', chosenFile));
  await rm(path.join(workspace, '.claude-webui-images'), { recursive: true });
  await mkdir(path.join(workspace, 'outside'));
  await symlink(path.join(workspace, 'outside'), path.join(workspace, '.claude-webui-images'));
  await assert.rejects(taskImageWorkspace('photo-worker', 'photo-alice', chosenFile));
  await rm(path.join(workspace, '.claude-webui-images'));
  await assert.rejects(
    executeAssistantTool('different-worker', 'photo-alice', {
      name: 'plum_read_task_upload',
      arguments: { taskId: task.id, assetId: chosen },
    })
  );
  await run(
    "INSERT INTO assistant_commands(user_id,command_id,resource_id,payload_hash,action,status,result_json,created_at,updated_at) VALUES('photo-alice',?,?,?,'submit','dispatching','{}',?,?)",
    randomUUID(),
    task.id,
    'fixture',
    new Date().toISOString(),
    new Date().toISOString()
  );
  await assert.rejects(removeTaskImage('photo-alice', task.id, chosen, current.revision));
  const temp = await createResource('photo-alice', 'api-chat', 'Temporär', {
    providerId: 'fixture',
    model: 'fixture',
    temporary: true,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  });
  await uploadApiImage('photo-alice', temp.id, { buffer: image, originalname: 'Same.png' });
  await reviseResource('photo-alice', temp.id, 1, temp.title, {
    ...temp.body,
    expiresAt: '2000-01-01T00:00:00Z',
  });
  assert(await purgeTemporaryApiChat('photo-alice', temp.id));
  assert(
    await get(
      'SELECT id FROM assistant_assets WHERE id=? AND user_id=?',
      uploaded.image.id,
      'photo-alice'
    ),
    'explicit task input revision preserves own original even after it is removed and the temporary chat expires'
  );
  const httpTask = await createResource(
    'photo-alice',
    'task',
    'HTTP-Foto',
    BODY_SCHEMAS.task.parse({ goal: 'Bild prüfen' })
  );
  const { default: assistantRouter } = await import('../src/routes/assistant.js');
  const { errorHandler } = await import('../src/middleware/errorHandler.js');
  const { config } = await import('../src/config.js');
  const app = express();
  app.use(express.json());
  app.use('/api/assistant', assistantRouter);
  app.use(errorHandler);
  const httpServer = await new Promise<import('node:http').Server>((resolve) => {
    const own = app.listen(0, '127.0.0.1', () => resolve(own));
  });
  try {
    const base = `http://127.0.0.1:${(httpServer.address() as { port: number }).port}/api/assistant/tasks/${httpTask.id}`;
    const authorization = `Bearer ${jwt.sign({ userId: 'photo-alice' }, config.jwtSecret, { expiresIn: '1m' })}`;
    const form = new FormData();
    form.append('file', new Blob([image], { type: 'image/png' }), 'Original.png');
    form.append('expectedRevision', '1');
    const response = await fetch(base + '/images', {
      method: 'POST',
      headers: { Authorization: authorization },
      body: form,
    });
    assert.equal(response.status, 201);
    const accepted = (await response.json()).data as {
      task: typeof httpTask;
      image: { id: string };
    };
    const patched = await fetch(base, {
      method: 'PATCH',
      headers: { Authorization: authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: httpTask.title,
        expectedRevision: 2,
        body: { ...accepted.task.body, inputImageIds: ['forged-fixture'], goal: 'Eigene Änderung' },
      }),
    });
    assert.equal(patched.status, 200);
    assert.deepEqual(
      (await patched.json()).data.body.inputImageIds,
      [accepted.image.id],
      'generic metadata editing cannot replace the verified image binding'
    );
    const original = await fetch(base + '/images/' + accepted.image.id, {
      headers: { Authorization: authorization },
    });
    assert.equal(original.status, 200);
    assert.equal(original.headers.get('Cache-Control'), 'private, no-store');
    assert.equal(original.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.deepEqual(Buffer.from(await original.arrayBuffer()), image);
    const foreign = await fetch(base + '/images/' + accepted.image.id, {
      headers: {
        Authorization: `Bearer ${jwt.sign({ userId: 'photo-bob' }, config.jwtSecret, { expiresIn: '1m' })}`,
      },
    });
    assert.equal(foreign.status, 404);
  } finally {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }
  const server = createServer((_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        success: true,
        data: {
          filename: 'fixture.png',
          image: { mimeType: 'image/png', data: image.toString('base64') },
        },
      })
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = (server.address() as { port: number }).port;
    const child = spawn(process.execPath, ['scripts/mcp-servers/assistant.mjs'], {
      env: {
        PATH: process.env.PATH,
        WEBUI_BACKEND_URL: `http://127.0.0.1:${port}`,
        WEBUI_HOOK_SECRET: 'fixture-only',
        WEBUI_SESSION_ID: 'fixture-only',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    try {
      const response = new Promise<Record<string, unknown>>((resolve, reject) => {
        const lines = createInterface({ input: child.stdout });
        const timer = setTimeout(() => reject(new Error('MCP fixture timeout')), 5000);
        lines.on('line', (line) => {
          try {
            const msg = JSON.parse(line);
            if (msg.id === 42) {
              clearTimeout(timer);
              resolve(msg.result);
              lines.close();
            }
          } catch {}
        });
        child.once('error', reject);
      });
      child.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 42,
          method: 'tools/call',
          params: {
            name: 'plum_read_task_upload',
            arguments: { taskId: task.id, assetId: chosen },
          },
        }) + '\n'
      );
      const blocks = (await response).content as Array<{
        type: string;
        data?: string;
        mimeType?: string;
      }>;
      assert.equal(blocks[1]!.type, 'image');
      assert.equal(blocks[1]!.data, image.toString('base64'));
    } finally {
      child.kill('SIGTERM');
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  console.log(
    'PASS: direct Task original images, own selected scope, SHA retry, revision races/removal/limits, pinned native dispatch, current-worker authorization, temporary retention of explicit historical inputs and actual MCP image blocks'
  );
} finally {
  await rm(workspace, { recursive: true, force: true });
  await dropTestSchema();
  await closePool();
}
