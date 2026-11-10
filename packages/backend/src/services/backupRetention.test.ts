import assert from 'node:assert/strict';
import { test } from 'node:test';

import { selectBackupsToRemove } from './backup.js';

const at = (iso: string) => ({ path: `/b/${iso}`, createdAt: iso });

test('a night of restarts costs slots, not history', () => {
  const entries = [
    // Eight restarts within one night.
    ...['00:10', '00:40', '01:10', '01:27', '02:12', '02:28', '03:30', '04:15'].map((time) =>
      at(`2026-11-10T${time}:00.000Z`)
    ),
    at('2026-11-09T20:30:00.000Z'),
    at('2026-11-09T08:47:00.000Z'),
    at('2026-11-08T20:47:00.000Z'),
    at('2026-11-07T20:47:00.000Z'),
  ];
  const removed = new Set(selectBackupsToRemove(entries, { recent: 3, days: 14 }));

  // The newest three stay, whatever day they are from.
  for (const time of ['04:15', '03:30', '02:28']) {
    assert.equal(removed.has(`/b/2026-11-10T${time}:00.000Z`), false);
  }
  // Every earlier day keeps its newest backup.
  assert.equal(removed.has('/b/2026-11-09T20:30:00.000Z'), false);
  assert.equal(removed.has('/b/2026-11-08T20:47:00.000Z'), false);
  assert.equal(removed.has('/b/2026-11-07T20:47:00.000Z'), false);
  // The rest of the restart storm and the second backup of a day go.
  assert.equal(removed.has('/b/2026-11-10T00:10:00.000Z'), true);
  assert.equal(removed.has('/b/2026-11-09T08:47:00.000Z'), true);
  assert.equal(removed.size, 6);
});

test('days beyond the window are dropped', () => {
  const entries = Array.from({ length: 20 }, (_, index) =>
    at(`2026-10-${String(30 - index).padStart(2, '0')}T12:00:00.000Z`)
  );
  const removed = selectBackupsToRemove(entries, { recent: 1, days: 14 });
  assert.equal(removed.length, 6);
  assert.ok(removed.includes('/b/2026-10-11T12:00:00.000Z'));
  assert.ok(!removed.includes('/b/2026-10-17T12:00:00.000Z'));
});

test('never removes the only backup, even with nonsense settings', () => {
  assert.deepEqual(
    selectBackupsToRemove([at('2026-11-10T04:00:00.000Z')], { recent: 0, days: 0 }),
    []
  );
});
