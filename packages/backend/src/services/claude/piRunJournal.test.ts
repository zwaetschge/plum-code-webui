/**
 * The Pi run journal is what lets a run outlive its process: written at the
 * start, kept current, gone when the run settles. These tests cover the file
 * and the bounded resume decision; the manager wiring is in
 * scripts/provider-regression-tests.ts.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  clearPiRun,
  getPiRun,
  patchPiRun,
  piResumePrompt,
  putPiRun,
  readPiRuns,
  recentPiResumes,
  setPiRunJournalPath,
  type PiRunRecord,
} from './piRunJournal.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-journal-'));
setPiRunJournalPath(path.join(dir, 'pi-active-runs.json'));

const record = (extra: Partial<PiRunRecord> = {}): PiRunRecord => ({
  sessionId: 's1',
  userId: 'u1',
  chatId: null,
  startedAt: '2026-11-05T00:00:00.000Z',
  lastActivityAt: '2026-11-05T00:00:00.000Z',
  tool: null,
  queued: [],
  resumes: [],
  ...extra,
});

test('a record is written, patched and cleared', () => {
  putPiRun(record());
  patchPiRun('s1', { tool: { name: 'bash', input: 'sleep 1800' } });
  assert.deepEqual(getPiRun('s1')?.tool, { name: 'bash', input: 'sleep 1800' });
  // Patching a run that is not journalled does not create one.
  patchPiRun('other', { tool: { name: 'read', input: '' } });
  assert.equal(getPiRun('other'), null);
  clearPiRun('s1');
  assert.deepEqual(readPiRuns(), {});
});

test('only resumes within the last hour count against the bound', () => {
  const now = Date.parse('2026-11-05T12:00:00.000Z');
  const recent = recentPiResumes(
    record({ resumes: ['2026-11-05T10:30:00.000Z', '2026-11-05T11:30:00.000Z'] }),
    now
  );
  assert.deepEqual(recent, ['2026-11-05T11:30:00.000Z']);
});

test('the resume prompt names the cut-off tool and the cause', () => {
  const prompt = piResumePrompt(record({ tool: { name: 'bash', input: 'npm test' } }), 'restart');
  assert.match(prompt, /Plum restarted/);
  assert.match(prompt, /`bash` \(npm test\)/);
  assert.match(prompt, /Do not repeat work/);
  assert.doesNotMatch(piResumePrompt(record(), 'crash'), /It was running/);
});

test.after(() => {
  setPiRunJournalPath(null);
  fs.rmSync(dir, { recursive: true, force: true });
});
