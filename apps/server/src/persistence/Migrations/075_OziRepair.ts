import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE ozi_mistakes (
    id TEXT PRIMARY KEY,
    at TEXT NOT NULL,
    thread TEXT NOT NULL,
    boundary TEXT,
    fingerprint TEXT NOT NULL,
    what TEXT NOT NULL,
    why TEXT NOT NULL,
    harness TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('logged', 'testing', 'failed', 'shipped', 'undone')),
    source_event_id TEXT NOT NULL,
    trigger_event_id TEXT,
    UNIQUE (source_event_id, fingerprint)
  )`;
  yield* sql`CREATE INDEX ozi_mistakes_fingerprint ON ozi_mistakes(fingerprint, at)`;
  yield* sql`CREATE TABLE ozi_replays (
    id TEXT PRIMARY KEY,
    mistake_id TEXT NOT NULL UNIQUE REFERENCES ozi_mistakes(id),
    at TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('pending', 'running', 'passed', 'failed')),
    reason TEXT,
    case_json TEXT,
    evidence_json TEXT
  )`;
  yield* sql`CREATE TABLE ozi_repair_tasks (
    thread_id TEXT PRIMARY KEY,
    command_id TEXT NOT NULL UNIQUE,
    parent_thread_id TEXT NOT NULL
  )`;
});
