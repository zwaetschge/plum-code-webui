-- Schwarm-Hub · Schema `swarm` (PLAN-swarm §14.2, ADR-002 §4)
--
-- Läuft als Rolle `schwarm`, die nur dieses Schema besitzt und `search_path = swarm`
-- hat (ops/matrix/db-schwarm.py). Die Tabellen des Rats in `public` fasst der Hub
-- nie an, auch nicht dessen `schema_migrations`.

-- ─── Räume ──────────────────────────────────────────────────────────────────
-- Der Bootstrap legt Räume idempotent über den Alias an (§6). Die Tabelle hält
-- die Zuordnung Alias → Raum-ID; die Raum-Policy steht zusätzlich als State-Event.
CREATE TABLE rooms (
  alias      text PRIMARY KEY,
  room_id    text UNIQUE,
  kind       text NOT NULL CHECK (kind IN
               ('lobby','board','approvals','log','alerts','work','project','mirror')),
  agent      text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ─── Agenten ────────────────────────────────────────────────────────────────
CREATE TABLE agents (
  id              text PRIMARY KEY,
  mxid            text NOT NULL UNIQUE,
  display_name    text,
  level           text NOT NULL CHECK (level IN ('L0','L1','L2','L3')),
  trust           text NOT NULL CHECK (trust IN ('T0','T1','T2')),
  mode            text NOT NULL CHECK (mode IN ('native','worker','gateway','council','notify')),
  room_id         text,
  status          text NOT NULL DEFAULT 'offline'
                    CHECK (status IN ('online','unresponsive','offline')),
  frozen          boolean NOT NULL DEFAULT false,
  parallel        integer NOT NULL DEFAULT 1,
  budget_usd_day  numeric(10,4),
  usd_per_minute  numeric(10,6),
  skills          text[] NOT NULL DEFAULT '{}',
  accepts         text[] NOT NULL DEFAULT '{}',
  card            jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_seen       timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ─── Aufträge: die Wahrheit über jeden Auftrag (§5.5) ───────────────────────
-- Fortlaufende Nummer für die Kennung „T-0142"; `id` bleibt Text, damit sie
-- menschenlesbar und in Links stabil ist.
CREATE SEQUENCE task_no START 1;

CREATE TABLE tasks (
  id               text PRIMARY KEY,
  root             text NOT NULL,
  parent           text,
  correlation_id   uuid NOT NULL DEFAULT gen_random_uuid(),
  state            text NOT NULL DEFAULT 'submitted' CHECK (state IN
                     ('submitted','working','input-required','auth-required',
                      'completed','failed','canceled','rejected')),
  from_agent       text NOT NULL,
  chain            text[] NOT NULL DEFAULT '{}',
  provenance       jsonb NOT NULL DEFAULT '{}'::jsonb,
  assignee         text NOT NULL,
  hop              integer NOT NULL DEFAULT 0,
  depth            integer NOT NULL DEFAULT 0,
  goal             text NOT NULL,
  deliverable      text NOT NULL DEFAULT 'kurze Zusammenfassung',
  constraints      jsonb NOT NULL DEFAULT '[]'::jsonb,
  budget_usd       numeric(10,4),
  budget_minutes   integer,
  deadline         timestamptz,
  trust_required   text NOT NULL DEFAULT 'T1' CHECK (trust_required IN ('T0','T1','T2')),
  priority         text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high')),
  attempts         integer NOT NULL DEFAULT 0,
  lease_until      timestamptz,
  room_id          text,
  thread_root      text,
  board_event      text,
  council_task_id  text,
  council_action_id text,
  plum_session_id  text,
  result           text,
  fail_reason      text,
  cost_usd         numeric(10,4),
  idempotency_key  text UNIQUE,
  prompt_hash      text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tasks_state_lease_idx ON tasks (state, lease_until);
CREATE INDEX tasks_assignee_state_idx ON tasks (assignee, state);
CREATE INDEX tasks_prompt_hash_idx ON tasks (prompt_hash, created_at);
CREATE INDEX tasks_root_idx ON tasks (root);
CREATE INDEX tasks_open_idx ON tasks (updated_at)
  WHERE state IN ('submitted','working','input-required','auth-required');

-- ─── Eingang: erst speichern, dann bestätigen (§10.1) ───────────────────────
CREATE TABLE transactions (
  txn_id      text PRIMARY KEY,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE inbox (
  event_id     text PRIMARY KEY,
  room_id      text NOT NULL,
  sender       text NOT NULL,
  type         text NOT NULL,
  content      jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at  timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  attempts     integer NOT NULL DEFAULT 0,
  error        text
);
CREATE INDEX inbox_pending_idx ON inbox (received_at) WHERE processed_at IS NULL;

-- ─── Ausgang: Zustand und Meldung in derselben Transaktion (§10.2) ──────────
CREATE SEQUENCE outbox_seq START 1;
CREATE TABLE outbox (
  id            bigint PRIMARY KEY DEFAULT nextval('outbox_seq'),
  kind          text NOT NULL CHECK (kind IN ('message','edit','reaction','state','redact')),
  room_id       text NOT NULL,
  as_user       text NOT NULL,
  task_id       text,
  txn_id        text UNIQUE,
  payload       jsonb NOT NULL,
  depends_on    bigint REFERENCES outbox (id) ON DELETE SET NULL,
  not_before    timestamptz NOT NULL DEFAULT now(),
  held          boolean NOT NULL DEFAULT false,
  attempts      integer NOT NULL DEFAULT 0,
  dead          boolean NOT NULL DEFAULT false,
  last_error    text,
  sent_event_id text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  sent_at       timestamptz
);
CREATE INDEX outbox_pending_idx ON outbox (not_before, id)
  WHERE sent_event_id IS NULL AND NOT dead;
CREATE INDEX outbox_depends_idx ON outbox (depends_on) WHERE sent_event_id IS NULL;
ALTER SEQUENCE outbox_seq OWNED BY outbox.id;

-- Welche Matrix-Events zu welchem Auftrag gehören (§10.2).
CREATE TABLE matrix_map (
  event_id text PRIMARY KEY,
  task_id  text NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  role     text NOT NULL CHECK (role IN
             ('karte','board','freigabe','rueckmeldung','erinnerung','abbruch','quittung')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX matrix_map_task_idx ON matrix_map (task_id);

-- ─── Tokens: nur der Hash, kein Cache (§11.3, §10.3) ────────────────────────
CREATE TABLE tokens (
  id          bigserial PRIMARY KEY,
  agent       text NOT NULL,
  purpose     text NOT NULL CHECK (purpose IN ('mcp','worker','notify')),
  hash        text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at  timestamptz
);

-- ─── Audit mit Hash-Kette (§11.8) ───────────────────────────────────────────
CREATE TABLE audit (
  id      bigserial PRIMARY KEY,
  at      timestamptz NOT NULL DEFAULT now(),
  actor   text NOT NULL,
  action  text NOT NULL,
  target  text,
  detail  jsonb NOT NULL DEFAULT '{}'::jsonb,
  prev_hash text,
  hash    text NOT NULL
);
CREATE INDEX audit_at_idx ON audit (at);

-- ─── Kill-Switch und Betriebszustand (§9.7) ─────────────────────────────────
CREATE TABLE flags (
  name   text PRIMARY KEY,
  value  jsonb NOT NULL DEFAULT '{}'::jsonb,
  set_by text NOT NULL,
  set_at timestamptz NOT NULL DEFAULT now()
);

-- ─── Aufrufe an den Rat, die wiederholt werden müssen (§10.6) ───────────────
CREATE TABLE council_queue (
  id         bigserial PRIMARY KEY,
  kind       text NOT NULL,
  payload    jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts   integer NOT NULL DEFAULT 0,
  next_try   timestamptz NOT NULL DEFAULT now(),
  done_at    timestamptz,
  last_error text
);
CREATE INDEX council_queue_pending_idx ON council_queue (next_try) WHERE done_at IS NULL;
