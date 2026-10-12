-- App 2.2 (matrix/SCHNITTSTELLEN-app.md): Vorlesen mit Vocarium und Modelle je Agent.

-- Vorlese-Aufträge aus der App: ein Event `ch.zwaetschge.swarm.vorlesen` von Vale in der Lobby. Der Hub macht
-- Stück für Stück WAV daraus und meldet jedes Stück als `ch.zwaetschge.swarm.vorlesen.teil`.
CREATE TABLE IF NOT EXISTS swarm.vorlesen (
  id         text PRIMARY KEY,                -- die `anfrage` der App (uuid)
  raum_id    text NOT NULL,
  text       text NOT NULL,
  stimme     text,
  zustand    text NOT NULL DEFAULT 'offen' CHECK (zustand IN ('offen', 'laeuft', 'fertig', 'abgebrochen', 'fehler')),
  teile      int,
  erstellt   timestamptz NOT NULL DEFAULT now(),
  fertig_am  timestamptz,
  fehler     text
);
CREATE INDEX IF NOT EXISTS vorlesen_offen ON swarm.vorlesen (erstellt) WHERE zustand IN ('offen', 'laeuft');

-- Vales Modell-Einstellungen je Agent (!modell). Was hier fehlt, kommt aus dem Katalog ops/matrix/modelle.yaml.
CREATE TABLE IF NOT EXISTS swarm.modelle (
  agent          text PRIMARY KEY,
  modell         text,
  fallback       text[],
  aufwand        text,
  geaendert_von  text NOT NULL,
  geaendert_am   timestamptz NOT NULL DEFAULT now(),
  befehl_outbox  bigint,                      -- Brian: die Zeile mit `/model …`, um seine Antwort zuzuordnen
  bestaetigung   text
);
