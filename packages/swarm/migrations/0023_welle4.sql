-- Welle 4 aus matrix/PLAN-weiter.md: Gedächtnis (Punkt 9), Abläufe (11), Plum-Sitzungen als Auftraggeber (12).

-- Ergebnisse als durchsuchbares Gedächtnis: Volltext (deutsch) immer, Vektor (bge-m3, 1024) wenn der
-- Einbettungsdienst erreichbar war. pgvector liegt im Schema public (council-db).
-- pgvector ist in council-db installiert, aber nicht „trusted“: In einer Datenbank ohne die Erweiterung (etwa
-- einer Test-DB) entsteht die Tabelle ohne Vektor-Spalte, und das Gedächtnis sucht nur im Volltext.
DO $$
BEGIN
  IF to_regtype('public.vector') IS NOT NULL THEN
    EXECUTE $t$
      CREATE TABLE IF NOT EXISTS swarm.gedaechtnis (
        id         bigserial PRIMARY KEY,
        task_id    text UNIQUE,
        art        text NOT NULL DEFAULT 'auftrag',
        agent      text,
        text       text NOT NULL,
        fts        tsvector GENERATED ALWAYS AS (to_tsvector('german', text)) STORED,
        einbettung public.vector(1024),
        erstellt   timestamptz NOT NULL DEFAULT now()
      )$t$;
    EXECUTE 'CREATE INDEX IF NOT EXISTS gedaechtnis_vektor ON swarm.gedaechtnis USING hnsw (einbettung public.vector_cosine_ops)';
  ELSE
    EXECUTE $t$
      CREATE TABLE IF NOT EXISTS swarm.gedaechtnis (
        id         bigserial PRIMARY KEY,
        task_id    text UNIQUE,
        art        text NOT NULL DEFAULT 'auftrag',
        agent      text,
        text       text NOT NULL,
        fts        tsvector GENERATED ALWAYS AS (to_tsvector('german', text)) STORED,
        erstellt   timestamptz NOT NULL DEFAULT now()
      )$t$;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS gedaechtnis_fts ON swarm.gedaechtnis USING gin (fts);

-- Welche neuen Aufträge schon einen 🔎-Hinweis bekommen haben (einmal je Auftrag).
CREATE TABLE IF NOT EXISTS swarm.gedaechtnis_hinweise (
  task_id text PRIMARY KEY,
  at      timestamptz NOT NULL DEFAULT now()
);

-- Mehrstufige Abläufe mit Toren.
CREATE TABLE IF NOT EXISTS swarm.ablaeufe (
  id            bigserial PRIMARY KEY,
  name          text NOT NULL,
  ziel          text NOT NULL,
  schritt       integer NOT NULL DEFAULT 0,
  zustand       text NOT NULL DEFAULT 'laeuft' CHECK (zustand IN ('laeuft', 'wartet', 'fertig', 'abgebrochen', 'fehler')),
  tasks         text[] NOT NULL DEFAULT '{}',
  tor_outbox    bigint,
  wurzel_outbox bigint,
  erstellt      timestamptz NOT NULL DEFAULT now(),
  beendet       timestamptz
);

-- Aufträge, die eine Plum-Sitzung über das MCP gegeben hat: das Ergebnis geht in diese Sitzung zurück.
CREATE TABLE IF NOT EXISTS swarm.plum_auftraege (
  task_id   text PRIMARY KEY,
  sitzung   text NOT NULL,
  erstellt  timestamptz NOT NULL DEFAULT now(),
  zugestellt timestamptz
);
