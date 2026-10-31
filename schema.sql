-- Interact Club Hub schema. Safe to run repeatedly (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS users (
  id                  SERIAL PRIMARY KEY,
  name                TEXT NOT NULL,
  email               TEXT NOT NULL,
  password_hash       TEXT NOT NULL,
  -- 'volunteer' = the prototype's "keeplist". Co-Presidents promote to member/lead; only 'admin' can change roles.
  role                TEXT NOT NULL DEFAULT 'volunteer'
                      CHECK (role IN ('admin','pres','lead','member','volunteer')),
  sector              TEXT CHECK (sector IS NULL OR sector IN ('Creative','Events','Finance','Community')),
  promotion_requested INTEGER NOT NULL DEFAULT 0 CHECK (promotion_requested IN (0,1)),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_nocase ON users (LOWER(email));

CREATE TABLE IF NOT EXISTS events (
  id               SERIAL PRIMARY KEY,
  title            TEXT NOT NULL,
  sector           TEXT NOT NULL CHECK (sector IN ('Creative','Events','Finance','Community')),
  hours            DOUBLE PRECISION NOT NULL CHECK (hours > 0), -- pre-set by the lead; members never type hours
  capacity         INTEGER NOT NULL CHECK (capacity > 0),
  volunteer_slots  INTEGER NOT NULL DEFAULT 0,
  location         TEXT NOT NULL,
  date_label       TEXT NOT NULL,                        -- free text like the prototype ("Oct 31")
  type             TEXT NOT NULL CHECK (type IN ('in','out')),  -- in-school / out-of-school
  verification     TEXT NOT NULL DEFAULT '[]',           -- JSON array: gps, qr, selfie, link
  shifts           TEXT,                                 -- JSON array of booth names, or NULL
  points           TEXT,                                 -- JSON array of zone names, or NULL
  days             INTEGER,                              -- multi-day events (tree planting = 14)
  waiver_required  INTEGER NOT NULL DEFAULT 0 CHECK (waiver_required IN (0,1)),
  is_setup         INTEGER NOT NULL DEFAULT 0 CHECK (is_setup IN (0,1)),  -- counts toward Operations Master
  is_active        INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0,1)),
  lat              DOUBLE PRECISION,                     -- venue position, used for the 200 m GPS check
  lng              DOUBLE PRECISION,
  created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS hour_logs (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  event_id         INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  hours            DOUBLE PRECISION NOT NULL CHECK (hours > 0), -- snapshot of events.hours at check-in
  day              INTEGER NOT NULL DEFAULT 1,           -- 1 for single-day events
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','approved','rejected')),
  photo_data       TEXT,                                 -- live photo (data URL for now)
  work_link        TEXT,                                 -- for link-verified creative tasks
  overtime_hours   DOUBLE PRECISION,
  overtime_reason  TEXT,
  overtime_proof_url TEXT,
  overtime_status  TEXT CHECK (overtime_status IS NULL OR overtime_status IN ('pending','approved','denied')),
  flagged          INTEGER NOT NULL DEFAULT 0 CHECK (flagged IN (0,1)),
  reviewed_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at      TIMESTAMPTZ,
  gps_lat          DOUBLE PRECISION,                     -- where the member was at check-in
  gps_lng          DOUBLE PRECISION,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, event_id, day)                        -- one log per person per event day
);

ALTER TABLE hour_logs ADD COLUMN IF NOT EXISTS overtime_proof_url TEXT;

CREATE INDEX IF NOT EXISTS idx_hour_logs_user   ON hour_logs(user_id, status);
CREATE INDEX IF NOT EXISTS idx_hour_logs_event  ON hour_logs(event_id, status);
CREATE INDEX IF NOT EXISTS idx_events_sector    ON events(sector);

CREATE TABLE IF NOT EXISTS signups (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  event_id         INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  shift            TEXT,
  is_volunteer     INTEGER NOT NULL DEFAULT 0 CHECK (is_volunteer IN (0,1)),
  waiver_signed_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, event_id)
);
CREATE INDEX IF NOT EXISTS idx_signups_event ON signups(event_id);

CREATE TABLE IF NOT EXISTS log_cheers (
  log_id  INTEGER NOT NULL REFERENCES hour_logs(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
  PRIMARY KEY (log_id, user_id)
);

CREATE TABLE IF NOT EXISTS log_comments (
  id         SERIAL PRIMARY KEY,
  log_id     INTEGER NOT NULL REFERENCES hour_logs(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
  body       TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 300),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_log_comments_log ON log_comments(log_id);

ALTER TABLE users        ENABLE ROW LEVEL SECURITY;
ALTER TABLE events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE hour_logs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE signups      ENABLE ROW LEVEL SECURITY;
ALTER TABLE log_cheers   ENABLE ROW LEVEL SECURITY;
ALTER TABLE log_comments ENABLE ROW LEVEL SECURITY;
