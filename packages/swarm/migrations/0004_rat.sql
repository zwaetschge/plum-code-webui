-- Rat im Schwarm (ADR-003 R3): `!rat` beruft echte Schwarm-Agenten ein, nach der Zustandsmaschine
-- des alten Rats — Modi, Runden, Synthese durch einen Moderator mit KONSENS, Beschluss ins Protokoll.
--
-- Ein Lauf hängt an einem Auftrag an den Agenten `rat`; dessen Karte in #ag-rat ist der Thread, in
-- den der Hub die Beiträge spiegelt. Jeder Beitrag ist ein gewöhnlicher Auftrag an ein Mitglied.

CREATE TABLE rat_laeufe (
  task_id     text PRIMARY KEY REFERENCES tasks (id) ON DELETE CASCADE,
  frage       text NOT NULL,
  modus       text NOT NULL CHECK (modus IN ('broadcast','debatte','vote','lead','staffel','still')),
  -- Reihenfolge zählt: bei lead und still zuerst die genannte Rolle, bei staffel die Staffel.
  mitglieder  text[] NOT NULL,
  moderator   text,
  -- 0 = wartet auf den Thread in #ag-rat, 1… = Runde, die Synthese läuft als eigene Stufe.
  runde       integer NOT NULL DEFAULT 0,
  zustand     text NOT NULL DEFAULT 'laeuft' CHECK (zustand IN ('laeuft','synthese','fertig','abgebrochen')),
  konsens     numeric(4,3),
  runde_seit  timestamptz NOT NULL DEFAULT now(),
  erstellt    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rat_laeufe_offen_idx ON rat_laeufe (zustand) WHERE zustand IN ('laeuft','synthese');

CREATE TABLE rat_beitraege (
  lauf       text NOT NULL REFERENCES rat_laeufe (task_id) ON DELETE CASCADE,
  runde      integer NOT NULL,          -- 99 = Synthese
  agent      text NOT NULL,
  task_id    text NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  art        text NOT NULL CHECK (art IN ('vorschlag','kritik','pruefung','stimme','synthese')),
  gespiegelt boolean NOT NULL DEFAULT false,
  PRIMARY KEY (lauf, runde, agent)
);
CREATE INDEX rat_beitraege_task_idx ON rat_beitraege (task_id);
