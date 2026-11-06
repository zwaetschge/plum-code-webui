import { describe, it, expect } from 'vitest';
import { parsePlumTaskRequest } from '../protocol/plumTask.js';
describe('explicit native Plum task contract', () => {
  it('keeps actual native budget, deadline, deliverables and quoted context', () => {
    const request = {
      v: 1,
      assignee: 'brian/phone',
      goal: 'Bild prüfen',
      context: 'quoted image/source',
      budgetUsd: 2,
      deadline: '2026-10-12T12:00:00Z',
      deliverables: ['Bericht'],
    };
    expect(parsePlumTaskRequest(request, 'brian/phone')).toEqual(request);
    expect(parsePlumTaskRequest(undefined, 'brian')).toBeNull();
    expect(parsePlumTaskRequest({ ...request, budgetUsd: '2.50' }, 'brian/phone')?.budgetUsd).toBe(
      2.5
    );
  });
  it('rejects foreign targets, invalid budget/date and unknown privileged fields', () => {
    for (const patch of [
      { assignee: 'trader' },
      { budgetUsd: -1 },
      { deadline: 'morgen' },
      { freigabePflicht: false },
    ])
      expect(() =>
        parsePlumTaskRequest({ v: 1, assignee: 'brian', goal: 'Auftrag', ...patch }, 'brian')
      ).toThrow();
  });
});
