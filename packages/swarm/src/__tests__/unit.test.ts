import { describe, expect, it } from 'vitest';
import {
  reactionSignal,
  SWARM_OUT_FIELD,
  SWARM_TASK_FIELD,
  TASK_TRANSITIONS,
  canTransition,
} from '../protocol/index.js';
import { applySignal } from '../tasks/state.js';
import { breakerTripped, checkPolicy, type PolicyFacts } from '../tasks/policy.js';
import { boardCardBody, formatTaskId } from '../tasks/card.js';

/**
 * Die Einheitstests der DoD P2: Policy, Zustandsmaschine und Outbox — dazu die
 * Stellen, an denen ein Fehler still bliebe: die Herkunft der `swarm.*`-Felder,
 * die Befehls-Grammatik, der Karten-Text und die Entdopplung der Transaktions-ID.
 * Alles ohne Datenbank und ohne Netz; was beides braucht, läuft als e2e.
 */

const ctx = (over: Partial<Parameters<typeof applySignal>[1]> = {}) => ({
  state: 'submitted' as const,
  attempts: 0,
  openSubtasks: 0,
  fromAssignee: true,
  fromOwner: false,
  ...over,
});

const facts = (over: Partial<PolicyFacts> = {}): PolicyFacts => ({
  agent: {
    id: 'brian',
    status: 'online',
    frozen: false,
    parallel: 1,
    trust: 'T1',
    budgetUsdDay: 3,
    dailyCostUsd: 0,
  },
  hop: 0,
  depth: 0,
  fanOut: 0,
  tasksInRoot: 0,
  duplicateTaskId: null,
  runningForAssignee: 0,
  trustRequired: 'T1',
  swarmFrozen: false,
  maxHops: 4,
  isHandoff: false,
  isRueckmeldung: false,
  ...over,
});

describe('Zustandsmaschine (§8.3)', () => {
  it('👀 holt den Auftrag aus submitted in working', () => {
    expect(applySignal('claim', ctx())).toEqual({ kind: 'transition', to: 'working' });
  });

  it('✅ schliesst ab, wenn kein Unterauftrag offen ist', () => {
    expect(applySignal('done', ctx({ state: 'working' }))).toMatchObject({ to: 'completed' });
  });

  it('✅ mit offenem Unterauftrag bleibt working (§10.3)', () => {
    const r = applySignal('done', ctx({ state: 'working', openSubtasks: 1 }));
    expect(r).toMatchObject({ to: 'working' });
    expect(r.kind === 'transition' && r.note).toContain('wartet auf 1');
  });

  it('✅ ohne vorheriges 👀 schliesst trotzdem ab (Hermes nach Neustart)', () => {
    expect(applySignal('done', ctx({ state: 'submitted' }))).toMatchObject({ to: 'completed' });
  });

  it('❌ startet einmal neu und scheitert dann', () => {
    const erster = applySignal('fail', ctx({ state: 'working', attempts: 0 }));
    expect(erster).toMatchObject({ to: 'submitted', retry: true });
    const zweiter = applySignal('fail', ctx({ state: 'working', attempts: 1 }));
    expect(zweiter).toMatchObject({ to: 'failed' });
  });

  it('🛑 bricht aus jedem Zustand ab, aber nur vom Menschen', () => {
    for (const state of ['submitted', 'working', 'input-required', 'auth-required'] as const) {
      expect(applySignal('cancel', ctx({ state, fromOwner: true }))).toMatchObject({
        to: 'canceled',
      });
    }
    expect(applySignal('cancel', ctx({ state: 'working', fromOwner: false }))).toMatchObject({
      kind: 'ignored',
    });
  });

  it('🔁 wirkt nur auf failed/canceled und zählt den Versuch', () => {
    expect(applySignal('retry', ctx({ state: 'failed', fromOwner: true }))).toMatchObject({
      to: 'submitted',
      retry: true,
    });
    expect(applySignal('retry', ctx({ state: 'working', fromOwner: true }))).toMatchObject({
      kind: 'ignored',
    });
    expect(applySignal('retry', ctx({ state: 'rejected', fromOwner: true }))).toMatchObject({
      kind: 'ignored',
    });
  });

  it('Bot-Signale von anderen und Bedien-Reaktionen von Bots zählen nicht (§8.1)', () => {
    expect(applySignal('done', ctx({ state: 'working', fromAssignee: false }))).toMatchObject({
      kind: 'ignored',
    });
    expect(applySignal('cancel', ctx({ state: 'working', fromOwner: false }))).toMatchObject({
      kind: 'ignored',
    });
    expect(applySignal('retry', ctx({ state: 'failed', fromOwner: false }))).toMatchObject({
      kind: 'ignored',
    });
  });

  it('⬆️ ändert die Priorität, nicht den Zustand', () => {
    expect(applySignal('priority', ctx({ state: 'working', fromOwner: true }))).toEqual({
      kind: 'priority',
      value: 'high',
    });
  });

  it('aus input-required geht auch der Abschluss (§8.3)', () => {
    expect(canTransition('input-required', 'completed')).toBe(true);
    expect(canTransition('input-required', 'working')).toBe(true);
    expect(canTransition('submitted', 'completed')).toBe(false);
    // stalled: niemand hat den Auftrag angenommen (§10.4)
    expect(canTransition('submitted', 'failed')).toBe(true);
  });

  it('Endzustände bleiben unverändert — ausser 🔁 auf canceled/failed (§8.3)', () => {
    for (const state of ['completed', 'rejected'] as const) {
      expect(TASK_TRANSITIONS[state]).toEqual([]);
      expect(canTransition(state, 'working')).toBe(false);
      expect(canTransition(state, 'submitted')).toBe(false);
    }
    expect(canTransition('canceled', 'submitted')).toBe(true); // 🔁
    expect(canTransition('failed', 'submitted')).toBe(true); // 🔁
    expect(canTransition('canceled', 'completed')).toBe(false);
    expect(canTransition('completed', 'rejected')).toBe(false);
  });

  it('jede Reaktion hat ein Signal, unbekannte nicht', () => {
    expect(reactionSignal('👀')).toBe('claim');
    expect(reactionSignal('✅')).toBe('done');
    expect(reactionSignal('🛑')).toBe('cancel');
    expect(reactionSignal('🎉')).toBeNull();
    expect(reactionSignal(undefined)).toBeNull();
  });
});

describe('Policy (§12.1)', () => {
  it('lässt einen normalen Auftrag durch', () => {
    expect(checkPolicy(facts())).toEqual({ ok: true, state: 'submitted', queued: false });
  });

  it('Kill-Switch schlägt alles', () => {
    const r = checkPolicy(facts({ swarmFrozen: true, duplicateTaskId: 'T-0001' }));
    expect(r).toMatchObject({ ok: false, code: 'kill-switch' });
  });

  it('eingefrorener Agent lehnt ab', () => {
    expect(checkPolicy(facts({ agent: { ...facts().agent, frozen: true } }))).toMatchObject({
      ok: false,
      code: 'agent-frozen',
    });
  });

  it('Duplikat im 10-min-Fenster verweist auf den bestehenden Auftrag', () => {
    const r = checkPolicy(facts({ duplicateTaskId: 'T-0141' }));
    expect(r).toMatchObject({ ok: false, code: 'duplicate' });
    expect(r.ok === false && r.reason).toContain('T-0141');
  });

  it('Hop 5 über Limit 4 wird abgelehnt', () => {
    expect(checkPolicy(facts({ hop: 5 }))).toMatchObject({ ok: false, code: 'hops' });
    expect(checkPolicy(facts({ hop: 4 }))).toMatchObject({ ok: true });
  });

  it('Rückmeldungen lehnt der Hub nie wegen Hops ab (§12.1)', () => {
    expect(checkPolicy(facts({ hop: 9, isRueckmeldung: true }))).toMatchObject({ ok: true });
  });

  it('Fan-out, Tiefe und Aufträge pro Wurzel haben feste Obergrenzen', () => {
    expect(checkPolicy(facts({ fanOut: 3 }))).toMatchObject({ ok: false, code: 'fan-out' });
    expect(checkPolicy(facts({ depth: 4 }))).toMatchObject({ ok: false, code: 'depth' });
    expect(checkPolicy(facts({ tasksInRoot: 10 }))).toMatchObject({ ok: false, code: 'root' });
  });

  it('Tagesbudget ausschöpft → abgelehnt', () => {
    expect(checkPolicy(facts({ agent: { ...facts().agent, dailyCostUsd: 3 } }))).toMatchObject({
      ok: false,
      code: 'budget',
    });
  });

  it('Vertrauensstufe reicht nicht → abgelehnt', () => {
    expect(checkPolicy(facts({ trustRequired: 'T2' }))).toMatchObject({ ok: false, code: 'trust' });
  });

  it('Übergabe an T2 landet in auth-required (§7.3)', () => {
    const r = checkPolicy(facts({ isHandoff: true, agent: { ...facts().agent, trust: 'T2' } }));
    expect(r).toMatchObject({ ok: true, state: 'auth-required' });
  });

  it('Auslastung reiht ein statt abzulehnen', () => {
    const r = checkPolicy(facts({ runningForAssignee: 1 }));
    expect(r).toMatchObject({ ok: true, queued: true });
  });

  it('offline lehnt ab, unresponsive reiht ein', () => {
    expect(checkPolicy(facts({ agent: { ...facts().agent, status: 'offline' } }))).toMatchObject({
      ok: false,
      code: 'offline',
    });
    expect(
      checkPolicy(facts({ agent: { ...facts().agent, status: 'unresponsive' } }))
    ).toMatchObject({ ok: true, queued: true });
  });

  it('Circuit-Breaker zählt nur das Fenster', () => {
    const jetzt = Date.now();
    const viele = Array.from({ length: 21 }, (_, i) => jetzt - i * 1000);
    expect(breakerTripped(viele, jetzt)).toBe(true);
    expect(breakerTripped(viele.slice(0, 20), jetzt)).toBe(false);
    expect(
      breakerTripped(
        viele.map((t) => t - 10 * 60_000),
        jetzt
      )
    ).toBe(false);
  });
});

describe('Outbox-Transaktions-ID (§10.2)', () => {
  it('ist stabil und unterscheidet Raum, Puppet, Auftrag und Art', async () => {
    const { outboxTxnId } = await import('../outbox.js');
    const basis = {
      asUser: '@schwarm:x',
      roomId: '!a:x',
      taskId: 'T-0001',
      kind: 'message',
      seq: 7,
    };
    const id = outboxTxnId(basis);
    expect(outboxTxnId(basis)).toBe(id);
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(outboxTxnId({ ...basis, seq: 8 })).not.toBe(id);
    expect(outboxTxnId({ ...basis, kind: 'reaction' })).not.toBe(id);
    expect(outboxTxnId({ ...basis, roomId: '!b:x' })).not.toBe(id);
    expect(outboxTxnId({ ...basis, asUser: '@_sw_plum:x' })).not.toBe(id);
    expect(outboxTxnId({ ...basis, taskId: null })).not.toBe(id);
  });
});

describe('Karten und Texte (§8.2)', () => {
  const karte = {
    id: 'T-0142',
    root: 'T-0142',
    parent: null,
    correlationId: '0b6c2f0e-6a8e-4f7b-9a57-3d1c1e0f2a11',
    state: 'submitted' as const,
    from: '@vale:zwaetschge-webui.ch',
    assignee: 'brian',
    assigneeName: 'Brian',
    assigneeMxid: '@brian:zwaetschge-webui.ch',
    hop: 0,
    depth: 0,
    goal: 'Paperless-Fehler zusammenfassen',
    deliverable: 'Markdown, höchstens 20 Zeilen',
    constraints: ['nur lesen'],
    budgetUsd: 0.5,
    budgetMinutes: 20,
    deadline: null,
    trustRequired: 'T1' as const,
  };

  it('der Body enthält alles, was ein Kollege bräuchte', async () => {
    const { taskCardBody, taskCardContent } = await import('../tasks/card.js');
    const body = taskCardBody(karte);
    expect(body).toContain('@Brian Auftrag T-0142');
    expect(body).toContain('Ziel: Paperless-Fehler zusammenfassen');
    expect(body).toContain('Ergebnis: Markdown, höchstens 20 Zeilen');
    expect(body).toContain('Grenzen: nur lesen');
    expect(body).toContain('Budget: 0.50 USD / 20 min');
    expect(body).toContain('Rückfragen: hier im Thread');
    const content = taskCardContent(karte);
    expect(content.v).toBe(1);
    expect(content.id).toBe('T-0142');
    expect(content.state).toBe('submitted');
  });

  it('Board-Karte zeigt den Zustand', () => {
    expect(boardCardBody(karte)).toContain('📥 T-0142');
    expect(boardCardBody({ ...karte, state: 'completed' })).toContain('✅ T-0142');
  });

  it('prompt_hash ignoriert Pills, HTML, Gross/Klein und Leerraum', async () => {
    const { promptHash } = await import('../tasks/card.js');
    const basis = promptHash('bitte paperless prüfen', 'brian');
    expect(promptHash('<a>BITTE  paperless   prüfen</a>', 'brian')).toBe(basis);
    expect(promptHash('@brian:zwaetschge-webui.ch bitte paperless prüfen', 'brian')).toBe(basis);
    expect(promptHash('  BITTE PAPERLESS PRÜFEN ', 'brian')).toBe(basis);
    // Umlaute werden nicht eingedeutscht: „pruefen“ ist ein anderer Auftrag.
    expect(promptHash('bitte paperless pruefen', 'brian')).not.toBe(basis);
    expect(promptHash('bitte paperless prüfen', 'plum')).not.toBe(basis);
    expect(basis).toMatch(/^[0-9a-f]{64}$/);
  });

  it('Kennungen sind vierstellig', () => {
    expect(formatTaskId(142)).toBe('T-0142');
    expect(formatTaskId(1)).toBe('T-0001');
    expect(formatTaskId(12345)).toBe('T-12345');
  });

  it('Fortschritt und Werkzeugzeilen sind kein Ergebnis (§4.1, §4.3)', async () => {
    const { istFortschritt, istWerkzeugZeile } = await import('../tasks/create.js');
    expect(istFortschritt('⏳ Working — 3 min — web_search')).toBe(true);
    expect(istFortschritt('📚 Reading skill x')).toBe(true);
    expect(istFortschritt('⚠️ Hermes is shutting down — your task…')).toBe(true);
    expect(istFortschritt('⚠️ Hermes is restarting')).toBe(true);
    expect(istFortschritt('⚡ Stopped. You can continue this session.')).toBe(true);
    expect(istWerkzeugZeile('🧠 memory...')).toBe(true);
    expect(istWerkzeugZeile('📝 skill_manage: "x"')).toBe(true);
    expect(istWerkzeugZeile('❓ clarify(')).toBe(true);
    expect(istFortschritt('🧠 memory...')).toBe(true);
    expect(istFortschritt('Es sind 12 Fehler, Ursache volle Platte.')).toBe(false);
    // Eine Nachlieferung ist das Ergebnis, kein Fortschritt (§4.3, 1).
    expect(istFortschritt('♻️ Recovered reply — …')).toBe(false);
  });

  it('Nachlieferung: Text nach der ersten Leerzeile ist das Ergebnis (§4.3, 1)', async () => {
    const { istWiederherstellung, ergebnisVonWiederherstellung } =
      await import('../tasks/create.js');
    const body =
      '♻️ Recovered reply — the messaging platform reconnected, so this may be a duplicate:\n\nZürich hat 452 421 Einwohner.';
    expect(istWiederherstellung(body)).toBe(true);
    expect(ergebnisVonWiederherstellung(body)).toBe('Zürich hat 452 421 Einwohner.');
    expect(ergebnisVonWiederherstellung('♻️ Recovered reply — ohne Leerzeile')).toBe(
      '♻️ Recovered reply — ohne Leerzeile'
    );
    expect(istWiederherstellung('Eine normale Antwort')).toBe(false);
  });

  it('Ergebnis ist die letzte Nachricht vor ✅, plus geteilte Teile (§4.1, §4.3)', async () => {
    const { ergebnisAusThread } = await import('../tasks/create.js');
    const nachrichten = [
      { sender: '@brian:x', body: '🧠 memory...', ts: 1 },
      { sender: '@vale:x', body: 'danke', ts: 2 },
      { sender: '@brian:x', body: 'Zwischentext, den niemand bestellt hat', ts: 3 },
      { sender: '@brian:x', body: '⏳ Working — 2 min', ts: 4 },
      { sender: '@brian:x', body: 'Es sind 452 421 Einwohner.', ts: 5 },
    ];
    expect(ergebnisAusThread(nachrichten, '@brian:x')).toBe('Es sind 452 421 Einwohner.');
    // Eine lange Antwort wird geteilt: der lange Teil davor gehört dazu.
    const lang = 'x'.repeat(16_000);
    expect(
      ergebnisAusThread(
        [
          { sender: '@brian:x', body: lang, ts: 1 },
          { sender: '@brian:x', body: 'Schluss.', ts: 2 },
        ],
        '@brian:x',
        40_000
      )
    ).toBe(`${lang}\n\nSchluss.`);
    // Kurze Nachricht davor = eigene Meldung, kein Teil.
    expect(
      ergebnisAusThread(
        [
          { sender: '@brian:x', body: 'kurz', ts: 1 },
          { sender: '@brian:x', body: 'Schluss.', ts: 2 },
        ],
        '@brian:x'
      )
    ).toBe('Schluss.');
    // Nur Nachrichten des Zuständigen.
    expect(ergebnisAusThread([{ sender: '@vale:x', body: 'x', ts: 1 }], '@brian:x')).toBe('');
    // Kürzen auf die Kartenlänge (§10.7).
    const gekuerzt = ergebnisAusThread(
      [{ sender: '@brian:x', body: 'y'.repeat(5000), ts: 1 }],
      '@brian:x',
      4000
    );
    expect(gekuerzt.length).toBeLessThan(4200);
    expect(gekuerzt).toContain('gekürzt');
  });
});

describe('Befehle (§8.6)', () => {
  it('erkennt Namen, Kurzform und Argumente', async () => {
    const { parseCommand, normalizeArg, BEFEHLE } = await import('../commands/index.js');
    expect(parseCommand('kein Befehl')).toBeNull();
    expect(parseCommand('!hilfe')?.name).toBe('hilfe');
    expect(parseCommand('!a @brian fasse die Fehler zusammen')?.name).toBe('auftrag');
    const cmd = parseCommand('!auftrag @brian:zwaetschge-webui.ch fasse die Fehler zusammen');
    expect(cmd?.args).toEqual(['brian']);
    expect(cmd?.rest).toBe('fasse die Fehler zusammen');
    expect(parseCommand('!stop T-0142')?.args).toEqual(['T-0142']);
    expect(parseCommand('!stop T-142')?.args).toEqual(['T-0142']);
    expect(parseCommand('!stop @_sw_codex-host:x')?.args).toEqual(['codex-host']);
    expect(normalizeArg('@_sw_rat-glm:x')).toBe('rat-glm');
    expect(BEFEHLE.some((b) => b.startsWith('!stand'))).toBe(true);
    // ADR-002 §4.1: !status und !review gehören Hermes, der Hub nutzt !stand/!pruefen.
    expect(BEFEHLE.some((b) => b.startsWith('!status'))).toBe(false);
  });
});

describe('Herkunft und Namensraum (§7.1, §7.2, §10.1)', () => {
  it('hs_token: fehlend 401, falsch 403, richtig ok', async () => {
    const { checkHsToken } = await import('../appservice/auth.js');
    expect(checkHsToken(undefined)).toMatchObject({ ok: false, status: 401 });
    expect(checkHsToken('Bearer falsch')).toMatchObject({ ok: false, status: 403 });
    expect(checkHsToken('Bearer test-hs-token')).toEqual({ ok: true });
  });

  it('Namensraum: Puppets und Hub ja, Brian und Vale nein', async () => {
    const { inUserNamespace, inAliasNamespace } = await import('../appservice/auth.js');
    expect(inUserNamespace('@_sw_codex-host:zwaetschge-webui.ch')).toBe(true);
    expect(inUserNamespace('@schwarm:zwaetschge-webui.ch')).toBe(true);
    expect(inUserNamespace('@brian:zwaetschge-webui.ch')).toBe(false);
    expect(inUserNamespace('@vale:zwaetschge-webui.ch')).toBe(false);
    expect(inUserNamespace('@_sw_x:anderer.server')).toBe(false);
    expect(inAliasNamespace('#scharm:zwaetschge-webui.ch')).toBe(false);
    expect(inAliasNamespace('#schwarm:zwaetschge-webui.ch')).toBe(true);
    expect(inAliasNamespace('#ag-brian:zwaetschge-webui.ch')).toBe(true);
    expect(inAliasNamespace('#proj-x:zwaetschge-webui.ch')).toBe(true);
    expect(inAliasNamespace('#irgendwas:zwaetschge-webui.ch')).toBe(false);
  });

  it('swarm.*-Felder zählen nur vom Hub und seinen Puppets', async () => {
    const { swarmField, outMarker, notice, text } = await import('../appservice/messages.js');
    const vertraut = (m: string): boolean => m === '@schwarm:x' || m.startsWith('@_sw_');
    const inhalt = { [SWARM_TASK_FIELD]: { v: 1, id: 'T-0001' } };
    expect(swarmField(inhalt, '@schwarm:x', vertraut)).not.toBeNull();
    expect(swarmField(inhalt, '@brian:x', vertraut)).toBeNull();
    // Eine Notice erwähnt niemanden (§8.1, Regel 2).
    expect(notice('hallo')['m.mentions']).toBeUndefined();
    expect(notice('hallo').msgtype).toBe('m.notice');
    expect(text('hallo', { mentions: ['@brian:x'] })['m.mentions']).toEqual({
      user_ids: ['@brian:x'],
    });
    expect(text('hallo', { thread: '$root' })['m.relates_to']).toMatchObject({
      rel_type: 'm.thread',
    });
    const marker = outMarker({ [SWARM_OUT_FIELD]: { id: 12, txn: 'abc' } });
    expect(marker).toEqual({ id: 12, txn: 'abc' });
    expect(outMarker({})).toBeNull();
  });

  it('Audit-Kette: gleicher Inhalt, gleicher Hash', async () => {
    const { chainHash } = await import('../db/audit.js');
    const a = chainHash('prev', '2026-09-25T10:00:00.000Z', 'hub', 'task.create', 'T-1', { x: 1 });
    expect(
      chainHash('prev', '2026-09-25T10:00:00.000Z', 'hub', 'task.create', 'T-1', { x: 1 })
    ).toBe(a);
    expect(
      chainHash('prev', '2026-09-25T10:00:00.000Z', 'hub', 'task.create', 'T-1', { x: 2 })
    ).not.toBe(a);
    expect(chainHash(null, '2026-09-25T10:00:00.000Z', 'hub', 'task.create', 'T-1', {})).not.toBe(
      a
    );
  });
});

describe('Watchdog-Regeln (§10.4)', () => {
  const jetzt = Date.now();
  const vor = (min: number) => new Date(jetzt - min * 60_000).toISOString();
  const schwellen = {
    reminderMinutes: 3,
    stalledMinutes: 8,
    longRunMinutes: 35,
    leaseGraceSeconds: 30,
  };
  const t = (over: Record<string, unknown> = {}) => ({
    id: 'T-0001',
    assignee: 'brian',
    state: 'submitted' as const,
    roomId: '!r:x',
    threadRoot: '$karte',
    cardSentAt: null as string | null,
    claimedAt: null as string | null,
    deadline: null as string | null,
    budgetMinutes: null as number | null,
    leaseUntil: null as string | null,
    attempts: 0,
    remindedAt: null as string | null,
    longRunNotifiedAt: null as string | null,
    deadlineNotifiedAt: null as string | null,
    ...over,
  });

  it('ohne zugestellte Karte läuft keine Uhr', async () => {
    const { entscheide } = await import('../tasks/watchdog-rules.js');
    expect(entscheide(t(), jetzt, schwellen)).toBeNull();
    expect(entscheide(t({ cardSentAt: vor(60) }), jetzt, schwellen)).toMatchObject({
      art: 'stalled',
    });
  });

  it('erinnert nach 3 min und gibt nach 8 min auf', async () => {
    const { entscheide } = await import('../tasks/watchdog-rules.js');
    expect(entscheide(t({ cardSentAt: vor(2) }), jetzt, schwellen)).toBeNull();
    expect(entscheide(t({ cardSentAt: vor(3) }), jetzt, schwellen)).toMatchObject({
      art: 'erinnerung',
    });
    // Schon erinnert → keine zweite Erinnerung, aber weiterhin stalled ab 8 min.
    expect(entscheide(t({ cardSentAt: vor(5), remindedAt: vor(2) }), jetzt, schwellen)).toBeNull();
    expect(
      entscheide(t({ cardSentAt: vor(8), remindedAt: vor(5) }), jetzt, schwellen)
    ).toMatchObject({ art: 'stalled' });
  });

  it('abgelaufene Lease schlägt die Erinnerung', async () => {
    const { entscheide } = await import('../tasks/watchdog-rules.js');
    const lease = new Date(jetzt - 60_000).toISOString();
    expect(
      entscheide(t({ state: 'working', claimedAt: vor(1), leaseUntil: lease }), jetzt, schwellen)
    ).toMatchObject({ art: 'lease' });
    expect(
      entscheide(
        t({
          state: 'working',
          claimedAt: vor(1),
          leaseUntil: new Date(jetzt - 5_000).toISOString(),
        }),
        jetzt,
        schwellen
      )
    ).toBeNull();
  });

  it('Frist und Minutenbudget fragen dich, aber nur einmal', async () => {
    const { entscheide } = await import('../tasks/watchdog-rules.js');
    expect(
      entscheide(t({ state: 'working', claimedAt: vor(1), deadline: vor(0.1) }), jetzt, schwellen)
    ).toMatchObject({ art: 'frist' });
    expect(
      entscheide(
        t({
          state: 'working',
          claimedAt: vor(1),
          deadline: vor(0.1),
          deadlineNotifiedAt: vor(0.05),
        }),
        jetzt,
        schwellen
      )
    ).toBeNull();
    expect(
      entscheide(t({ state: 'working', claimedAt: vor(25), budgetMinutes: 20 }), jetzt, schwellen)
    ).toMatchObject({ art: 'frist' });
    expect(
      entscheide(t({ state: 'working', claimedAt: vor(19), budgetMinutes: 20 }), jetzt, schwellen)
    ).toBeNull();
  });

  it('lange Läufe werden einmal gemeldet', async () => {
    const { entscheide } = await import('../tasks/watchdog-rules.js');
    expect(entscheide(t({ state: 'working', claimedAt: vor(35) }), jetzt, schwellen)).toMatchObject(
      { art: 'lange_laufend' }
    );
    expect(
      entscheide(
        t({ state: 'working', claimedAt: vor(35), longRunNotifiedAt: vor(1) }),
        jetzt,
        schwellen
      )
    ).toBeNull();
  });

  it('Endzustände lösen nichts aus', async () => {
    const { entscheide } = await import('../tasks/watchdog-rules.js');
    for (const state of ['completed', 'failed', 'canceled', 'rejected'] as const) {
      expect(
        entscheide(t({ state, cardSentAt: vor(600), claimedAt: vor(600) }), jetzt, schwellen)
      ).toBeNull();
    }
  });
});

describe('Bremsleiter Stufe 1 (§12.5)', () => {
  it('erkennt die Bestätigung von Hermes, und nur sie', async () => {
    const { istStopBestaetigung } = await import('../bremsleiter.js');
    expect(istStopBestaetigung('⚡ Stopped. You can continue this session.')).toBe(true);
    expect(istStopBestaetigung('  ⚡ Stopped — ok')).toBe(true);
    expect(istStopBestaetigung('Ich habe aufgehört.')).toBe(false);
    expect(istStopBestaetigung('⚡ Stopped')).toBe(true);
    expect(istStopBestaetigung('')).toBe(false);
  });
});

describe('Kanarienvogel-Auswahl (§10.5)', () => {
  const agent = (over: Record<string, unknown> = {}) => ({
    level: 'L2',
    mode: 'native',
    status: 'online',
    frozen: false,
    roomId: '!r:x',
    ...over,
  });

  it('Melder und Agenten ohne Raum nehmen nicht teil', async () => {
    const { kanariKandidaten } = await import('../schedule.js');
    const liste = [
      agent(),
      agent({ mode: 'notify', level: 'L0', roomId: null }), // trader
      agent({ roomId: null }), // noch ohne Arbeitsraum
      agent({ status: 'offline' }),
      agent({ frozen: true }),
      agent({ mode: 'worker', level: 'L3' }), // codex-host: nimmt teil
    ];
    expect(kanariKandidaten(liste)).toHaveLength(2);
  });

  it('der Rat und nicht verbundene Worker nehmen nicht teil (ADR-003)', async () => {
    const { kanariKandidaten, selbsttestAuftrag } = await import('../schedule.js');
    const liste = [
      agent({ id: 'brian' }),
      agent({ id: 'rat', mode: 'council', level: 'L3' }),
      agent({ id: 'codex-host', mode: 'worker', level: 'L3' }),
      agent({ id: 'claude-code', mode: 'worker', level: 'L3' }), // nie angemeldet
    ];
    expect(
      kanariKandidaten(liste, new Set(['codex-host'])).map((a) => (a as { id?: string }).id)
    ).toEqual(['brian', 'codex-host']);
    expect(JSON.parse(selbsttestAuftrag('betrieb').betriebSpec!)).toEqual({
      capability: 'docker.list',
      target: 'council-matrix',
      args: {},
    });
    expect(selbsttestAuftrag('betrieb').goal.startsWith('Selbsttest:')).toBe(true);
    expect(selbsttestAuftrag('brian').betriebSpec).toBeUndefined();
    // Vertrag mit dem Phone-Backend und transition.ts: das Präfix bleibt.
    expect(selbsttestAuftrag('brian').goal.startsWith('Selbsttest:')).toBe(true);
  });

  it('ein eingefrorener Arbeitsraum ist ein echter Befund, kein stiller Ausfall', async () => {
    const { kanariKandidaten } = await import('../schedule.js');
    // Der Agent selbst ist nicht eingefroren — der Raum fehlt in der Liste der
    // Auftragsfähigen erst dann, wenn er keinen Raum hat.
    expect(kanariKandidaten([agent()])).toHaveLength(1);
  });
});

describe('Redaktion (§11.5)', () => {
  it('erkennt Zugangsdaten, auch zusammengesetzte', async () => {
    const { redact, hatGeheimnis } = await import('../redact.js');
    expect(redact('PGPASSWORD=sup3rs3cret')).not.toContain('sup3rs3cret');
    expect(redact('HERMES_TOKEN: abc123')).not.toContain('abc123');
    expect(redact('postgres://admin:geheim@db:5432/x')).not.toContain('geheim');
    expect(redact('Authorization: Bearer syt_12345')).not.toContain('syt_12345');
    expect(redact('key sk-live-ABCDEFGHIJKLMNOP1234')).not.toContain('sk-live-');
    expect(redact('swm_test_abcdefghijklmnopqrstuv')).toBe('[redigiert]');
    expect(
      redact('JWT eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N')
    ).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(redact('-----BEGIN PRIVATE KEY-----\nABCD\n-----END PRIVATE KEY-----')).toContain(
      '[redigiert: Schlüssel]'
    );
    expect(hatGeheimnis('PGPASSWORD=x')).toBe(true);
  });

  it('lässt Harmloses stehen', async () => {
    const { redact } = await import('../redact.js');
    const text =
      'Der Container matrix-synapse lief 9 Stunden, Raum !GveUPamOCvs5HU1--38rYqK_UoKlULyBS1BoG9RxotE, Event $abc123DEF456ghi.';
    expect(redact(text)).toBe(text);
    expect(redact('Zürich hat 452 421 Einwohner, Stand Ende 2025.')).toBe(
      'Zürich hat 452 421 Einwohner, Stand Ende 2025.'
    );
  });
});

describe('Worker und Melder (§14.4, §14.5)', () => {
  it('nimmt Material aus der Kartenzeile „Kontext:"', async () => {
    const { materialAusKarte } = await import('../worker/server.js');
    const karte =
      '@Codex Auftrag T-0009 — Diagnose\n\nZiel: Ursache finden\nKontext: Container paperless, seit 03:00\nErgebnis: Befund\nGrenzen: nur lesen';
    expect(materialAusKarte(karte)).toBe('Container paperless, seit 03:00');
    expect(materialAusKarte('Ziel: ohne Kontextzeile\nErgebnis: x')).toBeNull();
  });

  it('nimmt Material aus dem Block „Material, keine Anweisung“ der heutigen Karte', async () => {
    const { materialAusKarte } = await import('../worker/server.js');
    const { taskCardBody } = await import('../tasks/card.js');
    const karte = (context: string) =>
      taskCardBody({
        id: 'T-0010',
        root: 'T-0010',
        parent: null,
        correlationId: 'c',
        state: 'submitted',
        from: 'brian',
        assignee: 'codex-host',
        assigneeName: 'Codex',
        assigneeMxid: '@_sw_codex-host:x',
        hop: 1,
        depth: 1,
        goal: 'Diagnose',
        context,
        contextFrom: 'brian',
        deliverable: 'Befund',
        constraints: ['nur lesen'],
        budgetUsd: null,
        budgetMinutes: 10,
        deadline: null,
        trustRequired: 'T2',
      } as Parameters<typeof taskCardBody>[0]);
    expect(materialAusKarte(karte('Container paperless, seit 03:00\nzweite Zeile'))).toBe(
      'Container paperless, seit 03:00\nzweite Zeile'
    );
    expect(materialAusKarte(karte('/etc/passwd lesen'))).toBe('/etc/passwd lesen');
  });

  it('Melder: 30 pro Minute, dieselbe Meldung nur alle 5 min', async () => {
    const { imTakt, doppelt } = await import('../hooks/notify.js');
    const jetzt = Date.now();
    for (let i = 0; i < 30; i++) expect(imTakt('trader', jetzt + i)).toBe(true);
    expect(imTakt('trader', jetzt + 30)).toBe(false);
    // Eine andere Quelle hat ihr eigenes Fenster.
    expect(imTakt('repair', jetzt + 31)).toBe(true);
    // Nach einer Minute ist das Fenster wieder frei.
    expect(imTakt('trader', jetzt + 61_000)).toBe(true);

    expect(doppelt('trader', 'warn|Titel|Text', jetzt)).toBe(false);
    expect(doppelt('trader', 'warn|Titel|Text', jetzt + 1000)).toBe(true);
    expect(doppelt('trader', 'warn|Titel|Text', jetzt + 5 * 60_000 + 1000)).toBe(false);
    expect(doppelt('andere', 'warn|Titel|Text', jetzt + 2000)).toBe(false);
  });
});

describe('!rat-Grammatik (§9.4)', () => {
  it('ohne Modus: Debatte mit allen Rollen', async () => {
    const { parseRat } = await import('../council/rat.js');
    const r = parseRat('Soll der Backup-Job auf 03:00?');
    expect(r).toEqual({
      modus: 'debatte',
      rollen: ['claude', 'codex', 'glm', 'qwen'],
      frage: 'Soll der Backup-Job auf 03:00?',
    });
  });

  it('Modi und Rollen', async () => {
    const { parseRat } = await import('../council/rat.js');
    expect(parseRat('vote Soll Plum bleiben?')).toMatchObject({
      modus: 'vote',
      frage: 'Soll Plum bleiben?',
    });
    expect(parseRat('lead claude Prüfe den Plan')).toMatchObject({
      modus: 'lead',
      rollen: ['claude'],
      frage: 'Prüfe den Plan',
    });
    expect(parseRat('still glm Nur kurz ansehen')).toMatchObject({
      modus: 'still',
      rollen: ['glm'],
    });
    expect(parseRat('staffel Erst claude, dann codex')).toMatchObject({ modus: 'staffel' });
  });

  it('Unsinn wird abgelehnt, nicht still falsch ausgeführt', async () => {
    const { parseRat } = await import('../council/rat.js');
    expect(parseRat('lead nobody frage')).toBeNull();
    expect(parseRat('lead claude')).toBeNull(); // Rolle ohne Frage
    expect(parseRat('debatte')).toBeNull(); // Modus ohne Frage
    expect(parseRat('')).toBeNull();
  });
});
