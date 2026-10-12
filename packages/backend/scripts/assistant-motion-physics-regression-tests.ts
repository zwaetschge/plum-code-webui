import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import {
  motionFromText,
  parseAssistantMotion,
  assistantMotionPosition,
  assistantMotionSvg,
} from '@plum-code-webui/shared';
import { exportArtifact } from '../src/services/assistant/exports.js';
const shape = { ...motionFromText('').shapes[0]!, x: 20, y: 20, width: 20, height: 20 };
const model = parseAssistantMotion(
  JSON.stringify({
    ...motionFromText(''),
    width: 320,
    height: 180,
    duration: 2,
    fps: 2,
    shapes: [shape],
    physics: { gravity: 60, bounce: 1, velocityX: 60, velocityY: 0 },
  })
);
const falling = assistantMotionPosition(model, shape, 0.5);
assert(Math.abs(falling.x - 80) < 1e-8);
assert(
  Math.abs(falling.y - 50) < 0.3,
  'Free fall agrees with independent y0 + g*t²/2 to fixed-step tolerance'
);
assert.deepEqual(
  assistantMotionPosition(model, shape, 1),
  assistantMotionPosition(model, shape, 1)
);
const edge = {
  ...model,
  physics: { ...model.physics!, gravity: 0 },
  shapes: [{ ...shape, x: 270 }],
};
assert(Math.abs(assistantMotionPosition(edge, edge.shapes[0]!, 0.25).x - 300) < 1e-7);
assert(
  Math.abs(assistantMotionPosition(edge, edge.shapes[0]!, 0.5).x - 270) < 1e-7,
  'Elastic edge reflection'
);
const caption = { ...shape, kind: 'text' as const, text: 'Fixed caption' };
assert.deepEqual(assistantMotionPosition(model, caption, 1), { x: 20, y: 20 });
for (const patch of [
  { bounce: 1.1 },
  { gravity: Infinity },
  { velocityX: 1001 },
  { velocityY: '0' },
])
  assert.throws(() =>
    parseAssistantMotion(JSON.stringify({ ...model, physics: { ...model.physics, ...patch } }))
  );
assert.throws(() =>
  parseAssistantMotion(JSON.stringify({ ...model, shapes: [{ ...shape, width: 321 }] }))
);
const stable = {
  ...model,
  physics: { gravity: 2000, bounce: 0.8, velocityX: 1000, velocityY: -1000 },
  duration: 10,
};
for (let frame = 0; frame < 120; frame++) {
  const p = assistantMotionPosition(stable, shape, frame / 119);
  assert(
    Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 300 && p.y >= 0 && p.y <= 160
  );
}
assert(assistantMotionSvg(model, 1).includes('cx="150'));
const artifact = {
  id: 'physics-fixture',
  kind: 'artifact' as const,
  title: 'Schwerkraft',
  revision: 1,
  createdAt: '',
  updatedAt: '',
  body: { type: 'video', format: 'json', content: JSON.stringify(model) },
};
const directory = await mkdtemp(path.join(os.tmpdir(), 'plum-physics-test-'));
try {
  const clip = await exportArtifact(artifact, 'mp4'),
    filename = path.join(directory, 'gravity.mp4'),
    last = path.join(directory, 'last.png');
  await writeFile(filename, clip.data);
  await promisify(execFile)('ffmpeg', [
    '-nostdin',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    filename,
    '-vf',
    'select=eq(n\\,3)',
    '-frames:v',
    '1',
    last,
  ]);
  await promisify(execFile)('/usr/local/bin/plum-python', [
    '-c',
    'from PIL import Image;import sys;a=Image.open(sys.argv[1]).convert("RGB");p=a.getpixel((150,150));assert p[2]>180 and p[0]<80;assert a.getpixel((30,30))[0]>180',
    last,
  ]);
  const probe = JSON.parse(
    (
      await promisify(execFile)('ffprobe', [
        '-v',
        'error',
        '-count_frames',
        '-show_streams',
        '-of',
        'json',
        filename,
      ])
    ).stdout
  );
  assert.equal(probe.streams[0].nb_read_frames, '4');
  assert.equal(probe.streams[0].duration, '2.000000');
  console.log(
    'PASS: reproducible bounded gravity, independent free-fall tolerance, elastic wall reflection, fixed captions, invalid parameters, actual H.264 duration/frames and independently decoded final physical position'
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
