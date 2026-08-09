-- User state only. Course content lives in content/ as JSON and is never
-- copied in here, so a content edit never needs a migration.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- One row per question answered. An "attempt set" is one sitting of one
-- section's drills; grouping by set_id reconstructs a whole paper.
CREATE TABLE IF NOT EXISTS attempts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  set_id            TEXT    NOT NULL,
  course_id         TEXT    NOT NULL,
  -- The section that was sat: a lesson, or a checkpoint.
  section_id        TEXT    NOT NULL,
  -- The lesson the question examines. Equal to section_id outside checkpoints.
  source_section_id TEXT    NOT NULL,
  question_id       TEXT    NOT NULL,
  question_type     TEXT    NOT NULL,
  difficulty        TEXT    NOT NULL,
  -- The learner's answer, as the JSON of a scoring.Response.
  response          TEXT    NOT NULL,
  score             REAL    NOT NULL,
  max_score         REAL    NOT NULL,
  verdict           TEXT    NOT NULL,
  created_at        TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS attempts_by_set     ON attempts (set_id);
CREATE INDEX IF NOT EXISTS attempts_by_section ON attempts (course_id, section_id, created_at);
CREATE INDEX IF NOT EXISTS attempts_by_source  ON attempts (course_id, source_section_id);

-- Rolled up from attempts so the path view is a single cheap read.
CREATE TABLE IF NOT EXISTS section_progress (
  course_id    TEXT    NOT NULL,
  section_id   TEXT    NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  best_score   REAL,
  best_percent REAL,
  last_percent REAL,
  -- 1 once a checkpoint has been passed; always 0 for lessons.
  passed       INTEGER NOT NULL DEFAULT 0,
  first_seen_at TEXT,
  updated_at   TEXT    NOT NULL,
  PRIMARY KEY (course_id, section_id)
);

-- Reserved for spaced repetition. Written by nothing yet; see the plan's
-- out-of-scope note.
CREATE TABLE IF NOT EXISTS srs_items (
  course_id  TEXT    NOT NULL,
  item_kind  TEXT    NOT NULL CHECK (item_kind IN ('question', 'vocab')),
  item_ref   TEXT    NOT NULL,
  ease       REAL    NOT NULL DEFAULT 2.5,
  interval_days INTEGER NOT NULL DEFAULT 0,
  due_at     TEXT,
  updated_at TEXT    NOT NULL,
  PRIMARY KEY (course_id, item_kind, item_ref)
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
