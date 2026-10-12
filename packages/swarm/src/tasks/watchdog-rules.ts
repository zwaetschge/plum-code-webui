/**
 * Watchdog-Regeln (§10.4) — rein, damit die Schwellen in den Einheitstests
 * durchgespielt werden können. Der Ausführende (`watchdog.ts`) macht daraus
 * Datenbank und Ausgaben.
 *
 * Ziel ist N1: keine Lücke bleibt länger als 10 min unbemerkt.
 */
import type { TaskState } from '../protocol/index.js'
import { env } from '../env.js'

export interface Schwellen {
  reminderMinutes: number
  stalledMinutes: number
  longRunMinutes: number
  leaseGraceSeconds: number
}

/** Vorgaben aus §10.4 — über die Umgebung änderbar, für Prüfungen klein. */
export const WATCHDOG: Schwellen = {
  /** Kein 👀 nach der Zustellung → Erinnerung im Thread (zählt nicht als Hop). */
  reminderMinutes: env.watchdogReminderMinutes,
  /** Insgesamt ohne 👀 → `failed (stalled)`, ntfy, Agent Card `unresponsive`. */
  stalledMinutes: env.watchdogStalledMinutes,
  /** 👀 ohne ✅/❌ → Hinweis an dich. Hermes bricht nach 1800 s selbst ab. */
  longRunMinutes: env.watchdogLongRunMinutes,
  /** Der Worker meldet sich nicht mehr: Lease 60 s (§10.3). */
  leaseGraceSeconds: env.watchdogLeaseGraceSeconds,
}

export interface WatchdogTask {
  id: string
  assignee: string
  state: TaskState
  roomId: string | null
  threadRoot: string | null
  cardSentAt: string | null
  claimedAt: string | null
  deadline: string | null
  budgetMinutes: number | null
  leaseUntil: string | null
  attempts: number
  remindedAt: string | null
  longRunNotifiedAt: string | null
  deadlineNotifiedAt: string | null
}

export type WatchdogAction =
  | { art: 'stalled'; grund: string }
  | { art: 'lease'; grund: string }
  | { art: 'frist'; grund: string }
  | { art: 'erinnerung'; grund: string }
  | { art: 'lange_laufend'; grund: string }

const OFFEN: TaskState[] = ['submitted', 'working', 'input-required']

function minutenSeit(iso: string | null, jetzt: number): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  return Number.isFinite(t) ? (jetzt - t) / 60_000 : null
}

/**
 * Eine Aktion pro Durchlauf, die schwerste zuerst. `null` = nichts zu tun.
 * Ohne `card_sent_at` läuft keine Uhr: Die Karte ist noch nicht draussen, also
 * wartet der Auftrag entweder in der Warteschlange oder die Zustellung klemmt —
 * beides meldet `/health` über den Outbox-Rückstand, nicht der Watchdog.
 */
export function entscheide(
  task: WatchdogTask,
  jetzt: number,
  schwellen: Schwellen = WATCHDOG,
): WatchdogAction | null {
  if (!OFFEN.includes(task.state)) return null

  const seitKarte = minutenSeit(task.cardSentAt, jetzt)
  const seitClaim = minutenSeit(task.claimedAt, jetzt)

  // 1) Nichts angekommen: erst erinnern, dann aufgeben (§10.4, N1).
  if (task.state === 'submitted' && seitKarte !== null) {
    if (seitKarte >= schwellen.stalledMinutes) {
      return { art: 'stalled', grund: `kein 👀 nach ${Math.round(seitKarte)} min` }
    }
    if (seitKarte >= schwellen.reminderMinutes && !task.remindedAt) {
      return { art: 'erinnerung', grund: `kein 👀 nach ${Math.round(seitKarte)} min` }
    }
  }

  // 2) Worker ohne Lebenszeichen: Lease abgelaufen (§10.3).
  if (task.state === 'working' && task.leaseUntil) {
    const abgelaufen = (jetzt - new Date(task.leaseUntil).getTime()) / 1000
    if (abgelaufen > schwellen.leaseGraceSeconds) {
      return { art: 'lease', grund: `Lease seit ${Math.round(abgelaufen)} s abgelaufen` }
    }
  }

  // 3) Frist oder Minutenbudget überschritten → Frage an dich (§10.4).
  if ((task.state === 'submitted' || task.state === 'working') && !task.deadlineNotifiedAt) {
    if (task.deadline && new Date(task.deadline).getTime() < jetzt) {
      return { art: 'frist', grund: 'Frist überschritten' }
    }
    if (task.budgetMinutes !== null && seitClaim !== null && seitClaim > task.budgetMinutes) {
      return { art: 'frist', grund: `Minutenbudget ${task.budgetMinutes} überschritten (${Math.round(seitClaim)} min)` }
    }
  }

  // 4) Er arbeitet, aber es dauert: Hinweis nach 35 min (§10.4).
  if (task.state === 'working' && seitClaim !== null && seitClaim >= schwellen.longRunMinutes && !task.longRunNotifiedAt) {
    return { art: 'lange_laufend', grund: `arbeitet seit ${Math.round(seitClaim)} min` }
  }

  return null
}
