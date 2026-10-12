import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseAssistantMotion, motionFromText, assistantMotionSvg } from '@plum-code-webui/shared';
import { exportArtifact } from '../src/services/assistant/exports.js';
const model = parseAssistantMotion(
  JSON.stringify({
    ...motionFromText('Übersicht'),
    width: 320,
    height: 180,
    duration: 2,
    fps: 2,
    shapes: motionFromText('Übersicht\n<script>kein Code</script>').shapes.map((shape, index) =>
      index === 0
        ? { ...shape, x: 30, y: 80, toX: 210, toY: 80, width: 50, height: 50 }
        : { ...shape, x: 20, y: 25, toX: 20, toY: 25, fontSize: 16 }
    ),
  })
);
const svg = assistantMotionSvg(model, 0),
  last = assistantMotionSvg(model, 1);
assert(svg.includes('&lt;script&gt;'));
assert(!svg.includes('<script>'));
assert(svg.includes('cx="55"'));
assert(last.includes('cx="235"'));
for (const patch of [
  { fps: 13 },
  { duration: 11 },
  { width: 319 },
  { background: 'url(https://example.invalid)' },
  { shapes: [{ ...model.shapes[0], color: 'red" onload="alert(1)' }] },
  { shapes: [model.shapes[0], model.shapes[0]] },
])
  assert.throws(() => parseAssistantMotion(JSON.stringify({ ...model, ...patch })));
const artifact = {
  id: 'motion-fixture',
  kind: 'artifact' as const,
  revision: 7,
  title: 'Bewegung',
  createdAt: '',
  updatedAt: '',
  body: { type: 'video', format: 'json', content: JSON.stringify(model) },
};
const directory = await mkdtemp(path.join(os.tmpdir(), 'plum-motion-test-'));
try {
  const png = await exportArtifact(artifact, 'png');
  assert.equal(png.mimeType, 'image/png');
  assert.equal(png.data.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.data.readUInt32BE(16), 320);
  assert.equal(png.data.readUInt32BE(20), 180);
  const mp4 = await exportArtifact(artifact, 'mp4');
  assert.equal(mp4.mimeType, 'video/mp4');
  assert.equal(mp4.data.subarray(4, 8).toString(), 'ftyp');
  const filename = path.join(directory, 'motion.mp4');
  await writeFile(filename, mp4.data);
  const firstFile = path.join(directory, 'first.png'),
    lastFile = path.join(directory, 'last.png');
  await writeFile(firstFile, png.data);
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
    lastFile,
  ]);
  await promisify(execFile)('/usr/local/bin/plum-python', [
    '-c',
    'from PIL import Image;import sys;a=Image.open(sys.argv[1]).convert("RGB");b=Image.open(sys.argv[2]).convert("RGB");assert a.getpixel((55,105))[2]>180 and a.getpixel((55,105))[0]<80;assert b.getpixel((235,105))[2]>180 and b.getpixel((235,105))[0]<80;assert b.getpixel((55,105))[0]>180;print("actual first/last frame position checked")',
    firstFile,
    lastFile,
  ]);
  const metadata = JSON.parse(
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
  assert.equal(metadata.streams.length, 1);
  const stream = metadata.streams[0];
  assert.equal(stream.codec_name, 'h264');
  assert.equal(stream.width, 320);
  assert.equal(stream.height, 180);
  assert.equal(stream.nb_read_frames, '4');
  assert.equal(Number(stream.duration), 2);
  assert.equal(stream.pix_fmt, 'yuv420p');
  assert.equal((await exportArtifact(artifact, 'svg')).data.toString(), svg);
  await assert.rejects(
    () => exportArtifact({ ...artifact, body: { ...artifact.body, type: 'document' } }, 'mp4'),
    /Animation/
  );
  // Retain a reviewable, local clip only in this task's ignored fixture directory.
  await writeFile('.probe/plum-assistant/motion.mp4', mp4.data);
  await writeFile('.probe/plum-assistant/motion-first.png', png.data);
  console.log(
    'PASS: bounded canonical motion, exact first/last geometry, hostile text/shape guards, actual offline PNG/SVG/H.264 export and independently inspected duration, frames, size and codec; original revision untouched'
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
