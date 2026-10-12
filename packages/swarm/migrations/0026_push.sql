-- Sofort-Benachrichtigungen (App 2.5): die UnifiedPush-Adresse je Not-Aus-Gerät. Der Hub weckt damit die App,
-- wenn etwas auf Vale wartet; was neu ist, holt die App danach selbst über Matrix.
ALTER TABLE swarm.notaus_geraete ADD COLUMN IF NOT EXISTS push_endpoint text;
ALTER TABLE swarm.notaus_geraete ADD COLUMN IF NOT EXISTS push_seit timestamptz;
ALTER TABLE swarm.notaus_geraete ADD COLUMN IF NOT EXISTS push_ok timestamptz;
ALTER TABLE swarm.notaus_geraete ADD COLUMN IF NOT EXISTS push_fehler text;
