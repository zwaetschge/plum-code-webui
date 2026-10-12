-- Routinen (matrix/PLAN-weiter.md, Punkt 10): wiederkehrende Aufträge mit Zeitplan, Budget und eigenem Thread.
CREATE TABLE IF NOT EXISTS swarm.routinen (
  id             bigserial PRIMARY KEY,
  name           text NOT NULL UNIQUE,
  zeitplan       text NOT NULL,
  agent          text NOT NULL,
  ziel           text NOT NULL,
  budget_usd     numeric(10,4),
  budget_minuten integer,
  pausiert       boolean NOT NULL DEFAULT false,
  naechster      timestamptz,
  letzter_task   text,
  letzter_zeit   timestamptz,
  letzter_fehler text,
  wurzel_outbox  bigint,
  erstellt       timestamptz NOT NULL DEFAULT now(),
  erstellt_von   text NOT NULL
);

CREATE INDEX IF NOT EXISTS routinen_faellig ON swarm.routinen (naechster) WHERE NOT pausiert;
