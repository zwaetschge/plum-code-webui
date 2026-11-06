/**
 * Schwarm-Gedächtnis (matrix/PLAN-weiter.md, Punkt 9): Frühere Ergebnisse finden, statt Arbeit doppelt zu machen.
 *
 *  - Jeder fertige Auftrag (ohne Selbsttests und Betrieb) kommt mit Ziel und Ergebnis in `swarm.gedaechtnis`:
 *    Volltext (deutsch) immer, dazu ein Vektor von bge-m3 (1024) aus `vocarium-embeddings`, erreichbar über
 *    schwarm-plum-relay (/einbettung). Ist der Dienst weg, bleibt die Volltextsuche; der Vektor kommt später.
 *  - `nachschlagen` (MCP) und `!erinnern <frage>` suchen darin.
 *  - Neue Aufträge von Vale und Brian bekommen einmal einen Hinweis im Thread, wenn es Ähnliches schon gab:
 *    „🔎 Ähnlich: T-0123 (✅ 12.09.) …“.
 */
import { sql, type Db } from './db/index.js';
import { enqueue } from './outbox.js';
import { notice } from './appservice/messages.js';
import { redact } from './redact.js';
import type { Ctx } from './context.js';

const URL = process.env.EINBETTUNG_URL || 'http://schwarm-plum-relay:8080/einbettung';
const MODELL = process.env.EINBETTUNG_MODELL || 'bge-m3';
/** Ab dieser Kosinus-Ähnlichkeit gilt ein früherer Auftrag als „ähnlich“ für den Hinweis. */
const SCHWELLE = Number(process.env.GEDAECHTNIS_SCHWELLE || 0.75);
const OHNE = ['betrieb', 'git'];

let mitVektor: boolean | null = null;
/** Hat die Tabelle eine Vektor-Spalte? Ohne pgvector (Test-DB) sucht das Gedächtnis nur im Volltext. */
async function vektorDa(db: Db = sql): Promise<boolean> {
  if (mitVektor === null) {
    const [z] =
      await db`SELECT 1 FROM information_schema.columns WHERE table_schema = 'swarm' AND table_name = 'gedaechtnis' AND column_name = 'einbettung'`;
    mitVektor = Boolean(z);
  }
  return mitVektor;
}

export async function einbetten(text: string): Promise<number[] | null> {
  if (!(await vektorDa())) return null;
  try {
    const res = await fetch(URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: text.slice(0, 6000), model: MODELL }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const d = (await res.json()) as { data?: { embedding?: number[] }[] };
    const v = d.data?.[0]?.embedding;
    return Array.isArray(v) && v.length === 1024 ? v : null;
  } catch {
    return null;
  }
}

const vektorText = (v: number[]): string =>
  `[${v.map((x) => (Number.isFinite(x) ? x : 0)).join(',')}]`;

export interface Treffer {
  taskId: string | null;
  agent: string | null;
  text: string;
  erstellt: string;
  aehnlich: number;
  state: string | null;
}

/** Suche: Vektor, wenn möglich, sonst Volltext. `ohne` schliesst einen Auftrag (und seine Kette) aus. */
export async function nachschlagen(
  frage: string,
  n = 5,
  ohne: string | null = null,
  db: Db = sql
): Promise<Treffer[]> {
  const v = await einbetten(frage);
  const grenze = Math.max(1, Math.min(n, 20));
  // Der Operator liegt mit pgvector im Schema public; der Hub sucht nur in swarm, deshalb voll ausgeschrieben.
  const rows = v
    ? await db`
        SELECT g.task_id, g.agent, g.text, g.erstellt, 1 - (g.einbettung OPERATOR(public.<=>) ${vektorText(v)}::public.vector) AS aehnlich, t.state
          FROM swarm.gedaechtnis g LEFT JOIN swarm.tasks t ON t.id = g.task_id
         WHERE g.einbettung IS NOT NULL AND (${ohne}::text IS NULL OR g.task_id IS DISTINCT FROM ${ohne})
         ORDER BY g.einbettung OPERATOR(public.<=>) ${vektorText(v)}::public.vector LIMIT ${grenze}`
    : await db`
        SELECT g.task_id, g.agent, g.text, g.erstellt, ts_rank(g.fts, websearch_to_tsquery('german', ${frage})) AS aehnlich, t.state
          FROM swarm.gedaechtnis g LEFT JOIN swarm.tasks t ON t.id = g.task_id
         WHERE g.fts @@ websearch_to_tsquery('german', ${frage}) AND (${ohne}::text IS NULL OR g.task_id IS DISTINCT FROM ${ohne})
         ORDER BY aehnlich DESC LIMIT ${grenze}`;
  return rows.map((r) => ({
    taskId: (r.task_id as string | null) ?? null,
    agent: (r.agent as string | null) ?? null,
    text: redact(String(r.text)).slice(0, 600),
    erstellt: new Date(r.erstellt as string).toISOString(),
    aehnlich: Math.round(Number(r.aehnlich) * 1000) / 1000,
    state: (r.state as string | null) ?? null,
  }));
}

const datum = (iso: string): string =>
  new Date(iso).toLocaleDateString('de-CH', {
    timeZone: 'Europe/Zurich',
    day: '2-digit',
    month: '2-digit',
  });
const zeichen = (s: string | null): string =>
  s === 'completed' ? '✅' : s === 'failed' ? '❌' : s === 'canceled' ? '🛑' : '·';
const ersteZeile = (t: string, n = 70): string => {
  const z = t.split('\n')[0]!.trim();
  return z.length > n ? `${z.slice(0, n - 1)}…` : z;
};

/** `!erinnern <frage>` */
export async function erinnernText(frage: string): Promise<string> {
  if (!frage.trim())
    return 'Aufruf: `!erinnern <frage>`, etwa `!erinnern Radio-Stream neu starten`.';
  const treffer = await nachschlagen(frage, 6);
  if (!treffer.length) return 'Nichts Ähnliches im Gedächtnis.';
  return [
    '🔎 Im Gedächtnis:',
    ...treffer.map(
      (t) =>
        `• ${t.taskId ?? '—'} ${zeichen(t.state)} ${datum(t.erstellt)} · ${t.agent ?? '?'} · ${ersteZeile(t.text)} (${Math.round(t.aehnlich * 100)} %)`
    ),
  ].join('\n');
}

/** Takt (weiter.ts): fertige Aufträge ins Gedächtnis, fehlende Vektoren nachtragen, Hinweise an neue Aufträge. */
export async function gedaechtnisTakt(ctx: Ctx): Promise<number> {
  let neu = 0;
  const fertig = await sql`
    SELECT t.id, t.assignee, t.goal, t.result, t.updated_at FROM swarm.tasks t
     WHERE t.state = 'completed' AND t.result IS NOT NULL AND t.goal NOT LIKE 'Selbsttest:%'
       AND t.assignee <> ALL(${OHNE}::text[]) AND t.updated_at > now() - interval '90 days'
       AND NOT EXISTS (SELECT 1 FROM swarm.gedaechtnis g WHERE g.task_id = t.id)
       AND NOT EXISTS (SELECT 1 FROM swarm.gedaechtnis_verworfen f WHERE f.task_id = t.id)
     ORDER BY t.updated_at DESC LIMIT 5`;
  for (const t of fertig) {
    const text = `${String(t.goal).trim()}\n\n${redact(String(t.result)).slice(0, 3000)}`;
    // Der Vektor soll ähnliche Aufträge finden: Ziel und nur der Anfang des Ergebnisses; der Volltext hat alles.
    const v = await einbetten(
      `${String(t.goal).trim()}\n${redact(String(t.result)).slice(0, 300)}`
    );
    if (v) {
      await sql`
        INSERT INTO swarm.gedaechtnis (task_id, agent, text, einbettung, erstellt)
        VALUES (${t.id as string}, ${t.assignee as string}, ${text}, ${vektorText(v)}::public.vector, ${t.updated_at as string})
        ON CONFLICT (task_id) DO NOTHING`;
    } else {
      await sql`
        INSERT INTO swarm.gedaechtnis (task_id, agent, text, erstellt)
        VALUES (${t.id as string}, ${t.assignee as string}, ${text}, ${t.updated_at as string})
        ON CONFLICT (task_id) DO NOTHING`;
    }
    neu++;
  }
  // Vektoren nachtragen, die beim Einfügen fehlten (Dienst war weg).
  const ohneVektor = (await vektorDa())
    ? await sql`SELECT id, text FROM swarm.gedaechtnis WHERE einbettung IS NULL ORDER BY id DESC LIMIT 3`
    : [];
  for (const g of ohneVektor) {
    const v = await einbetten(String(g.text));
    if (!v) break;
    await sql`UPDATE swarm.gedaechtnis SET einbettung = ${vektorText(v)}::public.vector WHERE id = ${g.id as number}`;
  }
  // Hinweise an neue Aufträge von Vale und Brian (einmal, nur in den ersten 10 Minuten).
  const frisch = await sql`
    SELECT t.id, t.goal, t.room_id, t.thread_root FROM swarm.tasks t
     WHERE t.thread_root IS NOT NULL AND t.created_at > now() - interval '10 minutes' AND t.goal NOT LIKE 'Selbsttest:%'
       AND t.assignee <> ALL(${OHNE}::text[]) AND t.parent IS NULL
       AND NOT EXISTS (SELECT 1 FROM swarm.gedaechtnis_hinweise h WHERE h.task_id = t.id)
     ORDER BY t.created_at LIMIT 3`;
  for (const t of frisch) {
    await sql`INSERT INTO swarm.gedaechtnis_hinweise (task_id) VALUES (${t.id as string}) ON CONFLICT DO NOTHING`;
    const treffer = (await nachschlagen(String(t.goal), 3, t.id as string)).filter(
      (x) => x.aehnlich >= SCHWELLE && x.taskId
    );
    if (!treffer.length || !t.room_id) continue;
    const text =
      `🔎 Ähnlich: ${treffer.map((x) => `${x.taskId} (${zeichen(x.state)} ${datum(x.erstellt)}) „${ersteZeile(x.text, 50)}“`).join(' · ')}\n` +
      'Details: !stand <T-…> oder !erinnern <frage>.';
    await enqueue(
      sql,
      [
        {
          kind: 'message',
          roomId: String(t.room_id),
          taskId: String(t.id),
          payload: {
            type: 'm.room.message',
            content: notice(text, { thread: String(t.thread_root) }),
          },
        },
      ],
      ctx.hub
    );
  }
  return neu;
}

const AGENT = /^@([a-z0-9][a-z0-9-]{0,31})\s+/i;

/**
 * `!merken [@agent] <text>` (Verbesserung 6, 28.09., App 2.9): Vale legt eine Notiz ins Gedächtnis, etwa eine
 * Antwort von Brian aus einem Allgemein-Chat. Erste Zeile ist der Titel. Ohne `@agent` steht `vale` als Quelle.
 * Der Vektor kommt sofort, wenn der Dienst da ist, sonst trägt ihn der Takt nach.
 */
export async function cmdMerken(
  input: { body: string },
  antwort: (t: string) => Promise<void>,
  db: Db = sql
): Promise<void> {
  let text = input.body.trim().replace(/^!merken\s*/i, '');
  let agent = 'vale';
  const m = AGENT.exec(text);
  if (m) {
    agent = m[1]!.toLowerCase();
    text = text.slice(m[0].length);
  }
  text = redact(text.trim()).slice(0, 6000);
  if (text.length < 3)
    return antwort('Aufruf: `!merken [@agent] <text>`; die erste Zeile ist der Titel.');
  const v = await einbetten(text.slice(0, 1500));
  const [z] = v
    ? await db`INSERT INTO swarm.gedaechtnis (art, agent, text, einbettung) VALUES ('notiz', ${agent}, ${text}, ${vektorText(v)}::public.vector) RETURNING id`
    : await db`INSERT INTO swarm.gedaechtnis (art, agent, text) VALUES ('notiz', ${agent}, ${text}) RETURNING id`;
  return antwort(
    `📌 Gemerkt als Notiz ${z?.id} („${ersteZeile(text, 50)}“). Finden mit \`!erinnern …\`; Brian schlägt sie nach.`
  );
}
