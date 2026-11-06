import postgres from 'postgres';
import { env } from '../env.js';

export const sql = postgres(env.databaseUrl, {
  max: 8,
  idle_timeout: 30,
  transform: { undefined: null },
  onnotice: () => {},
});

/** Der Pool selbst — nur er kann `begin`. */
export type Sql = typeof sql;
/** Innerhalb von `sql.begin(…)`. */
export type Tx = postgres.TransactionSql;
/** Was die Speicher-Funktionen annehmen: Pool oder Transaktion. */
export type Db = Sql | Tx;

/** snake_case-Zeile → camelCase-Objekt, wie im Core. */
export function camel<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] = v;
  }
  return out as T;
}

export function camelAll<T>(rows: readonly Record<string, unknown>[]): T[] {
  return rows.map((r) => camel<T>(r));
}

/**
 * jsonb-Parameter. `sql.json()` ist der einzige Weg, der Objekte *und* Arrays
 * richtig ablegt: ein `JSON.stringify(x)` mit `::jsonb` wird doppelt kodiert und
 * landet als JSON-String in der Spalte. Die Typisierung von postgres.js kennt
 * nur `JSONValue`, deshalb hier die eine, kommentierte Weitung.
 */
export function jsonParam(db: Db, value: unknown) {
  return db.json(value as Parameters<Sql['json']>[0]);
}
