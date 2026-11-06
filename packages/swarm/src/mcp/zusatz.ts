/**
 * Werkzeuge aus matrix/PLAN-weiter.md, getrennt von `tools.ts`, damit sich zwei Sessions dort nicht in
 * die Quere kommen. `tools.ts` hängt sie mit einer Zeile an `WERKZEUGE` an.
 */
import type { Werkzeug } from './tools.js';
import { WerkzeugFehler } from './tools.js';
import { nachschlagen } from '../gedaechtnis.js';
import { agentById, roomsByKind } from '../agents/store.js';
import { createTaskFlow } from '../tasks/create.js';
import { redact } from '../redact.js';
import { sql } from '../db/index.js';
import { auditMerken, isSwarmFrozen } from '../db/audit.js';
import { beanspruchen, freigeben, offeneAbsprachen } from '../absprachen.js';
import { profilFuerAgenten } from '../profil.js';

const str = (beschreibung: string) => ({ type: 'string', description: beschreibung });
const schema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

export const ZUSATZ: Werkzeug[] = [
  {
    name: 'nachschlagen',
    description:
      'Im Schwarm-Gedächtnis suchen: frühere Aufträge mit Ziel und Ergebnis, nach Bedeutung (bge-m3) oder Volltext. ' +
      'Vor grösseren Aufträgen nachsehen, ob es das schon gab.',
    inputSchema: schema(
      {
        frage: str('Wonach gesucht wird'),
        anzahl: { type: 'number', description: 'Treffer (Standard 5, höchstens 20)' },
      },
      ['frage']
    ),
    nurLesen: true,
    async handler(_a, args) {
      return {
        treffer: await nachschlagen(
          String(args.frage ?? ''),
          typeof args.anzahl === 'number' ? args.anzahl : 5
        ),
      };
    },
  },
  {
    name: 'auftrag_geben',
    description:
      'Einen Auftrag an einen Agenten des Schwarms geben, aus einer Plum-Sitzung. Das Ergebnis kommt als Nachricht ' +
      'in diese Sitzung zurück. Code- und Host-Agenten (T2) starten erst nach Vales Freigabe.',
    inputSchema: schema(
      {
        agent: str('Ziel, etwa brian, betrieb, claude-code, codex-host, hermes-phone'),
        ziel: str('Was zu tun ist, für sich verständlich'),
        budget_minuten: { type: 'number', description: 'Minutenbudget (optional)' },
      },
      ['agent', 'ziel']
    ),
    async handler(a, args) {
      if (a.agent !== 'plum' || !a.sitzung)
        throw new WerkzeugFehler(
          'Nur aus einer Plum-Sitzung (Kopf x-plum-session, Token des Agenten plum).'
        );
      if (await isSwarmFrozen()) throw new WerkzeugFehler('Der Schwarm ist eingefroren (!stop).');
      const ziel = await agentById(String(args.agent ?? ''));
      if (!ziel || ziel.mode === 'notify' || ziel.id === 'plum')
        throw new WerkzeugFehler(`${String(args.agent)} nimmt keine Aufträge an.`);
      const plum = await agentById('plum');
      const [lobby] = await roomsByKind('lobby');
      const text = redact(String(args.ziel ?? ''))
        .trim()
        .slice(0, 2000);
      if (!text) throw new WerkzeugFehler('Ohne Ziel kein Auftrag.');
      const r = await createTaskFlow(a.ctx, {
        goal: text,
        assignee: ziel.id,
        from: plum?.mxid ?? 'plum',
        originRoom: lobby?.roomId ?? '',
        originThread: null,
        isHandoff: true,
        idempotencyKey: `plum:${a.sitzung}:${ziel.id}:${text.slice(0, 80)}:${Math.floor(Date.now() / 60_000)}`,
        ...(typeof args.budget_minuten === 'number'
          ? { budgetMinutes: Math.max(1, Math.min(120, args.budget_minuten)) }
          : {}),
      });
      if (!r.ok) throw new WerkzeugFehler(`Abgelehnt (${r.code}): ${r.reason}`);
      await sql`INSERT INTO swarm.plum_auftraege (task_id, sitzung) VALUES (${r.taskId}, ${a.sitzung}) ON CONFLICT DO NOTHING`;
      auditMerken('plum', 'plum.auftrag', r.taskId, {
        ziel: ziel.id,
        sitzung: a.sitzung.slice(0, 8),
      });
      return {
        ok: true,
        task: r.taskId,
        state: r.state,
        hinweis:
          r.state === 'auth-required'
            ? `${r.taskId} wartet auf Vales Freigabe (${ziel.id} ist ${ziel.trust}). Das Ergebnis kommt hierher.`
            : `${r.taskId} liegt bei ${ziel.id}. Das Ergebnis kommt als Nachricht in diese Sitzung.`,
      };
    },
  },
  {
    name: 'swarm_profil',
    description:
      'Zuverlässigkeit der Agenten über 30 Tage: Erfolgsquote, Median-Dauer, Kosten, Vales 👍/👎, laufende Pause. ' +
      'Bei Übergaben den zuverlässigeren wählen; ein pausierter Agent nimmt nichts an.',
    inputSchema: schema({}),
    nurLesen: true,
    async handler() {
      return { profile: await profilFuerAgenten() };
    },
  },
  {
    name: 'absprache_liste',
    description:
      'Wer arbeitet gerade an welchen Dateien (Sitzungen und Agenten)? Vor dem Ändern eines Repos lesen.',
    inputSchema: schema({}),
    nurLesen: true,
    async handler() {
      return { absprachen: await offeneAbsprachen() };
    },
  },
  {
    name: 'absprache_nehmen',
    description:
      'Dateien für dich beanspruchen, bevor du sie änderst. Pfade relativ zu /mnt/cache/AI/plum-code, ' +
      'Ordner mit / am Ende. Überschneidet sich das mit jemandem, kommt eine Liste zurück und nichts wird eingetragen, ' +
      'ausser mit trotzdem=true (dann bekommt Vale einen Hinweis).',
    inputSchema: schema(
      {
        pfade: { type: 'array', items: { type: 'string' }, description: 'Dateien oder Ordner' },
        zweck: str('Wofür, in einem Satz'),
        stunden: { type: 'number', description: 'Ablauf in Stunden (Standard 4, höchstens 48)' },
        trotzdem: { type: 'boolean', description: 'Auch bei Überschneidung eintragen' },
      },
      ['pfade', 'zweck']
    ),
    async handler(a, args) {
      return beanspruchen(a.ctx, {
        wer: a.agent,
        quelle: 'agent',
        pfade: Array.isArray(args.pfade) ? args.pfade.map(String) : [],
        zweck: String(args.zweck ?? ''),
        ...(typeof args.stunden === 'number' ? { stunden: args.stunden } : {}),
        trotzdem: args.trotzdem === true,
      });
    },
  },
  {
    name: 'absprache_geben',
    description:
      'Eigene Absprachen freigeben, wenn du fertig bist: alle, eine (id) oder bestimmte Pfade.',
    inputSchema: schema({
      id: { type: 'number', description: 'Nur diese Absprache' },
      pfade: {
        type: 'array',
        items: { type: 'string' },
        description: 'Nur Absprachen mit diesen Pfaden',
      },
    }),
    async handler(a, args) {
      const n = await freigeben(a.ctx, {
        wer: a.agent,
        ...(typeof args.id === 'number' ? { id: args.id } : {}),
        ...(Array.isArray(args.pfade) ? { pfade: args.pfade.map(String) } : {}),
      });
      return { freigegeben: n };
    },
  },
];
