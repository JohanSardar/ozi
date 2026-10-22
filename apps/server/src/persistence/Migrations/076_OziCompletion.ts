import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{
    name: string;
  }>`PRAGMA table_info(orchestration_v2_projection_nodes)`;
  if (!columns.some((column) => column.name === "checkpoint_scope_id")) return;
  yield* sql`DELETE FROM orchestration_v2_effect_outbox WHERE effect_type IN ('checkpoint.capture', 'provider-thread.rollback')`;
  yield* sql`DELETE FROM orchestration_events WHERE application_event_version = 2 AND (event_type LIKE 'checkpoint%' OR event_type = 'thread.auto-settle-set' OR (event_type = 'turn-item.updated' AND json_extract(payload_json, '$.type') = 'checkpoint'))`;
  yield* sql`DELETE FROM orchestration_v2_projection_turn_items WHERE type = 'checkpoint'`;
  yield* sql`UPDATE orchestration_v2_projection_runs SET status = 'completed', completed_at = requested_at, payload_json = json_set(payload_json, '$.status', 'completed', '$.completedAt', requested_at) WHERE status = 'waiting'`;
  yield* sql`DROP TABLE IF EXISTS checkpoint_diff_blobs`;
  yield* sql`DROP TABLE IF EXISTS orchestration_v2_projection_checkpoints`;
  yield* sql`DROP TABLE IF EXISTS orchestration_v2_projection_checkpoint_scopes`;
  yield* sql`ALTER TABLE orchestration_v2_projection_nodes DROP COLUMN checkpoint_scope_id`;
});
