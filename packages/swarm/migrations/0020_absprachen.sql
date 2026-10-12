-- Absprachen-Register (matrix/PLAN-weiter.md, Punkt 2): Wer arbeitet an welchen Dateien, mit Ablaufzeit.
-- Ersetzt die Ansprüche von Hand in ADR-003 §6. Sitzungen (Plum, Codex) melden über HTTP mit einem Token
-- des Zwecks `absprache`, Agenten über das MCP. Migrationen der Matrix-Session beginnen bei 0020, damit
-- die Nummern der Hub-Session frei bleiben.

CREATE TABLE IF NOT EXISTS swarm.absprachen (
  id          bigserial PRIMARY KEY,
  wer         text NOT NULL,
  quelle      text NOT NULL CHECK (quelle IN ('sitzung', 'agent')),
  pfade       text[] NOT NULL,
  zweck       text NOT NULL DEFAULT '',
  erstellt    timestamptz NOT NULL DEFAULT now(),
  ablauf      timestamptz NOT NULL,
  freigegeben timestamptz
);

CREATE INDEX IF NOT EXISTS absprachen_offen ON swarm.absprachen (ablauf) WHERE freigegeben IS NULL;

ALTER TABLE swarm.tokens DROP CONSTRAINT IF EXISTS tokens_purpose_check;
ALTER TABLE swarm.tokens ADD CONSTRAINT tokens_purpose_check
  CHECK (purpose IN ('mcp', 'worker', 'notify', 'absprache'));
