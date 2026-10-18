// Listens to the android-builder socket and writes compiler output to /tmp/android-build.log.
// Start it (node scripts/android-build-log.mjs &) before android_build; grep "^e: " for errors.
import { io } from '/app/node_modules/.pnpm/socket.io-client@4.8.3/node_modules/socket.io-client/build/esm/index.js';
import { appendFileSync, writeFileSync } from 'node:fs';
const out = '/tmp/android-build.log'; writeFileSync(out, '');
const s = io('http://android-app-creator:4000', { transports: ['websocket'] });
s.on('connect', () => { s.emit('join:project', '796aa064-f0bb-4031-bbf2-2da83a4bca94'); appendFileSync(out, '[connected]\n'); });
s.on('build:log', (d) => appendFileSync(out, (typeof d === 'string' ? d : (d?.line ?? d?.message ?? JSON.stringify(d))) + '\n'));
s.on('build:done', (d) => { appendFileSync(out, '[done] ' + JSON.stringify(d) + '\n'); setTimeout(() => process.exit(0), 500); });
setTimeout(() => process.exit(0), 20 * 60 * 1000);
