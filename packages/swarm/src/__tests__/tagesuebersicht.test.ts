import { describe, expect, it } from 'vitest'
import { uebersichtText, type UebersichtDaten } from '../tagesuebersicht.js'

const leer: UebersichtDaten = {
  offen: [], fertigGestern: 0, fehlerGestern: [], kostenGestern: [], kanari: [],
  agentenFehlen: [], abgleich: { luecken: 0, stale: 0 }, deadLetters: 0, eingefroren: false,
}

describe('Tagesübersicht', () => {
  it('sagt „Alles ruhig", wenn nichts ansteht', () => {
    const text = uebersichtText(leer, '2026-09-27')
    expect(text).toContain('☀️ Tagesübersicht 2026-09-27')
    expect(text).toContain('Alles ruhig.')
  })

  it('stellt Rückfragen an dich vor alles andere und trennt Hängendes ab', () => {
    const text = uebersichtText({
      ...leer,
      offen: [
        { id: 'T-0150', state: 'input-required', assignee: 'brian', goal: 'Welche Region?', stillStunden: 13 },
        { id: 'T-0142', state: 'working', assignee: 'brian', goal: 'Release-Notes', stillStunden: 30 },
        { id: 'T-0151', state: 'auth-required', assignee: 'codex-host', goal: 'Diagnose', stillStunden: 1 },
      ],
    }, '2026-09-27')
    expect(text).toContain('wartet auf dich: 1')
    expect(text.indexOf('❓ Rückfragen an dich')).toBeLessThan(text.indexOf('⏳ Hängt'))
    expect(text).toMatch(/T-0150 brian: Welche Region\? \(seit 13 h\)/)
    expect(text).toMatch(/⏳ Hängt[^\n]*\n- T-0142 ⚙️ brian/)
    expect(text).toMatch(/📋 Offen\n- T-0151 🔐 codex-host/)
    expect(text).not.toContain('Alles ruhig.')
  })

  it('nennt Kosten, Fehler, Kanarienvogel, fehlende Agenten und Technik', () => {
    const text = uebersichtText({
      ...leer,
      fertigGestern: 4,
      fehlerGestern: [{ id: 'T-0149', assignee: 'brian', grund: 'stalled — kein 👀' }],
      kostenGestern: [{ assignee: 'brian', usd: 0.4, auftraege: 5 }, { assignee: 'codex-host', usd: 0.02, auftraege: 1 }],
      kanari: [{ assignee: 'brian', state: 'completed', sekunden: 5.7 }, { assignee: 'codex-host', state: 'working', sekunden: null }],
      agentenFehlen: [{ id: 'codex-host', name: 'Codex (Host)', status: 'offline', frozen: false }],
      abgleich: { luecken: 2, stale: 1 }, deadLetters: 1, eingefroren: true,
    }, '2026-09-27')
    expect(text).toContain('gestern 4 fertig, 1 ❌ · Kosten gestern 0.42 USD')
    expect(text).toContain('🛑 Der Schwarm ist eingefroren')
    expect(text).toContain('💰 Kosten gestern: brian 0.40 USD (5), codex-host 0.02 USD (1)')
    expect(text).toContain('🧪 Kanarienvogel: brian ✅ 5.7 s, codex-host läuft noch')
    expect(text).toContain('🔴 Agenten: Codex (Host) offline')
    expect(text).toContain('🧭 Abgleich: 2 Lücke(n), 1 ohne Bewegung · Dead Letters: 1')
  })

  it('kürzt lange Listen und verweist auf !board', () => {
    const offen = Array.from({ length: 13 }, (_, i) => ({
      id: `T-${String(200 + i).padStart(4, '0')}`, state: 'submitted', assignee: 'brian', goal: `Auftrag ${i}`, stillStunden: 1,
    }))
    const text = uebersichtText({ ...leer, offen }, '2026-09-27')
    expect(text).toContain('… und 3 weitere (`!board`)')
  })
})
