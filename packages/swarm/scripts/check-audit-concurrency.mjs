/** Real PostgreSQL regression check. Use only a dedicated disposable database. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const url = process.env.SWARM_AUDIT_TEST_DATABASE_URL
if (!url || !/^\/swarm_audit_test_[a-z0-9_]+$/.test(new URL(url).pathname))
  throw new Error('SWARM_AUDIT_TEST_DATABASE_URL must name a disposable swarm_audit_test_* database')
const entry = import.meta.resolve('@plum-code-webui/swarm/runtime')
const require = createRequire(entry)
const postgres = require('postgres')
const { audit, verifyAudit } = await import(process.env.SWARM_AUDIT_TEST_MODULE || new URL('./db/audit.js', entry))
const sql = postgres(url, { max: 8, transform: { undefined: null }, onnotice() {} })
let output
try {
  await sql`CREATE SCHEMA IF NOT EXISTS swarm`
  await sql`CREATE TABLE swarm.audit (
    id bigserial PRIMARY KEY, at timestamptz NOT NULL, actor text NOT NULL,
    action text NOT NULL, target text, detail jsonb NOT NULL, prev_hash text, hash text NOT NULL)`
  // The empty-table case and a seeded chain both had racing writers.
  const batches = []
  for (let batch = 0; batch < 3; batch++) {
    await Promise.all(Array.from({ length: 32 }, (_, i) => i % 2
      ? sql.begin(tx => audit('regression', 'parallel', null, { batch, i }, tx))
      : audit('regression', 'parallel', null, { batch, i }, sql)))
    const check = await verifyAudit(sql)
    batches.push(check)
    if (!check.ok) throw Object.assign(new Error('Concurrent writers forked the audit chain'), { result: { batches } })
  }
  const before = await sql`SELECT id,prev_hash,hash FROM swarm.audit ORDER BY id`
  const repeated = await verifyAudit(sql)
  assert.equal(repeated.ok, true)
  assert.deepEqual(await sql`SELECT id,prev_hash,hash FROM swarm.audit ORDER BY id`, before)
  await sql`UPDATE swarm.audit SET action='tampered' WHERE id=12`
  const tamper = await verifyAudit(sql)
  assert.equal(tamper.ok, false)
  assert.equal(tamper.brokenAt, 12)
  output = { passed: true, concurrent_rows: before.length, batches, verifier_preserves_history: true, tamper_detected_at: tamper.brokenAt }
} catch (error) {
  output = { passed: false, error: error.message, ...(error.result || {}) }
  process.exitCode = 1
} finally {
  await sql.end()
  // Importing the shipped module creates a lazy production pool; it was never queried.
  const { sql: unused } = await import(new URL('./db/index.js', entry))
  await unused.end()
}
console.log(JSON.stringify(output))
