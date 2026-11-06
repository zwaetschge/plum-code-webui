/**
 * Tagesübersicht (§9.1, P4): um 07:30 eine Notice in `#schwarm-lobby` — was
 * offen ist, was hängt, was auf dich wartet, was gestern gekostet hat, was
 * schiefging und wer fehlt. Einmal pro Tag (Flag `uebersicht`), nach dem
 * Kanarienvogel um 07:25, dessen Messwerte sie mitnimmt. Tage zählen in
 * Europa/Zürich, wie beim Tageslauf.
 */
import { sql, type Db } from './db/index.js';
import { getFlag, isSwarmFrozen } from './db/audit.js';
import { listAgents } from './agents/store.js';
import { backlog } from './outbox.js';

const ZONE = 'Europe/Zurich';
const LISTE_MAX = 10;

export interface UebersichtDaten {
  offen: { id: string; state: string; assignee: string; goal: string; stillStunden: number }[];
  fertigGestern: number;
  fehlerGestern: { id: string; assignee: string; grund: string | null }[];
  kostenGestern: { assignee: string; usd: number; auftraege: number }[];
  kanari: { assignee: string; state: string; sekunden: number | null }[];
  agentenFehlen: { id: string; name: string; status: string; frozen: boolean }[];
  abgleich: { luecken: number; stale: number } | null;
  deadLetters: number;
  eingefroren: boolean;
}

const ZEICHEN: Record<string, string> = {
  submitted: '📥',
  working: '⚙️',
  'input-required': '❓',
  'auth-required': '🔐',
};

const kurz = (text: string, n = 70): string =>
  text.length > n ? `${text.slice(0, n - 1)}…` : text;
const stunden = (h: number): string =>
  h >= 48 ? `${Math.round(h / 24)} Tagen` : `${Math.round(h)} h`;

export async function uebersichtDaten(db: Db = sql): Promise<UebersichtDaten> {
  const offen = await db`
    SELECT id, state, assignee, goal,
           EXTRACT(EPOCH FROM (now() - updated_at)) / 3600 AS still
    FROM swarm.tasks
    WHERE state IN ('submitted','working','input-required','auth-required')
    ORDER BY (state = 'input-required') DESC, updated_at`;
  const gestern = sql`((now() AT TIME ZONE ${ZONE})::date - 1)`;
  const [fertig] = await db`
    SELECT count(*)::int AS n FROM swarm.tasks
    WHERE state = 'completed' AND (updated_at AT TIME ZONE ${ZONE})::date = ${gestern}`;
  const fehler = await db`
    SELECT id, assignee, fail_reason FROM swarm.tasks
    WHERE state = 'failed' AND (updated_at AT TIME ZONE ${ZONE})::date = ${gestern}
    ORDER BY updated_at`;
  const kosten = await db`
    SELECT assignee, COALESCE(sum(cost_usd), 0)::float AS usd, count(*)::int AS n
    FROM swarm.tasks
    WHERE (created_at AT TIME ZONE ${ZONE})::date = ${gestern}
    GROUP BY assignee ORDER BY usd DESC`;
  const kanari = await db`
    SELECT DISTINCT ON (assignee) assignee, state,
           CASE WHEN state = 'completed' THEN EXTRACT(EPOCH FROM (updated_at - created_at)) END AS sekunden
    FROM swarm.tasks
    WHERE goal LIKE 'Selbsttest:%' AND (created_at AT TIME ZONE ${ZONE})::date = (now() AT TIME ZONE ${ZONE})::date
    ORDER BY assignee, created_at DESC`;
  const abgleich = await getFlag<{ luecken?: number; stale?: string[] }>('abgleich-tag', db);
  const agenten = (await listAgents(db)).filter(
    (a) => a.mode !== 'notify' && (a.status !== 'online' || a.frozen)
  );
  return {
    offen: offen.map((r) => ({
      id: r.id as string,
      state: r.state as string,
      assignee: r.assignee as string,
      goal: r.goal as string,
      stillStunden: Number(r.still),
    })),
    fertigGestern: Number(fertig?.n ?? 0),
    fehlerGestern: fehler.map((r) => ({
      id: r.id as string,
      assignee: r.assignee as string,
      grund: (r.fail_reason as string | null) ?? null,
    })),
    kostenGestern: kosten.map((r) => ({
      assignee: r.assignee as string,
      usd: Number(r.usd),
      auftraege: Number(r.n),
    })),
    kanari: kanari.map((r) => ({
      assignee: r.assignee as string,
      state: r.state as string,
      sekunden: r.sekunden === null || r.sekunden === undefined ? null : Number(r.sekunden),
    })),
    agentenFehlen: agenten.map((a) => ({
      id: a.id,
      name: a.displayName ?? a.id,
      status: a.status,
      frozen: a.frozen,
    })),
    abgleich: abgleich
      ? { luecken: abgleich.luecken ?? 0, stale: abgleich.stale?.length ?? 0 }
      : null,
    deadLetters: (await backlog()).dead,
    eingefroren: await isSwarmFrozen(db),
  };
}

/** Der Text der Notice. Rein, damit er sich ohne Datenbank prüfen lässt. */
export function uebersichtText(d: UebersichtDaten, datum: string): string {
  const rueckfragen = d.offen.filter((t) => t.state === 'input-required');
  const haengt = d.offen.filter((t) => t.state !== 'input-required' && t.stillStunden >= 24);
  const rest = d.offen.filter((t) => t.state !== 'input-required' && t.stillStunden < 24);
  const kosten = d.kostenGestern.reduce((s, k) => s + k.usd, 0);
  const zeilen = [
    `☀️ Tagesübersicht ${datum}`,
    `Offen: ${d.offen.length} · wartet auf dich: ${rueckfragen.length} · gestern ${d.fertigGestern} fertig, ` +
      `${d.fehlerGestern.length} ❌ · Kosten gestern ${kosten.toFixed(2)} USD`,
  ];
  if (d.eingefroren) zeilen.push('🛑 Der Schwarm ist eingefroren. Weiter mit `!weiter`.');
  const liste = (titel: string, eintraege: string[]): void => {
    if (!eintraege.length) return;
    zeilen.push('', titel, ...eintraege.slice(0, LISTE_MAX));
    if (eintraege.length > LISTE_MAX)
      zeilen.push(`… und ${eintraege.length - LISTE_MAX} weitere (\`!board\`)`);
  };
  liste(
    '❓ Rückfragen an dich',
    rueckfragen.map(
      (t) => `- ${t.id} ${t.assignee}: ${kurz(t.goal)} (seit ${stunden(t.stillStunden)})`
    )
  );
  liste(
    '⏳ Hängt, über 24 h ohne Bewegung',
    haengt.map(
      (t) =>
        `- ${t.id} ${ZEICHEN[t.state] ?? ''} ${t.assignee}: ${kurz(t.goal)} (seit ${stunden(t.stillStunden)})`
    )
  );
  liste(
    '📋 Offen',
    rest.map((t) => `- ${t.id} ${ZEICHEN[t.state] ?? ''} ${t.assignee}: ${kurz(t.goal)}`)
  );
  liste(
    '❌ Gestern fehlgeschlagen',
    d.fehlerGestern.map((f) => `- ${f.id} ${f.assignee}${f.grund ? `: ${kurz(f.grund, 90)}` : ''}`)
  );
  if (d.kostenGestern.length) {
    zeilen.push(
      '',
      `💰 Kosten gestern: ${d.kostenGestern.map((k) => `${k.assignee} ${k.usd.toFixed(2)} USD (${k.auftraege})`).join(', ')}`
    );
  }
  if (d.kanari.length) {
    zeilen.push(
      `🧪 Kanarienvogel: ${d.kanari
        .map(
          (k) =>
            `${k.assignee} ${k.state === 'completed' ? `✅ ${k.sekunden?.toFixed(1)} s` : k.state === 'failed' ? '❌' : 'läuft noch'}`
        )
        .join(', ')}`
    );
  }
  if (d.agentenFehlen.length) {
    zeilen.push(
      `🔴 Agenten: ${d.agentenFehlen.map((a) => `${a.name} ${a.frozen ? 'eingefroren' : a.status}`).join(', ')}`
    );
  }
  const technik = [
    d.abgleich && (d.abgleich.luecken || d.abgleich.stale)
      ? `Abgleich: ${d.abgleich.luecken} Lücke(n), ${d.abgleich.stale} ohne Bewegung`
      : '',
    d.deadLetters ? `Dead Letters: ${d.deadLetters}` : '',
  ].filter(Boolean);
  if (technik.length) zeilen.push(`🧭 ${technik.join(' · ')}`);
  if (
    !d.offen.length &&
    !d.fehlerGestern.length &&
    !d.agentenFehlen.length &&
    !technik.length &&
    !d.eingefroren
  ) {
    zeilen.push('', 'Alles ruhig.');
  }
  return zeilen.join('\n');
}
