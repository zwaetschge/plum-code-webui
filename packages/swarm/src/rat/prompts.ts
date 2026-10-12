/**
 * Prompts des Rats (ADR-003 R3), übernommen aus `packages/core/src/orchestrator/prompts.ts`.
 *
 * Ein Unterschied zum alten Rat: Was andere Mitglieder geschrieben haben, ist hier **Material**
 * (`context` der Karte, §11.4), nicht Teil des Auftrags. Der Auftrag (`goal`) enthält nur Vales
 * Frage und die Arbeitsanweisung; fremde Beiträge können so keine Anweisungen einschleusen.
 */

export const ROLLE: Record<string, string> = {
  'claude-code': 'Umsetzung, Refactoring und Code-Review. Du denkst in Diffs und Tests.',
  'codex-host': 'Zweite Meinung und alternative Lösungswege. Du suchst bewusst den anderen Ansatz.',
  brian: 'Recherche, Betriebsanalyse und Langkontext. Du bringst Fakten und Zusammenhänge.',
  plum: 'Projektsicht: Umsetzbarkeit, Aufwand und Risiken in Vales Projekten.',
}
const rolle = (agent: string) => ROLLE[agent] ?? 'Beratung.'

const HAUSREGELN =
  'Antworte auf Deutsch, sachlich und knapp. Kein Vorspann, keine Höflichkeitsfloskeln. Wenn du etwas ' +
  'nicht weisst, sag es in einem Satz statt zu raten. Nur beraten: nichts ändern, nichts ausführen, ' +
  'keine Aufträge weitergeben. Schliesse mit einer Zeile "KONFIDENZ: 0.xx" (0 bis 1).'

export interface Beitrag {
  agent: string
  name: string
  runde: number
  text: string
  konfidenz: number | null
}

export interface RatPrompt {
  /** Der Auftrag an das Mitglied: Vales Frage und die Anweisung. */
  ziel: string
  /** Beiträge anderer Mitglieder als Material, keine Anweisung. */
  material?: string
}

const block = (b: Beitrag) => `### ${b.name} (Konfidenz ${b.konfidenz ?? '?'})\n${b.text}`

/** Runde 1: bewusst ohne Kenntnis der anderen. Sonst ist es kein Rat, sondern ein Echo. */
export function rundeEins(agent: string, frage: string, lauf: string): RatPrompt {
  return {
    ziel:
      `Rat ${lauf}, Runde 1. Du bist ${agent} im Expertenrat. Deine Rolle: ${rolle(agent)} ` +
      `Beantworte die Frage unabhängig; die Antworten der anderen siehst du erst später. ${HAUSREGELN}\n` +
      `FRAGE: ${frage}`,
  }
}

/** Runde 2 der Debatte: jetzt darf gestritten werden. */
export function kritik(agent: string, frage: string, andere: Beitrag[], lauf: string): RatPrompt {
  return {
    ziel:
      `Rat ${lauf}, Runde 2. Du bist ${agent} im Expertenrat. Deine Rolle: ${rolle(agent)} ` +
      'Im Material stehen die unabhängigen Antworten der anderen Mitglieder. Prüfe sie kritisch: zuerst, ' +
      'worin du zustimmst, dann konkret, was du für falsch oder unvollständig hältst, mit Begründung. ' +
      `Änderst du deine Position, sag es ausdrücklich. ${HAUSREGELN}\nURSPRÜNGLICHE FRAGE: ${frage}`,
    material: andere.map(block).join('\n\n'),
  }
}

export function stimme(agent: string, these: string, lauf: string): RatPrompt {
  return {
    ziel:
      `Rat ${lauf}, Abstimmung. Du bist ${agent} im Expertenrat. Deine Rolle: ${rolle(agent)} ` +
      'Stimme über die These ab. Antworte in genau diesem Aufbau: "VOTUM: ja | nein | enthaltung", ' +
      `dann "BEGRÜNDUNG:" mit zwei bis vier Sätzen. ${HAUSREGELN}\nTHESE: ${these}`,
  }
}

/** Lead und Staffel: ein Mitglied prüft das Ergebnis eines anderen. */
export function pruefung(agent: string, frage: string, arbeit: Beitrag, lauf: string, runde: number): RatPrompt {
  return {
    ziel:
      `Rat ${lauf}, Runde ${runde}. Du bist ${agent} im Expertenrat. Deine Rolle: ${rolle(agent)} ` +
      `Im Material steht, was ${arbeit.name} zu dieser Aufgabe geliefert hat. Prüfe ausschliesslich dieses ` +
      'Ergebnis: Was ist falsch, fehlt oder ist riskant? Ist es in Ordnung, sag das kurz und nenne den einen ' +
      `Punkt, den du trotzdem im Auge behalten würdest. ${HAUSREGELN}\nAUFGABE: ${frage}`,
    material: block(arbeit),
  }
}

export function synthese(modus: string, frage: string, alle: Beitrag[], lauf: string): RatPrompt {
  const runden = new Map<number, Beitrag[]>()
  for (const b of alle) runden.set(b.runde, [...(runden.get(b.runde) ?? []), b])
  const material = [...runden.entries()]
    .sort(([a], [b]) => a - b)
    .map(([r, bs]) => `## Runde ${r}\n${bs.map(block).join('\n\n')}`)
    .join('\n\n')
  return {
    ziel:
      `Rat ${lauf}, Synthese. Du bist der Moderator des Expertenrats: Du forschst nicht selbst, du wertest ` +
      `aus. Im Material stehen die Beiträge der Mitglieder (Modus: ${modus}). Nur beraten: nichts ändern, ` +
      'nichts ausführen. Schreib die Synthese in genau diesem Aufbau, ohne Vorspann: "**Konsens**" (was alle ' +
      'oder fast alle tragen, Stichpunkte), "**Abweichung**" (wo sie sich widersprechen und wer was vertritt, ' +
      'sonst "keine"), "**Offen**" (was niemand beantworten konnte, sonst "nichts"), "**Empfehlung**" (deine ' +
      'Entscheidung in zwei bis vier Sätzen; auch bei Patt entscheidest du und nennst, welche Minderheit du ' +
      `überstimmst). Letzte Zeile: "KONSENS: 0.xx" (wie einig der Rat war, 0 bis 1).\nFRAGE: ${frage}`,
    material,
  }
}

function zahl(muster: RegExp, text: string): number | null {
  const m = muster.exec(text)
  if (!m) return null
  const v = Number(m[1]!.replace(',', '.'))
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : null
}

/** Konfidenz aus der Schlusszeile ziehen. Fehlt sie, ist sie unbekannt. */
export const konfidenzAus = (text: string) => zahl(/KONFIDENZ:\s*([01](?:[.,]\d+)?)/i, text)
export const konsensAus = (text: string) => zahl(/KONSENS:\s*([01](?:[.,]\d+)?)/i, text)

export function votumAus(text: string): 'ja' | 'nein' | 'enthaltung' | null {
  const m = /VOTUM:\s*(ja|nein|enthaltung)/i.exec(text)
  return m ? (m[1]!.toLowerCase() as 'ja' | 'nein' | 'enthaltung') : null
}

/** Der Teil „Empfehlung“ der Synthese, sonst der Anfang des Textes. */
export function empfehlungAus(text: string): string {
  const m = /\*\*Empfehlung\*\*\s*([\s\S]*?)(?:\n\s*KONSENS:|$)/i.exec(text)
  return (m?.[1] ?? text).trim().slice(0, 1500)
}
