/**
 * Two behaviours matter and both were absent before: a level filter that can be
 * turned down in production, and a request id that rides along automatically so
 * lines from one request can be grouped after the fact.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const { createLogger, withRequestContext, currentRequestId } = await import('./logger.js');

/** Captures console output for one call. */
function capture(fn: () => void): string[] {
  const lines: string[] = [];
  const original = { log: console.log, warn: console.warn, error: console.error };
  const push = (...args: unknown[]) => lines.push(args.map(String).join(' '));
  console.log = push;
  console.warn = push;
  console.error = push;
  try {
    fn();
  } finally {
    Object.assign(console, original);
  }
  return lines;
}

test('level filter suppresses anything below the configured level', () => {
  process.env.LOG_LEVEL = 'warn';
  const log = createLogger('test');
  const lines = capture(() => {
    log.debug('hidden');
    log.info('hidden too');
    log.warn('shown');
    log.error('also shown');
  });
  assert.equal(lines.length, 2);
  assert.match(lines[0]!, /shown/);
  delete process.env.LOG_LEVEL;
});

test('default level is info, so debug stays quiet', () => {
  delete process.env.LOG_LEVEL;
  const log = createLogger('test');
  const lines = capture(() => {
    log.debug('quiet');
    log.info('loud');
  });
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /loud/);
});

test('an unknown LOG_LEVEL falls back to info rather than silencing everything', () => {
  process.env.LOG_LEVEL = 'nonsense';
  const log = createLogger('test');
  const lines = capture(() => log.info('still logged'));
  assert.equal(lines.length, 1);
  delete process.env.LOG_LEVEL;
});

test('the request id rides along without being passed', () => {
  const log = createLogger('test');
  const lines = capture(() =>
    withRequestContext({ requestId: 'abcdef123456' }, () => log.info('inside a request'))
  );
  assert.match(lines[0]!, /abcdef12/);
});

test('logs outside a request carry no id and do not throw', () => {
  const log = createLogger('test');
  const lines = capture(() => log.info('background job'));
  assert.equal(lines.length, 1);
  assert.equal(currentRequestId(), undefined);
});

test('production output is one JSON object per line', () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const log = createLogger('codex');
  const lines = capture(() =>
    withRequestContext({ requestId: 'req-1', userId: 'u-1' }, () =>
      log.error('spawn failed', { exitCode: 127 })
    )
  );
  const parsed = JSON.parse(lines[0]!);
  assert.equal(parsed.level, 'error');
  assert.equal(parsed.scope, 'codex');
  assert.equal(parsed.message, 'spawn failed');
  assert.equal(parsed.requestId, 'req-1');
  assert.equal(parsed.userId, 'u-1');
  assert.equal(parsed.exitCode, 127);
  assert.ok(parsed.time, 'entries need a timestamp to be sortable');
  process.env.NODE_ENV = previous;
});

test('child loggers nest their scope', () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const lines = capture(() => createLogger('provider').child('codex').info('ready'));
  assert.equal(JSON.parse(lines[0]!).scope, 'provider:codex');
  process.env.NODE_ENV = previous;
});
