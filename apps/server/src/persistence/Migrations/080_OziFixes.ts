import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE ozi_fixes (
    id TEXT PRIMARY KEY REFERENCES ozi_mistakes(id),
    at TEXT NOT NULL,
    commit_sha TEXT NOT NULL,
    predecessor TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('publishing', 'shipped', 'undoing', 'undone', 'failed')),
    before_head TEXT,
    target TEXT NOT NULL,
    snapshot TEXT NOT NULL,
    paths_json TEXT NOT NULL,
    conflict INTEGER NOT NULL DEFAULT 0,
    checkpoint TEXT,
    error TEXT
  )`;
});
