/**
 * Modelle je Agent (matrix/SCHNITTSTELLEN-app.md, „App 2.2“): der Admin-Bereich der App.
 *
 *  - Der Katalog `ops/matrix/modelle.yaml` (MODELLE_FILE) nennt je Agent Art, Standard, erlaubte Modelle und
 *    Aufwände. Vales Änderungen (`!modell @agent …`) liegen in `swarm.modelle` und gehen dem Standard vor.
 *  - Den Stand jedes Agenten gibt es als State-Event `ch.zwaetschge.swarm.modelle` (state_key = Agent) in der
 *    Lobby, auch für Agenten ohne Sprachmodell (`art: keins`), damit die App alle zeigen kann.
 *  - Worker (claude-code, codex-host, plum) bekommen das wirksame Modell im Job (`task.modell`).
 *  - Brian bekommt Hermes' eigenen Befehl `/model <id> --global` in seinen Raum. Hermes wechselt sofort und
 *    schreibt seine config.yaml selbst; seine Antwort im Thread wird zur `bestaetigung` im Event. Global nur
 *    innerhalb eines Anbieters (sonst ginge die Z.AI-Adresse verloren), andere Modelle nur pro Chat.
 */
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { sql, type Db } from './db/index.js';
import { auditMerken } from './db/audit.js';
import { enqueue } from './outbox.js';
import { text as textInhalt } from './appservice/messages.js';
import { agentById, listAgents } from './agents/store.js';
import { lobbyZustand } from './raumhinweis.js';
import { liteStand } from './litellm.js';
import type { Ctx } from './context.js';

export const MODELLE_EVENT = 'ch.zwaetschge.swarm.modelle';
const DATEI = process.env.MODELLE_FILE || '/app/ops/matrix/modelle.yaml';

type Art = 'claude' | 'codex' | 'plum' | 'hermes' | 'extern' | 'keins';
interface KatalogModell {
  id: string;
  name: string;
  anbieter?: string;
  modell?: string | null;
}
interface KatalogAgent {
  art: Art;
  wirkt?: string;
  standard?: { modell?: string | null; fallback?: string[]; aufwand?: string | null };
  aufwaende?: string[];
  fallback_max?: number;
  fallback_aenderbar?: boolean;
  modelle?: KatalogModell[];
  nur_chat?: KatalogModell[];
  /** Die Modelle von Brians LiteLLM-Schlüssel kommen dazu, als Anbieter `litellm` (App 2.10). */
  nur_chat_litellm?: boolean;
  hinweis?: string;
}

export interface StimmenStandard {
  standard: string;
  hub: string | null;
  agenten: Record<string, string>;
}

let katalogStand: Record<string, KatalogAgent> | null = null;
let stimmenStand: StimmenStandard = { standard: 'default', hub: null, agenten: {} };
export function katalog(): Record<string, KatalogAgent> {
  if (!katalogStand) {
    try {
      const d = parse(readFileSync(DATEI, 'utf8')) as {
        agenten?: Record<string, KatalogAgent>;
        stimmen?: Partial<StimmenStandard>;
      };
      katalogStand = d?.agenten ?? {};
      stimmenStand = {
        standard: d?.stimmen?.standard || 'default',
        hub: d?.stimmen?.hub ?? null,
        agenten: d?.stimmen?.agenten ?? {},
      };
    } catch {
      katalogStand = {};
    }
  }
  return katalogStand;
}

/** Standard-Stimmen aus dem Katalog (Abschnitt `stimmen`); `!stimme` legt Vales Wahl darüber. */
export function stimmenStandard(): StimmenStandard {
  katalog();
  return stimmenStand;
}

const einstellbar = (k: KatalogAgent | undefined): boolean =>
  Boolean(k && ['claude', 'codex', 'plum', 'hermes'].includes(k.art));

interface Wirksam {
  modell: string | null;
  fallback: string[];
  aufwand: string | null;
}

async function zeile(agent: string, db: Db) {
  const [z] = await db`
    SELECT modell, fallback, aufwand, stimme, geaendert_von, geaendert_am, bestaetigung FROM swarm.modelle WHERE agent = ${agent}`;
  return z ?? null;
}

/** NULL in swarm.modelle heisst „Standard aus dem Katalog“; eine leere Ersatzkette ist gewollt leer. */
export async function wirksam(agent: string, db: Db = sql): Promise<Wirksam | null> {
  const k = katalog()[agent];
  if (!einstellbar(k)) return null;
  const z = await zeile(agent, db);
  const std = k!.standard ?? {};
  return {
    modell: (z?.modell as string | null) ?? std.modell ?? null,
    fallback: (z?.fallback as string[] | null) ?? std.fallback ?? [],
    aufwand: (z?.aufwand as string | null) ?? std.aufwand ?? null,
  };
}

/** Für den Job an einen Worker (worker/server.ts). Plum bekommt Anbieter und Modell getrennt. */
export async function modellFuerJob(
  agent: string,
  db: Db = sql
): Promise<Record<string, unknown> | null> {
  const k = katalog()[agent];
  if (!k || !['claude', 'codex', 'plum'].includes(k.art)) return null;
  const w = await wirksam(agent, db);
  if (!w) return null;
  if (k.art !== 'plum') return { modell: w.modell, fallback: w.fallback, aufwand: w.aufwand };
  const eintrag = (id: string | null) => (k.modelle ?? []).find((m) => m.id === id);
  const e = eintrag(w.modell);
  return {
    id: w.modell,
    anbieter: e?.anbieter ?? null,
    modell: e?.modell ?? null,
    aufwand: w.aufwand,
    fallback: w.fallback
      .map(eintrag)
      .filter((m): m is KatalogModell => Boolean(m))
      .map((m) => ({ id: m.id, anbieter: m.anbieter ?? null, modell: m.modell ?? null })),
  };
}

async function inhalt(agent: string, db: Db): Promise<Record<string, unknown>> {
  const k = katalog()[agent];
  const art: Art = k?.art ?? 'keins';
  const z = await zeile(agent, db);
  const w = await wirksam(agent, db);
  const liste = (l?: KatalogModell[]) =>
    (l ?? []).map((m) => ({
      id: m.id,
      name: m.name,
      ...(m.anbieter ? { anbieter: m.anbieter } : {}),
    }));
  return {
    v: 1,
    agent,
    art,
    einstellbar: einstellbar(k),
    modell: w?.modell ?? null,
    fallback: w?.fallback ?? [],
    aufwand: w?.aufwand ?? null,
    standard: k?.standard
      ? {
          modell: k.standard.modell ?? null,
          fallback: k.standard.fallback ?? [],
          aufwand: k.standard.aufwand ?? null,
        }
      : null,
    modelle: liste(k?.modelle),
    aufwaende: k?.aufwaende ?? [],
    fallback_aenderbar: einstellbar(k) && k?.fallback_aenderbar !== false,
    fallback_max: Math.max(0, Math.round(k?.fallback_max ?? 3)),
    wirkt: k?.wirkt ?? null,
    hinweis: k?.hinweis ?? (art === 'keins' ? 'Ohne einstellbares Sprachmodell.' : null),
    nur_chat: [
      ...liste(k?.nur_chat),
      ...(k?.nur_chat_litellm ? liteModelle(k.nur_chat ?? []) : []),
    ],
    stimme:
      (z?.stimme as string | null | undefined) ??
      stimmenStandard().agenten[agent] ??
      stimmenStandard().standard,
    stimme_standard: stimmenStandard().agenten[agent] ?? stimmenStandard().standard,
    geaendert_von: (z?.geaendert_von as string | undefined) ?? null,
    geaendert_am: z ? new Date(z.geaendert_am as string).getTime() : null,
    bestaetigung: (z?.bestaetigung as string | null | undefined) ?? null,
  };
}

/** LiteLLM-Modelle für den Chat: ohne reine Bildmodelle und ohne, was der Katalog schon nennt. */
function liteModelle(schon: KatalogModell[]): { id: string; name: string; anbieter: string }[] {
  const da = new Set(schon.map((m) => m.id));
  return (liteStand()?.modelle ?? [])
    .filter((m) => !da.has(m.id) && !/vision/i.test(m.id))
    .map((m) => ({
      id: m.id,
      name: `${m.anbieter} · ${m.id.split('/').slice(1).join('/') || m.id} (LiteLLM)`,
      anbieter: 'litellm',
    }));
}

const letzte = new Map<string, string>();

/** Für `!stimme` (stimmen.ts): den Stand eines Agenten sofort neu veröffentlichen. */
export async function modellStandVeroeffentlichen(
  ctx: Ctx,
  agent: string,
  db: Db
): Promise<boolean> {
  return veroeffentlichen(ctx, agent, db);
}

async function veroeffentlichen(ctx: Ctx, agent: string, db: Db): Promise<boolean> {
  const i = await inhalt(agent, db);
  const vergleich = JSON.stringify(i);
  if (letzte.get(agent) === vergleich) return false;
  if (!(await lobbyZustand(ctx, MODELLE_EVENT, agent, i, db))) return false;
  letzte.set(agent, vergleich);
  return true;
}

/** Takt (weiter.ts): den Stand aller Agenten veröffentlichen, wenn er sich geändert hat. */
export async function modelleVeroeffentlichen(ctx: Ctx): Promise<number> {
  let n = 0;
  for (const a of await listAgents()) if (await veroeffentlichen(ctx, a.id, sql)) n++;
  return n;
}

const name = (k: KatalogAgent, id: string | null) =>
  id === null
    ? 'Standard'
    : ([...(k.modelle ?? []), ...(k.nur_chat ?? [])].find((m) => m.id === id)?.name ?? id);

async function zeileText(agent: string, db: Db): Promise<string> {
  const k = katalog()[agent];
  if (!einstellbar(k))
    return `• ${agent}: ${k?.art === 'extern' ? (k.hinweis ?? 'extern') : 'ohne Sprachmodell'}`;
  const w = (await wirksam(agent, db))!;
  return (
    `• ${agent}: ${name(k!, w.modell)}` +
    (w.fallback.length ? ` · Ersatz ${w.fallback.map((f) => name(k!, f)).join(' → ')}` : '') +
    (w.aufwand ? ` · Aufwand ${w.aufwand}` : '')
  );
}

async function uebersicht(db: Db): Promise<string> {
  const zeilen = [] as string[];
  for (const a of await listAgents(db)) zeilen.push(await zeileText(a.id, db));
  return [
    '🧠 Modelle je Agent:',
    ...zeilen,
    'Ändern: `!modell @agent <modell> [fallback <a>,<b>|keiner] [aufwand <stufe>|standard]`, zurück: `!modell @agent standard`.',
  ].join('\n');
}

async function details(agent: string, db: Db): Promise<string> {
  const k = katalog()[agent]!;
  return [
    await zeileText(agent, db),
    `Modelle: ${(k.modelle ?? []).map((m) => m.id).join(', ') || '–'}` +
      (k.nur_chat?.length ? ` · nur pro Chat: ${k.nur_chat.map((m) => m.id).join(', ')}` : ''),
    `Aufwand: ${(k.aufwaende ?? []).join(', ') || '–'} · Ersatz höchstens ${k.fallback_max ?? 3}${k.fallback_aenderbar === false ? ' (nicht änderbar)' : ''}`,
    ...(k.hinweis ? [k.hinweis] : []),
  ].join('\n');
}

/**
 * Der Befehl an Hermes: `/model <id> --global`, mit `--provider <name>`, wenn der Katalog einen benannten Anbieter
 * nennt (seit 29.09.: `litellm` für GLM-5.3 über Mistral, `zai-coding` für den Coding-Plan). `custom` heisst:
 * ohne Angabe, wie früher.
 */
export function hermesBefehl(agent: string, modell: string): string {
  const k = katalog()[agent];
  const anbieter = (k?.modelle ?? []).find((m) => m.id === modell)?.anbieter;
  return `/model ${modell} --global${anbieter && anbieter !== 'custom' && /^[a-z0-9-]{2,32}$/.test(anbieter) ? ` --provider ${anbieter}` : ''}`;
}

/** Der Befehl an Brian; seine Antwort im Thread ordnet `modellBestaetigung` zu. */
async function anHermes(ctx: Ctx, agent: string, modell: string, db: Db): Promise<void> {
  const a = await agentById(agent, db);
  if (!a?.roomId) return;
  const [id] = await enqueue(
    db,
    [
      {
        kind: 'message',
        roomId: a.roomId,
        payload: { type: 'm.room.message', content: textInhalt(hermesBefehl(agent, modell)) },
      },
    ],
    ctx.hub
  );
  await db`UPDATE swarm.modelle SET befehl_outbox = ${id ?? null}, bestaetigung = NULL WHERE agent = ${agent}`;
}

/** `!modell [@agent [<modell>|standard] [fallback <a>,<b>|keiner] [aufwand <stufe>|standard]]` */
export async function cmdModell(
  ctx: Ctx,
  tx: Db,
  input: { body: string; sender?: string },
  antwort: (t: string) => Promise<void>
): Promise<void> {
  const teile = input.body
    .trim()
    .replace(/^!modelle?\s*/i, '')
    .split(/\s+/)
    .filter(Boolean);
  if (!teile.length) return antwort(await uebersicht(tx));
  const agent = teile[0]!.replace(/^@/, '').toLowerCase();
  if (!(await agentById(agent, tx)))
    return antwort(`🚫 Unbekannter Agent „${agent}“. \`!modell\` zeigt alle.`);
  const k = katalog()[agent];
  if (!einstellbar(k))
    return antwort(
      `🚫 ${agent}: ${k?.art === 'extern' ? (k.hinweis ?? 'wird anderswo eingestellt') : 'hat kein einstellbares Sprachmodell'}.`
    );
  if (teile.length === 1) return antwort(await details(agent, tx));

  const vorher = (await wirksam(agent, tx))!;
  const von = input.sender ?? ctx.owner;
  if (teile[1] === 'standard' && teile.length === 2) {
    // Nur das Modell zurück; eine eigene Stimme (`!stimme`) bleibt.
    await tx`UPDATE swarm.modelle SET modell = NULL, fallback = NULL, aufwand = NULL, geaendert_von = ${von}, geaendert_am = now()
              WHERE agent = ${agent}`;
    const std = k!.standard?.modell ?? null;
    if (k!.art === 'hermes' && std && std !== vorher.modell) await anHermes(ctx, agent, std, tx);
    auditMerken(von, 'modell.standard', agent, {});
    await veroeffentlichen(ctx, agent, tx);
    return antwort(`✅ ${agent} ist zurück auf dem Standard: ${await zeileText(agent, tx)}`);
  }

  // Ohne Modell nach dem Agenten bleibt das Modell, und nur Ersatz oder Aufwand ändern sich.
  let i = 1;
  let modell: string | undefined;
  if (teile[1] !== 'fallback' && teile[1] !== 'aufwand') {
    modell = teile[1];
    i = 2;
  }
  let fallback: string[] | undefined;
  let aufwand: string | null | undefined;
  const fehler: string[] = [];
  while (i < teile.length) {
    const wort = teile[i]!.toLowerCase();
    const wert = teile[i + 1];
    if (wort === 'fallback' && wert !== undefined) {
      fallback =
        wert === 'keiner' || wert === 'keine'
          ? []
          : wert
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
    } else if (wort === 'aufwand' && wert !== undefined) {
      aufwand = wert === 'standard' ? null : wert;
    } else {
      fehler.push(`„${teile[i]}“ verstehe ich nicht`);
      break;
    }
    i += 2;
  }

  const ids = new Set((k!.modelle ?? []).map((m) => m.id));
  const nurChat = new Set((k!.nur_chat ?? []).map((m) => m.id));
  if (modell !== undefined && !ids.has(modell)) {
    fehler.push(
      nurChat.has(modell)
        ? `${modell} geht bei ${agent} nur pro Chat in Allgemein, nicht global`
        : `unbekanntes Modell ${modell} (erlaubt: ${[...ids].join(', ')})`
    );
  }
  const neuesModell = modell ?? vorher.modell;
  if (fallback !== undefined) {
    if (k!.fallback_aenderbar === false)
      fehler.push(`die Ersatzkette von ${agent} lässt sich hier nicht ändern`);
    else {
      const max = k!.fallback_max ?? 3;
      if (fallback.length > max)
        fehler.push(`höchstens ${max} Ersatzmodell${max === 1 ? '' : 'e'}`);
      for (const f of fallback) if (!ids.has(f)) fehler.push(`unbekanntes Ersatzmodell ${f}`);
      if (neuesModell && fallback.includes(neuesModell))
        fehler.push('das Hauptmodell kann nicht sein eigener Ersatz sein');
      if (new Set(fallback).size !== fallback.length) fehler.push('ein Ersatzmodell steht doppelt');
    }
  }
  if (aufwand !== undefined && aufwand !== null && !(k!.aufwaende ?? []).includes(aufwand)) {
    fehler.push(
      (k!.aufwaende ?? []).length
        ? `Aufwand ${aufwand} gibt es nicht (${(k!.aufwaende ?? []).join(', ')})`
        : `${agent} kennt keinen Aufwand`
    );
  }
  if (fehler.length) return antwort(`🚫 ${agent}: ${fehler.join('; ')}.`);

  const [alt] =
    await tx`SELECT modell, fallback, aufwand FROM swarm.modelle WHERE agent = ${agent}`;
  const zModell = modell !== undefined ? modell : ((alt?.modell as string | null) ?? null);
  const zFallback =
    fallback !== undefined ? fallback : ((alt?.fallback as string[] | null) ?? null);
  const zAufwand = aufwand !== undefined ? aufwand : ((alt?.aufwand as string | null) ?? null);
  await tx`
    INSERT INTO swarm.modelle (agent, modell, fallback, aufwand, geaendert_von, geaendert_am)
    VALUES (${agent}, ${zModell}, ${zFallback}, ${zAufwand}, ${von}, now())
    ON CONFLICT (agent) DO UPDATE SET modell = EXCLUDED.modell, fallback = EXCLUDED.fallback,
      aufwand = EXCLUDED.aufwand, geaendert_von = EXCLUDED.geaendert_von, geaendert_am = now()`;
  const brianWechsel = k!.art === 'hermes' && modell !== undefined && modell !== vorher.modell;
  if (brianWechsel) await anHermes(ctx, agent, modell!, tx);
  auditMerken(von, 'modell.gesetzt', agent, {
    modell: zModell,
    fallback: zFallback,
    aufwand: zAufwand,
  });
  await veroeffentlichen(ctx, agent, tx);
  const wann =
    k!.wirkt === 'neue-sitzung'
      ? 'Gilt für neue Sitzungen.'
      : k!.wirkt === 'sofort'
        ? ''
        : 'Gilt ab dem nächsten Auftrag.';
  return antwort(
    `✅ ${await zeileText(agent, tx)}` +
      (brianWechsel
        ? `\nBrian bekommt \`${hermesBefehl(agent, modell!)}\` und bestätigt im Thread in #ag-brian.`
        : wann
          ? `\n${wann}`
          : '')
  );
}

/** Inbox: Brians Antwort im Thread seines `/model`-Befehls wird zur Bestätigung im Event. */
export async function modellBestaetigung(
  ctx: Ctx,
  tx: Db,
  row: { sender: string; content: Record<string, unknown> | null }
): Promise<boolean> {
  const rel = (row.content?.['m.relates_to'] ?? null) as {
    rel_type?: string;
    event_id?: string;
  } | null;
  if (rel?.rel_type !== 'm.thread' || !rel.event_id) return false;
  const [z] = await tx`
    SELECT m.agent FROM swarm.modelle m JOIN swarm.outbox o ON o.id = m.befehl_outbox
     WHERE o.sent_event_id = ${rel.event_id}`;
  if (!z) return false;
  const a = await agentById(String(z.agent), tx);
  if (!a || a.mxid !== row.sender) return false;
  const erste = String(row.content?.body ?? '')
    .split('\n')
    .map((s) => s.trim())
    .find(Boolean);
  if (!erste) return true;
  await tx`UPDATE swarm.modelle SET bestaetigung = ${erste.slice(0, 300)} WHERE agent = ${String(z.agent)}`;
  await veroeffentlichen(ctx, String(z.agent), tx);
  return true;
}
