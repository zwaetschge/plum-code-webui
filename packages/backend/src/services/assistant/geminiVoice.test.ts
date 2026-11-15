import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET ||= 'gemini-voice-test-session-secret-00000000000000000';
process.env.JWT_SECRET ||= 'gemini-voice-test-jwt-secret-0000000000000000000000';

const { GEMINI_VOICES, pcmToWav } = await import('./voice.js');

test('raw Gemini PCM becomes a playable WAV', () => {
  const pcm = Buffer.alloc(48000); // one second of 16-bit mono at 24 kHz
  const wav = pcmToWav(pcm, 24000);
  assert.equal(wav.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(wav.subarray(8, 12).toString('ascii'), 'WAVE');
  assert.equal(wav.readUInt32LE(24), 24000);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.readUInt32LE(40), pcm.length);
  assert.equal(wav.length, pcm.length + 44);
});

test('the voice list has unique names, Kore (the fallback) included', () => {
  const names = GEMINI_VOICES.map(([name]) => name);
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.includes('Kore'));
});
