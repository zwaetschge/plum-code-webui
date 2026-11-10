import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sniffSessionIconFormat } from './sessionIconThumbnail.js';

const bytes = (...values: number[]) => Buffer.from(values);

test('raster formats are recognised by their signature', () => {
  assert.equal(
    sniffSessionIconFormat(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0)),
    'png'
  );
  assert.equal(sniffSessionIconFormat(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10)), 'jpeg');
  assert.equal(sniffSessionIconFormat(Buffer.from('GIF89a\u0001\u0000', 'latin1')), 'gif');
  assert.equal(
    sniffSessionIconFormat(Buffer.from('RIFF\u0010\u0000\u0000\u0000WEBPVP8 ', 'latin1')),
    'webp'
  );
  assert.equal(sniffSessionIconFormat(bytes(0, 0, 1, 0, 1, 0, 16, 16)), 'ico');
});

test('svg is recognised with and without an xml prolog', () => {
  assert.equal(
    sniffSessionIconFormat(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')),
    'svg'
  );
  assert.equal(
    sniffSessionIconFormat(
      Buffer.from('\uFEFF<?xml version="1.0"?>\n<!-- icon -->\n<svg viewBox="0 0 1 1"/>')
    ),
    'svg'
  );
});

test('scripted image formats and plain text are not images', () => {
  // The formats ImageMagick would otherwise pick by content.
  assert.equal(
    sniffSessionIconFormat(Buffer.from('push graphic-context\nviewbox 0 0 640 480\n')),
    null
  );
  assert.equal(sniffSessionIconFormat(Buffer.from('%!PS-Adobe-3.0 EPSF-3.0\n')), null);
  assert.equal(
    sniffSessionIconFormat(Buffer.from('<?xml version="1.0"?><image><read filename="x"/></image>')),
    null
  );
  assert.equal(sniffSessionIconFormat(Buffer.from('just some text')), null);
  assert.equal(sniffSessionIconFormat(Buffer.alloc(0)), null);
});

test('a truncated signature does not match', () => {
  assert.equal(sniffSessionIconFormat(bytes(0x89, 0x50, 0x4e)), null);
  assert.equal(
    sniffSessionIconFormat(Buffer.from('RIFF\u0010\u0000\u0000\u0000WAVE', 'latin1')),
    null
  );
});
