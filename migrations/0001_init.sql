-- 0001_init.sql — full schema.

CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  youtube_url   TEXT,
  twitch_url    TEXT,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','rejected','suspended')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE sessions (
  id           INTEGER PRIMARY KEY,
  token_hash   TEXT NOT NULL UNIQUE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at   TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- Roles and permissions are pure data: grant a new role with INSERTs only.
CREATE TABLE roles (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE permissions (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE role_permissions (
  role_id       INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE user_roles (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id    INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  granted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  granted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, role_id)
);

-- Key/value app settings, e.g. primary_streamer_id.
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE characters (
  id           INTEGER PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  series       TEXT NOT NULL DEFAULT '',
  select_order INTEGER NOT NULL UNIQUE,
  is_dlc       INTEGER NOT NULL DEFAULT 0,
  is_echo      INTEGER NOT NULL DEFAULT 0
);

-- One row per (streamer, character) currently in progress.
-- running_since IS NULL means the timer is not ticking (paused / not selected).
CREATE TABLE streak_progress (
  streamer_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  character_id        INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  wins                INTEGER NOT NULL DEFAULT 0,
  accumulated_seconds INTEGER NOT NULL DEFAULT 0,
  running_since       TEXT,
  paused              INTEGER NOT NULL DEFAULT 0,
  zero_since          TEXT,
  -- bitmask: 1 = 10-win milestone sent, 2 = 25, 4 = 40
  milestones_reached  INTEGER NOT NULL DEFAULT 0,
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (streamer_id, character_id)
);

CREATE TABLE attempts (
  id               INTEGER PRIMARY KEY,
  streamer_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  character_id     INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  wins             INTEGER NOT NULL,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  result           TEXT NOT NULL CHECK (result IN ('failed','completed','reset')),
  ended_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_attempts_sc ON attempts(streamer_id, character_id);

-- Keep-first: UNIQUE violation means the completion already exists.
CREATE TABLE completions (
  id              INTEGER PRIMARY KEY,
  streamer_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  character_id    INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  completed_at    TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  attempts_count  INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (streamer_id, character_id)
);
CREATE INDEX idx_completions_char ON completions(character_id);

CREATE TABLE ironman_runs (
  id                 INTEGER PRIMARY KEY,
  streamer_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status             TEXT NOT NULL CHECK (status IN ('active','failed','completed')),
  started_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ended_at           TEXT,
  accumulated_seconds INTEGER NOT NULL DEFAULT 0,
  running_since      TEXT,
  paused             INTEGER NOT NULL DEFAULT 0,
  zero_since         TEXT,
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_ironman_streamer ON ironman_runs(streamer_id, status);

-- status: pending = not yet drawn, drawn = current roll, won, lost.
CREATE TABLE ironman_entries (
  id           INTEGER PRIMARY KEY,
  run_id       INTEGER NOT NULL REFERENCES ironman_runs(id) ON DELETE CASCADE,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  draw_order   INTEGER,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','drawn','won','lost')),
  imported     INTEGER NOT NULL DEFAULT 0,
  won_at       TEXT,
  UNIQUE (run_id, character_id)
);
CREATE INDEX idx_ironman_entries_run ON ironman_entries(run_id, status);

CREATE TABLE tracker_sessions (
  streamer_id           INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_heartbeat        TEXT,
  active_mode           TEXT NOT NULL DEFAULT 'streak'
                        CHECK (active_mode IN ('streak','ironman')),
  selected_character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL,
  overlay_token         TEXT UNIQUE,
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE vod_submissions (
  id               INTEGER PRIMARY KEY,
  streamer_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  character_id     INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  youtube_url      TEXT NOT NULL,
  video_id         TEXT NOT NULL,
  title            TEXT,
  thumbnail        TEXT,
  start_timestamp  INTEGER,
  completion_date  TEXT,
  note             TEXT,
  submitter_handle TEXT,
  ip_hash          TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','approved','rejected')),
  reviewer_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  review_note      TEXT,
  reviewed_at      TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (streamer_id, character_id, video_id)
);
CREATE INDEX idx_vods_status ON vod_submissions(status, created_at);

CREATE TABLE votes (
  id          INTEGER PRIMARY KEY,
  ip_hash     TEXT NOT NULL,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  utc_day     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (ip_hash, utc_day)
);
CREATE INDEX idx_votes_day ON votes(utc_day, character_id);

CREATE TABLE vote_daily_winners (
  utc_day      TEXT PRIMARY KEY,
  character_id INTEGER NOT NULL REFERENCES characters(id),
  votes        INTEGER NOT NULL
);

CREATE TABLE timeline_events (
  id          INTEGER PRIMARY KEY,
  type        TEXT NOT NULL,
  streamer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL,
  payload     TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_timeline_created ON timeline_events(created_at DESC);

CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY,
  actor_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   INTEGER,
  detail      TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_audit_created ON audit_log(created_at DESC);
