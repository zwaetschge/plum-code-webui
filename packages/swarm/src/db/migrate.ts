import { readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sql } from './index.js'

const here = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR || join(here, '../../migrations')

/**
 * Eigene, qualifizierte Migrationstabelle. Die unqualifizierte `schema_migrations`
 * des Cores liegt in `public` und gehört ihm allein (PLAN-swarm §14.2).
 */
const TABELLE = 'swarm.schema_migrations'

export async function migrate(): Promise<string[]> {
  await sql`
    CREATE TABLE IF NOT EXISTS swarm.schema_migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort()
  const done = new Set(
    (await sql.unsafe(`SELECT name FROM ${TABELLE}`) as unknown as { name: string }[])
      .map((r) => r.name),
  )

  const applied: string[] = []
  for (const file of files) {
    if (done.has(file)) continue
    const ddl = await readFile(join(MIGRATIONS_DIR, file), 'utf8')
    // Eine Migration = eine Transaktion: entweder ganz oder gar nicht.
    await sql.begin(async (tx) => {
      await tx.unsafe(ddl)
      await tx.unsafe(`INSERT INTO ${TABELLE} (name) VALUES ($1)`, [file])
    })
    applied.push(file)
    console.log(`✓ Migration ${file}`)
  }
  if (applied.length === 0) console.log('Keine offenen Migrationen.')
  return applied
}
