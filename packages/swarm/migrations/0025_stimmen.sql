-- Stimmen je Agent beim Vorlesen (App 2.2, `!stimme`). NULL heisst: Standard aus ops/matrix/modelle.yaml.
-- Die Stimme des Hubs selbst steht in der Zeile `hub`.
ALTER TABLE swarm.modelle ADD COLUMN IF NOT EXISTS stimme text;
