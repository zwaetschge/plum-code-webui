/**
 * Agent-Tokens für Swarm-MCP, Worker und Melder (§14.2, §14.3).
 *
 *   pnpm --filter @council/matrix token create brian mcp
 *   pnpm --filter @council/matrix token list
 *   pnpm --filter @council/matrix token revoke brian
 *
 * Der Klartext wird genau einmal ausgegeben; gespeichert ist nur der SHA-256.
 * Geprüft wird bei jedem Aufruf ohne Cache — eine Sperre wirkt sofort (§10.3).
 */
import { createHash, randomBytes } from 'node:crypto';
import { sql } from '../db/index.js';

const ZWECKE = ['mcp', 'worker', 'notify', 'absprache'] as const;
type Zweck = (typeof ZWECKE)[number];

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function main(): Promise<void> {
  const [cmd, agent, zweckArg] = process.argv.slice(2);

  if (cmd === 'list') {
    const rows = await sql`
      SELECT agent, purpose, created_at, last_used_at, revoked_at FROM swarm.tokens ORDER BY agent, purpose`;
    console.table(
      rows.map((r) => ({
        agent: r.agent,
        zweck: r.purpose,
        angelegt: new Date(r.created_at as string).toISOString().slice(0, 16),
        zuletzt: r.last_used_at
          ? new Date(r.last_used_at as string).toISOString().slice(0, 16)
          : '—',
        widerrufen: r.revoked_at ? 'ja' : '',
      }))
    );
    return;
  }

  if (cmd === 'revoke') {
    if (!agent) throw new Error('Agent fehlt');
    const rows = zweckArg
      ? await sql`
          UPDATE swarm.tokens SET revoked_at = now()
          WHERE agent = ${agent} AND purpose = ${zweckArg} AND revoked_at IS NULL RETURNING id`
      : await sql`
          UPDATE swarm.tokens SET revoked_at = now()
          WHERE agent = ${agent} AND revoked_at IS NULL RETURNING id`;
    console.log(
      rows.length
        ? `✓ ${rows.length} Token von ${agent} widerrufen`
        : `Kein aktives Token für ${agent}`
    );
    return;
  }

  if (cmd === 'create') {
    if (!agent) throw new Error('Agent fehlt');
    const zweck = (zweckArg ?? 'mcp') as Zweck;
    if (!(ZWECKE as readonly string[]).includes(zweck)) {
      throw new Error(`Zweck muss einer von ${ZWECKE.join(', ')} sein`);
    }
    // Ein Zweck pro Agent: ein altes Token wird widerrufen, damit nichts liegen bleibt.
    await sql`
      UPDATE swarm.tokens SET revoked_at = now()
      WHERE agent = ${agent} AND purpose = ${zweck} AND revoked_at IS NULL`;
    const klartext = `swm_${randomBytes(32).toString('base64url')}`;
    await sql`
      INSERT INTO swarm.tokens (agent, purpose, hash) VALUES (${agent}, ${zweck}, ${hash(klartext)})`;
    console.log(
      `✓ Token für ${agent} (${zweck}) — einmal anzeigen, danach ist nur der Hash gespeichert:`
    );
    console.log(klartext);
    return;
  }

  console.log(
    'Aufruf: token create <agent> <mcp|worker|notify|absprache> | token list | token revoke <agent> [zweck]'
  );
}

main()
  .then(() => sql.end({ timeout: 5 }))
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await sql.end({ timeout: 5 }).catch(() => {});
    process.exit(1);
  });
