-- Ablage für Ergebnisse und Material (§10.7, §14.2): höchstens 5 MB pro Datei.
-- Synapse erlaubt 50 MB, aber der Schwarm soll keine Datenhalde werden.
--
-- Zwei Wege: klein und textlich bleibt in der Datenbank (Prüfung, Audit,
-- Redaktion); die Matrix-Kopie hängt als mxc-Link im Thread, damit auch
-- Menschen in Element etwas sehen.

CREATE TABLE artifacts (
  id         bigserial PRIMARY KEY,
  task_id    text REFERENCES tasks (id) ON DELETE CASCADE,
  name       text NOT NULL,
  mime       text NOT NULL DEFAULT 'text/markdown',
  size       integer NOT NULL CHECK (size >= 0 AND size <= 5242880),
  sha256     text NOT NULL,
  data       bytea NOT NULL,
  mxc        text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX artifacts_task_idx ON artifacts (task_id, name);
CREATE INDEX artifacts_sha_idx ON artifacts (sha256);
