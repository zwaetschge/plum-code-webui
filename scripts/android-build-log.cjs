#!/usr/bin/env node
// Builds the Android app through the android-builder and keeps its Gradle log.
// android_build over MCP only reports "building" and later "error"; the log
// lines travel over the builder's Socket.IO room. This joins the room, starts
// the build and writes every line, so Kotlin errors ("e: ...") are readable.
//
//   node scripts/android-build-log.cjs [projectId] [logFile]
//
// Sync packages/android/app/src/main into the builder workspace first
// (see AGENTS.md). Exits 0 when the build succeeded, 1 otherwise.

const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const requireFromFrontend = createRequire(path.join(__dirname, '../packages/frontend/package.json'));
const { io } = requireFromFrontend('socket.io-client');

const builder = process.env.ANDROID_BUILDER_URL || 'http://android-app-creator:4000';
const projectId = process.argv[2] || '796aa064-f0bb-4031-bbf2-2da83a4bca94';
const logFile = process.argv[3] || '/tmp/android-build.log';
const out = fs.createWriteStream(logFile);

const socket = io(builder, { transports: ['websocket'] });
socket.on('connect', () => {
  socket.emit('join:project', projectId);
  setTimeout(async () => {
    const response = await fetch(`${builder}/api/build/${projectId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ buildType: 'debug' }),
    });
    console.log('build started:', response.status);
  }, 500);
});
socket.on('build:log', ({ line }) => {
  out.write(line + '\n');
  if (line.startsWith('e: ')) console.log(line);
});
socket.on('build:done', (result) => {
  out.write('DONE ' + JSON.stringify({ success: result.success, duration: result.duration }) + '\n');
  console.log(result.success ? 'build succeeded' : `build failed, log: ${logFile}`);
  setTimeout(() => process.exit(result.success ? 0 : 1), 500);
});
setTimeout(() => {
  console.log('timed out after 25 minutes');
  process.exit(1);
}, 25 * 60 * 1000);
