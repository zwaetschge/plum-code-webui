CREATE TABLE IF NOT EXISTS swarm.gedaechtnis_verworfen (task_id TEXT PRIMARY KEY, vergessen_am TIMESTAMPTZ NOT NULL DEFAULT now());
