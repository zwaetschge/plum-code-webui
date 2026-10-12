import base from './vite.config.ts';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));

// Source-only UI fixture. Never forward an unexpected request to the live backend.
export default {
  ...base,
  root,
  resolve: {
    ...base.resolve,
    alias: {
      ...base.resolve.alias,
      '@plum-code-webui/shared': path.resolve(root, '../shared/src/index.ts'),
    },
  },
  server: {
    ...base.server,
    host: '127.0.0.1',
    port: 5188,
    strictPort: true,
    open: false,
    proxy: {},
  },
};
