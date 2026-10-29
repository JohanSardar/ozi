import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE tickets (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK (status IN ('open', 'archived')),
      updated_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX tickets_status_updated_idx ON tickets(status, updated_at, id)`;
});
