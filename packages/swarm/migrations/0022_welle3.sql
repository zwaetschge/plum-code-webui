-- Welle 3 aus matrix/PLAN-weiter.md: Bewertungen (Punkt 14) und Not-Aus-Geräte (Punkt 18).

-- 👍/👎 von Vale auf Auftragskarten und Rückmeldungen; eine Stimme pro Auftrag und Mensch, die letzte gilt.
CREATE TABLE IF NOT EXISTS swarm.bewertungen (
  task_id text NOT NULL,
  von     text NOT NULL,
  wert    smallint NOT NULL CHECK (wert IN (-1, 1)),
  event_id text,
  at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, von)
);

-- Geräte, die den Not-Aus ohne Matrix auslösen dürfen: öffentlicher Schlüssel (SPKI, P-256) je Gerät.
CREATE TABLE IF NOT EXISTS swarm.notaus_geraete (
  id         text PRIMARY KEY,
  name       text NOT NULL,
  spki       bytea NOT NULL,
  erstellt   timestamptz NOT NULL DEFAULT now(),
  widerrufen timestamptz,
  zuletzt    timestamptz
);

-- Einmal-Nonces gegen Wiederholung; nach 10 min darf die Zeile weg (die Zeitprüfung erlaubt ±60 s).
CREATE TABLE IF NOT EXISTS swarm.notaus_nonces (
  nonce  text PRIMARY KEY,
  geraet text NOT NULL,
  at     timestamptz NOT NULL DEFAULT now()
);
