-- Watchdog (§10.4) und Warteschlange pro Agent (§12.1 „Parallel pro Agent: 1").
--
-- Der Watchdog muss wissen, was er schon gemeldet hat, sonst erinnert er alle
-- 30 s erneut. Die Zeitstempel stehen beim Auftrag, nicht in einer Tabelle,
-- damit sie mit ihm verschwinden.

ALTER TABLE tasks ADD COLUMN claimed_at timestamptz;
ALTER TABLE tasks ADD COLUMN reminded_at timestamptz;
ALTER TABLE tasks ADD COLUMN long_run_notified_at timestamptz;
ALTER TABLE tasks ADD COLUMN deadline_notified_at timestamptz;

-- Zustellung der Karte = Start der Uhr für „kein 👀 nach 3 min".
ALTER TABLE tasks ADD COLUMN card_sent_at timestamptz;

COMMENT ON COLUMN tasks.claimed_at IS 'Wann der Zuständige 👀 gesetzt hat (§8.3)';
COMMENT ON COLUMN tasks.card_sent_at IS 'Wann die Auftragskarte zugestellt wurde (§10.4)';
COMMENT ON COLUMN tasks.reminded_at IS 'Erste Erinnerung des Watchdogs, zählt nicht als Hop';
COMMENT ON COLUMN tasks.long_run_notified_at IS 'Hinweis „arbeitet seit 35 min" an dich';
COMMENT ON COLUMN tasks.deadline_notified_at IS 'Frage nach Frist/Minutenbudget an dich';

CREATE INDEX tasks_watchdog_idx ON tasks (state, card_sent_at)
  WHERE state IN ('submitted','working','input-required');
