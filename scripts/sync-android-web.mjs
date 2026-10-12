import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'packages/frontend/dist');
const target = path.join(root, 'packages/android/app/src/main/assets/plum-web');
const index = await fs.readFile(path.join(source, 'index.html'), 'utf8');
if (!index.includes('/assets/') || /https?:\/\/[^"']+\.js/.test(index))
  throw new Error('Expected local production Plum bundle');
await fs.rm(target, { recursive: true, force: true });
await fs.mkdir(target, { recursive: true });
await fs.cp(source, target, { recursive: true });
const files = {};
async function inventory(folder) {
  for (const item of await fs.readdir(folder, { withFileTypes: true })) {
    const file = path.join(folder, item.name);
    if (item.isDirectory()) await inventory(file);
    else if (!item.name.endsWith('.map'))
      files[path.relative(target, file)] = crypto
        .createHash('sha256')
        .update(await fs.readFile(file))
        .digest('hex');
    else await fs.unlink(file);
  }
}
await inventory(target);
await fs.writeFile(
  path.join(target, 'bundle-manifest.json'),
  JSON.stringify({ builtAt: new Date().toISOString(), files }, null, 2)
);
console.log(
  `Packaged ${Object.keys(files).length} current frontend assets; index SHA-256 ${files['index.html']}`
);
