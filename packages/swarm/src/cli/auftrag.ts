/**
 * Auftragslauf von Hand ansehen: `node dist/cli/auftrag.js T-0001 [--audit] [--json] [--verlauf]`
 *
 * `--verlauf` liest den echten Matrix-Thread über das Appservice-Token — also das,
 * was der Agent geschrieben hat, nicht nur was in der Datenbank steht.
 *
 * Für den ersten echten Auftrag (und jeden, der klemmt): eine Zeitachse mit den
 * Dauern zwischen Karte, 👀 und ✅, das Ergebnis oder die Ablage, die Kosten,
 * die Zustellungen und auf Wunsch das Audit. Alles lesend.
 */
import { sql } from '../db/index.js';
import { MatrixClient } from '../appservice/client.js';

const millis = (a: Date | string | null, b: Date | string | null): string | null => {
  if (!a || !b) return null;
  const d = (new Date(b).getTime() - new Date(a).getTime()) / 1000;
  if (!Number.isFinite(d)) return null;
  return d < 60
    ? `${d.toFixed(1)} s`
    : d < 3600
      ? `${Math.round(d / 60)} min`
      : `${(d / 3600).toFixed(1)} h`;
};
const zeit = (v: unknown): string =>
  v ? new Date(v as string).toISOString().replace('T', ' ').slice(0, 19) : '—';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const id = argv.find((a) => !a.startsWith('--'));
  const alsJson = argv.includes('--json');
  if (!id) {
    // Ohne Angabe: die letzten Läufe, damit man sieht, was überhaupt läuft.
    const zeilen = await sql`
      SELECT id, state, assignee, left(goal, 44) AS goal, created_at, updated_at
      FROM swarm.tasks ORDER BY created_at DESC LIMIT 10`;
    if (!zeilen.length) {
      console.log('Keine Aufträge.');
      return;
    }
    console.log('Letzte Aufträge (Details: auftrag.js <ID>):');
    for (const z of zeilen) {
      console.log(
        `  ${z.id}  ${String(z.state).padEnd(14)} ${String(z.assignee).padEnd(12)} ${zeit(z.created_at)}  ${z.goal}`
      );
    }
    return;
  }

  const [t] = await sql`SELECT * FROM swarm.tasks WHERE id = ${id}`;
  if (!t) {
    console.error(`Auftrag ${id} nicht gefunden.`);
    process.exit(2);
  }

  const ablage =
    await sql`SELECT id, name, size, mxc, created_at FROM swarm.artifacts WHERE task_id = ${id} ORDER BY id`;
  const ausgaben = await sql`
    SELECT room_id, kind, count(*)::int AS n,
           count(*) FILTER (WHERE sent_event_id IS NOT NULL)::int AS zugestellt,
           count(*) FILTER (WHERE dead)::int AS tot
    FROM swarm.outbox WHERE task_id = ${id} GROUP BY room_id, kind ORDER BY room_id, kind`;
  // Das Audit ist die Quelle für den Endzeitpunkt: `updated_at` wird auch von
  // späteren Läufen angefasst und würde eine Gesamtlaufzeit von Stunden vorgaukeln.
  const audit =
    await sql`SELECT at, actor, action, left(detail::text, 90) AS detail FROM swarm.audit
      WHERE target = ${id} OR detail::text LIKE ${`%${id}%`} ORDER BY id LIMIT 40`;
  const ENDE = ['completed', 'failed', 'canceled', 'rejected'];
  const ende = ENDE.includes(String(t.state))
    ? (audit[audit.length - 1]?.at ?? t.updated_at)
    : null;

  if (alsJson) {
    console.log(
      JSON.stringify(
        { task: t, artifacts: ablage, outbox: ausgaben, ...(audit.length ? { audit } : {}) },
        null,
        1
      )
    );
    await sql.end({ timeout: 5 });
    return;
  }

  console.log(`\n── ${t.id} ──`);
  console.log(`  Zustand   ${t.state}${t.fail_reason ? `  ·  Grund: ${t.fail_reason}` : ''}`);
  console.log(`  Ziel      ${t.goal}`);
  if (t.deliverable) console.log(`  Ablieferung  ${t.deliverable}`);
  console.log(
    `  Wer       ${t.assignee}  ←  ${t.from_agent}   (Hop ${t.hop}, Tiefe ${t.depth}, Versuche ${t.attempts})`
  );
  console.log(`  Raum      ${t.room_id ?? '—'}${t.thread_root ? `  Thread ${t.thread_root}` : ''}`);
  if (t.budget_usd !== null || t.budget_minutes !== null) {
    console.log(
      `  Budget    ${t.budget_usd ?? '—'} USD / ${t.budget_minutes ?? '—'} min   Kosten bisher: ${t.cost_usd ?? 0}`
    );
  } else if (t.cost_usd !== null) {
    console.log(`  Kosten    ${t.cost_usd} USD`);
  }

  console.log('\n  Zeitachse');
  const schritte: [string, unknown, string | null][] = [
    ['angelegt', t.created_at, null],
    ['Karte raus', t.card_sent_at, millis(t.created_at, t.card_sent_at)],
    ['👀 angenommen', t.claimed_at, millis(t.card_sent_at ?? t.created_at, t.claimed_at)],
    ...(ende
      ? [
          ['fertig', ende, millis(t.claimed_at ?? t.created_at, ende)] as [
            string,
            unknown,
            string | null,
          ],
        ]
      : []),
    ['zuletzt angefasst', t.updated_at, null],
  ];
  for (const [name, wert, dauer] of schritte) {
    if (!wert && name !== 'letzte Meldung') continue;
    console.log(`    ${zeit(wert)}  ${name.padEnd(15)}${dauer ? `(+${dauer})` : ''}`);
  }
  if (t.lease_until && ['submitted', 'working'].includes(String(t.state))) {
    const ueber = (Date.now() - new Date(t.lease_until as string).getTime()) / 1000;
    console.log(
      `    Lease ${ueber > 0 ? `seit ${Math.round(ueber)} s abgelaufen — der Watchdog greift gleich ein` : `läuft noch ${Math.round(-ueber)} s`}`
    );
  }
  if (t.reminded_at) console.log(`    ${zeit(t.reminded_at)}  erinnert`);
  if (t.deadline) {
    const frist = new Date(t.deadline as string).getTime();
    const referenz = ende ? new Date(ende as string).getTime() : Date.now();
    console.log(
      `    Frist ${zeit(t.deadline)}${frist < referenz ? ' (überschritten)' : ende ? ' (gehalten)' : ''}`
    );
  }

  const gesamt = millis(t.created_at, ende);
  if (gesamt) console.log(`\n  Gesamtlaufzeit  ${gesamt}`);
  else if (!ENDE.includes(String(t.state))) console.log('\n  Läuft noch — keine Gesamtlaufzeit.');

  if (t.result) {
    const text = String(t.result);
    console.log(`\n  Ergebnis (${text.length} Zeichen)`);
    console.log(
      text
        .split('\n')
        .slice(0, 12)
        .map((z) => `    ${z}`)
        .join('\n')
    );
    if (text.split('\n').length > 12) console.log('    …');
  }
  if (ablage.length) {
    console.log('\n  Ablage');
    for (const a of ablage)
      console.log(
        `    ${a.name}  ${Math.round(Number(a.size) / 1024)} KiB  ${a.mxc ?? 'ohne mxc'}`
      );
  }
  if (ausgaben.length) {
    const summe = ausgaben.reduce((s, z) => s + Number(z.n), 0);
    const tot = ausgaben.reduce((s, z) => s + Number(z.tot), 0);
    console.log(
      `\n  Zustellungen  ${summe} Ausgaben über ${ausgaben.length} Raum/Art-Kombinationen${tot ? ` — ${tot} tot!` : ', alle zugestellt'}`
    );
    for (const a of ausgaben.slice(0, 8)) {
      console.log(
        `    ${String(a.room_id).slice(0, 22)}  ${String(a.kind).padEnd(9)} ${a.n}×${Number(a.zugestellt) === Number(a.n) ? '' : ` (nur ${a.zugestellt} raus)`}`
      );
    }
  }
  if (argv.includes('--verlauf')) {
    console.log('\n  Verlauf im Matrix-Thread');
    if (!t.room_id || !t.thread_root) {
      console.log('    kein Thread bekannt');
    } else {
      const matrix = new MatrixClient();
      const verlauf = await matrix.threadMessages(String(t.room_id), String(t.thread_root));
      if (!verlauf.length) {
        console.log(
          '    (leer — der Hub ist kein Mitglied, oder der Thread hat keine Nachrichten)'
        );
      }
      for (const zeile of verlauf) {
        const uhr = new Date(zeile.ts).toISOString().replace('T', ' ').slice(11, 19);
        const wer = zeile.sender.replace(/:zwaetschge-webui\.ch$/, '');
        const text = zeile.body.replace(/\s+/g, ' ').slice(0, 150);
        console.log(
          `    ${uhr}  ${wer.padEnd(14)} ${zeile.msgtype === 'm.notice' ? '·' : '»'} ${text}`
        );
      }
      console.log(`    ${verlauf.length} Nachrichten im Thread`);
    }
  }

  if (audit.length) {
    console.log('\n  Audit');
    for (const a of audit)
      console.log(
        `    ${zeit(a.at)}  ${String(a.actor).padEnd(12)} ${String(a.action).padEnd(22)} ${a.detail}`
      );
  }
  console.log();
  await sql.end({ timeout: 5 });
}

main().catch(async (err) => {
  console.error('Auftrag konnte nicht gelesen werden:', err instanceof Error ? err.message : err);
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(2);
});
