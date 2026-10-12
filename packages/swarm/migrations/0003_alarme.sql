-- Alarm-Lebenslauf (ADR-003 R4): was der Rat mit seinen Alerts konnte — Fingerabdruck,
-- Verschärfung, Entwarnung, Stummschalten —, jetzt am Hub.
--
-- Eine Meldung an /hooks/notify mit `fingerprint` ist ein Alarm. Solange er offen ist, zählt
-- der Hub Wiederholungen nur mit, statt jedes Mal zu posten. Neu meldet er sich, wenn er
-- schlimmer wird, und im Thread mit ✅, wenn die Quelle `resolved` schickt. Vale schliesst mit
-- ✅ auf der Notice und schaltet mit 🔕 für 24 h stumm (🔔 hebt das auf).

CREATE TABLE alarme (
  id            bigserial PRIMARY KEY,
  quelle        text NOT NULL,
  fingerabdruck text NOT NULL,
  level         text NOT NULL CHECK (level IN ('info','warn','crit')),
  titel         text NOT NULL,
  text          text NOT NULL DEFAULT '',
  zustand       text NOT NULL DEFAULT 'offen' CHECK (zustand IN ('offen','behoben','geschlossen')),
  anzahl        integer NOT NULL DEFAULT 1,
  erstmals      timestamptz NOT NULL DEFAULT now(),
  zuletzt       timestamptz NOT NULL DEFAULT now(),
  beendet_am    timestamptz,
  beendet_von   text,
  -- Die Notice des Alarms; ihre Event-ID steht in outbox.sent_event_id, sobald sie raus ist.
  outbox_id     bigint
);
-- Pro Quelle und Fingerabdruck ist höchstens ein Alarm offen.
CREATE UNIQUE INDEX alarme_offen_idx ON alarme (quelle, fingerabdruck) WHERE zustand = 'offen';
CREATE INDEX alarme_outbox_idx ON alarme (outbox_id) WHERE outbox_id IS NOT NULL;

-- Stumm gilt für den Fingerabdruck, nicht für einen einzelnen Alarm: Kommt er während der
-- Stille wieder, wird er gezählt, aber nicht gemeldet (wie im Rat).
CREATE TABLE alarm_stumm (
  quelle        text NOT NULL,
  fingerabdruck text NOT NULL,
  bis           timestamptz NOT NULL,
  von           text NOT NULL,
  PRIMARY KEY (quelle, fingerabdruck)
);

-- Reaktionen finden ihre Notice über die Event-ID. Ohne Index wäre das pro Reaktion ein
-- voller Scan der Outbox.
CREATE INDEX IF NOT EXISTS outbox_sent_event_idx ON outbox (sent_event_id) WHERE sent_event_id IS NOT NULL;
