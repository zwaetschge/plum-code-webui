/**
 * Wochenbericht des Schwarms (ADR-002 §4.42):
 *
 *   node dist/cli/wochenbericht.js [--tage 7] [--json]
 *   ops/matrix/wochenbericht.sh
 *
 * Eine Nachricht statt Einzelabfragen: was lief, wie lange es dauerte, was
 * scheiterte und warum, was es kostete, wer verbunden war, wie viele Freigaben
 * benutzt oder verpasst wurden. Gedacht für die Zustellung in Vales DM-Raum über
 * einen no-agent Cron-Job in Brian.
 */
import { sql } from '../db/index.js';

const pct = (werte: number[], p: number): number | null => {
  if (!werte.length) return null;
  const s = [...werte].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? null;
};
const sekunden = (v: number | null): string =>
  v === null
    ? '—'
    : v < 60
      ? `${Math.round(v)} s`
      : v < 3600
        ? `${Math.round(v / 60)} min`
        : `${(v / 3600).toFixed(1)} h`;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--tage');
  const tage = i >= 0 ? Number(argv[i + 1]) : 7;
  const alsJson = argv.includes('--json');
  const von = `${tage} day`;

  const [uebersicht] = await sql`
    SELECT count(*)::int AS angelegt,
           count(*) FILTER (WHERE state = 'completed')::int AS fertig,
           count(*) FILTER (WHERE state = 'failed')::int AS fehlgeschlagen,
           count(*) FILTER (WHERE state IN ('canceled','rejected'))::int AS abgebrochen,
           count(*) FILTER (WHERE state IN ('submitted','working','input-required','auth-required'))::int AS offen,
           coalesce(sum(cost_usd), 0)::float8 AS kosten
    FROM swarm.tasks WHERE created_at >= now() - ${von}::interval`;

  const dauern = (await sql`
    SELECT extract(epoch FROM (a.at - t.created_at))::float8 AS sekunden
    FROM swarm.tasks t
    JOIN LATERAL (SELECT at FROM swarm.audit WHERE target = t.id ORDER BY id DESC LIMIT 1) a ON true
    WHERE t.created_at >= now() - ${von}::interval AND t.state = 'completed'`) as unknown as {
    sekunden: number;
  }[];

  const gruende = await sql`
    SELECT state, left(coalesce(fail_reason, '(ohne Grund)'), 110) AS grund, count(*)::int AS n
    FROM swarm.tasks
    WHERE created_at >= now() - ${von}::interval AND state IN ('failed','canceled','rejected')
    GROUP BY state, grund ORDER BY n DESC LIMIT 6`;

  const je_agent = await sql`
    SELECT assignee, count(*)::int AS auftraege,
           count(*) FILTER (WHERE state = 'completed')::int AS fertig,
           coalesce(sum(cost_usd), 0)::float8 AS kosten
    FROM swarm.tasks WHERE created_at >= now() - ${von}::interval
    GROUP BY assignee ORDER BY auftraege DESC LIMIT 8`;

  const freigaben = await sql`
    SELECT action, count(*)::int AS n FROM swarm.audit
    WHERE action LIKE 'freigabe.%' AND at >= now() - ${von}::interval
    GROUP BY action ORDER BY n DESC`;

  const worker = await sql`
    SELECT actor, count(*)::int AS verbindungen, max(at) AS zuletzt
    FROM swarm.audit WHERE action = 'worker.ready' AND at >= now() - ${von}::interval
    GROUP BY actor ORDER BY actor`;

  const kanari = (
    await sql`
    SELECT value FROM swarm.flags WHERE name = 'kanari'`
  )[0]?.value as
    | { tag?: string; gestartet?: number; fehlgeschlagen?: number; nichtGestartet?: string[] }
    | undefined;

  if (alsJson) {
    console.log(
      JSON.stringify(
        {
          tage,
          uebersicht,
          dauern: {
            p50: pct(
              dauern.map((d) => d.sekunden),
              50
            ),
            p95: pct(
              dauern.map((d) => d.sekunden),
              95
            ),
          },
          gruende,
          je_agent,
          freigaben,
          worker,
          kanari,
        },
        null,
        1
      )
    );
    await sql.end({ timeout: 5 });
    return;
  }

  const z = uebersicht ?? {};
  console.log(`Schwarm-Wochenbericht — letzte ${tage} Tage`);
  console.log(
    `  Aufträge: ${z.angelegt ?? 0} angelegt · ${z.fertig ?? 0} fertig · ${z.fehlgeschlagen ?? 0} fehlgeschlagen · ` +
      `${z.abgebrochen ?? 0} abgebrochen · ${z.offen ?? 0} offen`
  );
  console.log(
    `  Kosten: ${Number(z.kosten ?? 0).toFixed(4)} USD (native Bots nach Laufzeit geschätzt)`
  );
  console.log(
    `  Dauer bis Abschluss: p50 ${sekunden(
      pct(
        dauern.map((d) => d.sekunden),
        50
      )
    )} · p95 ${sekunden(
      pct(
        dauern.map((d) => d.sekunden),
        95
      )
    )} · ${dauern.length} gemessen`
  );

  if (gruende.length) {
    console.log('  Fehlschläge und Abbrüche:');
    for (const g of gruende as unknown as { state: string; grund: string; n: number }[]) {
      console.log(`    · ${g.n}× ${g.state}: ${g.grund}`);
    }
  } else {
    console.log('  Fehlschläge: keine');
  }

  if (je_agent.length) {
    console.log('  Je Agent:');
    for (const a of je_agent as unknown as {
      assignee: string;
      auftraege: number;
      fertig: number;
      kosten: number;
    }[]) {
      console.log(
        `    · ${String(a.assignee).padEnd(13)} ${a.auftraege} Aufträge, ${a.fertig} fertig, ${Number(a.kosten).toFixed(4)} USD`
      );
    }
  }

  if (freigaben.length) {
    console.log(
      '  Freigaben: ' +
        (freigaben as unknown as { action: string; n: number }[])
          .map((f) => `${f.action.replace('freigabe.', '')} ${f.n}×`)
          .join(' · ')
    );
  } else {
    console.log('  Freigaben: keine gebraucht');
  }

  if (worker.length) {
    console.log(
      '  Worker-Verbindungen: ' +
        (worker as unknown as { actor: string; verbindungen: number }[])
          .map((w) => `${w.actor} ${w.verbindungen}×`)
          .join(' · ')
    );
  }
  console.log(
    kanari
      ? `  Kanari zuletzt ${kanari.tag ?? '?'}: ${kanari.gestartet ?? 0} gestartet, ${kanari.fehlgeschlagen ?? 0} fehlgeschlagen` +
          ((kanari.nichtGestartet ?? []).length
            ? ` · nicht gestartet: ${kanari!.nichtGestartet!.join(', ')}`
            : '')
      : '  Kanari: kein Ergebnis gespeichert'
  );

  await sql.end({ timeout: 5 });
}

main().catch(async (err) => {
  console.error('Wochenbericht fehlgeschlagen:', err instanceof Error ? err.message : err);
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(2);
});
