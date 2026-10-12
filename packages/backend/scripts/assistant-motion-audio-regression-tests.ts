import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import jwt from 'jsonwebtoken';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'motion-audio-fixture-secret-000000000000';
const { useTestSchema, createTestSchema, dropTestSchema, databaseReachable } =
  await import('../src/db/testing.js');
useTestSchema();
const { run, get, closePool } = await import('../src/db/pg.js');
const { createResource, findResource, reviseResource, BODY_SCHEMAS } =
  await import('../src/services/assistant/resources.js');
const { waveFacts, addMotionAudio, readMotionAudio } =
  await import('../src/services/assistant/motionAudio.js');
const { exportArtifact } = await import('../src/services/assistant/exports.js');
const { motionFromText } = await import('@plum-code-webui/shared');
const { default: router } = await import('../src/routes/assistant.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');
function tone(seconds = 1) {
  const rate = 16000,
    size = Math.round(seconds * rate) * 2,
    out = Buffer.alloc(44 + size);
  out.write('RIFF');
  out.writeUInt32LE(out.length - 8, 4);
  out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(rate, 24);
  out.writeUInt32LE(rate * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36);
  out.writeUInt32LE(size, 40);
  for (let n = 0; n < size / 2; n++)
    out.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * n) / rate) * 12000), 44 + n * 2);
  return out;
}
const audio = tone(),
  app = express();
app.use(express.json());
app.use('/api/assistant', router);
app.use(errorHandler);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>((resolve) => server.once('listening', resolve));
const address = server.address();
assert(address && typeof address !== 'string');
const origin = `http://127.0.0.1:${address.port}`;
const directory = await mkdtemp(path.join(os.tmpdir(), 'plum-motion-audio-test-'));
if (!(await databaseReachable())) {
  await closePool();
  server.close();
  throw new Error('Own test database unavailable');
}
try {
  await createTestSchema();
  for (const id of ['audio-alice', 'audio-bob'])
    await run(
      "INSERT INTO users(id,email,provider,provider_id) VALUES(?,?,'test',?)",
      id,
      `${id}@fixture.invalid`,
      id
    );
  const model = { ...motionFromText('Clip'), width: 320, height: 180, duration: 2, fps: 2 };
  const artifact = await createResource(
    'audio-alice',
    'artifact',
    'Vertonter Clip',
    BODY_SCHEMAS.artifact.parse({ type: 'video', format: 'json', content: JSON.stringify(model) })
  );
  assert.equal(waveFacts(audio).duration, 1);
  assert.equal(waveFacts(audio).rate, 16000);
  const wrong = Buffer.from(audio);
  wrong.writeUInt32LE(99, 4);
  assert.throws(() => waveFacts(wrong), /WAV/);
  const codec = Buffer.from(audio);
  codec.writeUInt16LE(65534, 20);
  assert.throws(() => waveFacts(codec), /WAV/);
  const rate = Buffer.from(audio);
  rate.writeUInt32LE(1, 24);
  assert.throws(() => waveFacts(rate), /WAV/);
  const input = { commandId: randomUUID(), expectedRevision: 1 },
    file = { buffer: audio, originalname: '../OmniVoice-Auswahl.wav' };
  const duplicate = await Promise.all([
    addMotionAudio('audio-alice', artifact.id, input, file),
    addMotionAudio('audio-alice', artifact.id, input, file),
  ]);
  assert.deepEqual(duplicate[0], duplicate[1]);
  const saved = duplicate[0]!;
  assert.equal(saved.revision, 2);
  assert.equal(saved.body.audio.duration, 1);
  assert.equal(saved.body.audio.filename, 'OmniVoice-Auswahl.wav');
  assert.equal(saved.body.audio.sha256, createHash('sha256').update(audio).digest('hex'));
  await assert.rejects(
    addMotionAudio(
      'audio-alice',
      artifact.id,
      { ...input, commandId: randomUUID(), expectedRevision: 2 },
      { ...file, buffer: tone(3) }
    ),
    /geändert|länger/
  );
  await assert.rejects(
    addMotionAudio('audio-alice', artifact.id, input, { ...file, originalname: 'Anders.wav' }),
    /anderen Inhalt/
  );
  await assert.rejects(readMotionAudio('audio-bob', saved.body), /nicht verfügbar/);
  await assert.rejects(
    reviseResource('audio-alice', artifact.id, 2, saved.title, {
      ...saved.body,
      content: JSON.stringify({ ...model, duration: 1 }),
      audioAssetId: randomUUID(),
    }),
    /Original nicht gefunden/
  );
  const clip = await exportArtifact(saved, 'mp4', 'audio-alice'),
    clipPath = path.join(directory, 'with-audio.mp4');
  await writeFile(clipPath, clip.data);
  const probe = JSON.parse(
    (
      await promisify(execFile)('ffprobe', [
        '-v',
        'error',
        '-show_streams',
        '-of',
        'json',
        clipPath,
      ])
    ).stdout
  );
  assert.equal(probe.streams.find((s: any) => s.codec_type === 'video').codec_name, 'h264');
  const stream = probe.streams.find((s: any) => s.codec_type === 'audio');
  assert.equal(stream.codec_name, 'aac');
  assert.equal(stream.channels, 1);
  assert(Math.abs(Number(stream.duration) - 2) < 0.05);
  const pcm = path.join(directory, 'decoded.pcm');
  await promisify(execFile)('ffmpeg', [
    '-nostdin',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    clipPath,
    '-map',
    '0:a:0',
    '-f',
    's16le',
    '-ac',
    '1',
    '-ar',
    '16000',
    pcm,
  ]);
  const decoded = await readFile(pcm);
  const rms = (from: number, to: number) => {
    let sum = 0,
      n = 0;
    for (let i = from; i < Math.min(to, decoded.length / 2); i++) {
      sum += decoded.readInt16LE(i * 2) ** 2;
      n++;
    }
    return Math.sqrt(sum / n);
  };
  assert(rms(2000, 12000) > 5000, 'Actual audible tone');
  assert(rms(22000, 29000) < 20, 'Actual padded silence');
  const token = jwt.sign({ userId: 'audio-alice' }, process.env.JWT_SECRET!),
    foreign = jwt.sign({ userId: 'audio-bob' }, process.env.JWT_SECRET!);
  const own = await fetch(`${origin}/api/assistant/artifacts/${artifact.id}/audio?revision=2`, {
    headers: { Authorization: 'Bearer ' + token },
  });
  assert.equal(own.status, 200);
  assert.equal(own.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(Buffer.from(await own.arrayBuffer()), audio);
  assert.equal(
    (
      await fetch(`${origin}/api/assistant/artifacts/${artifact.id}/audio?revision=2`, {
        headers: { Authorization: 'Bearer ' + foreign },
      })
    ).status,
    404
  );
  const share = (await (
    await fetch(origin + '/api/assistant/shares', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resourceId: artifact.id,
        revision: 2,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      }),
    })
  ).json()) as any;
  const sharedPath = origin + share.data.path + '/audio',
    shared = await fetch(sharedPath, { headers: { Authorization: 'Bearer ' + foreign } });
  assert.equal(shared.status, 200);
  assert.deepEqual(Buffer.from(await shared.arrayBuffer()), audio);
  await fetch(origin + '/api/assistant/shares/' + share.data.id, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + token },
  });
  assert.equal(
    (await fetch(sharedPath, { headers: { Authorization: 'Bearer ' + foreign } })).status,
    404
  );
  const remove = await addMotionAudio(
    'audio-alice',
    artifact.id,
    { commandId: randomUUID(), expectedRevision: 2 },
    null
  );
  assert.equal(remove.revision, 3);
  assert.equal(remove.body.audioAssetId, undefined);
  assert.deepEqual(
    (await readMotionAudio('audio-alice', saved.body)).bytes,
    audio,
    'Historical original remains exact after detaching'
  );
  assert.equal(Number((await get('SELECT COUNT(*) AS n FROM assistant_assets')).n), 1);
  await run(
    'UPDATE assistant_assets SET bytes=? WHERE id=?',
    Buffer.from(audio).fill(0, 44, 48),
    saved.body.audioAssetId
  );
  await assert.rejects(readMotionAudio('audio-alice', saved.body), /verändert/);
  assert.equal((await findResource('audio-alice', artifact.id)).revision, 3);
  console.log(
    'PASS: actual PCM samples and bounded WAV parsing, own SQL audio SHA/UUID/revisions, H.264+AAC with decoded audible tone and padded silence, private/snapshot/revoked HTTP original rights and preserved history; no Vocarium/provider request'
  );
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(directory, { recursive: true, force: true });
  await dropTestSchema();
}
