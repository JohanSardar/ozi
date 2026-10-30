import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    UPDATE projection_threads
    SET working_directory = COALESCE(working_directory, (
      SELECT workspace_root FROM projection_projects p
      WHERE p.project_id = projection_threads.project_id
    ))
  `;
  yield* sql`
    UPDATE orchestration_v2_projection_threads
    SET payload_json = json_remove(json_set(payload_json, '$.workingDirectory', COALESCE(
      json_extract(payload_json, '$.workingDirectory'), (
        SELECT workspace_root FROM projection_projects p
        WHERE p.project_id = orchestration_v2_projection_threads.project_id
      )
    )), '$.projectId')
  `;
  for (const table of ["orchestration_events", "orchestration_v2_events"]) {
    yield* sql`
      UPDATE ${sql(table)}
      SET payload_json = json_remove(json_set(payload_json, '$.workingDirectory', COALESCE(
        json_extract(payload_json, '$.workingDirectory'), (
          SELECT workspace_root FROM projection_projects p
          WHERE p.project_id = json_extract(payload_json, '$.projectId')
        )
      )), '$.projectId')
      WHERE json_type(payload_json, '$.projectId') = 'text'
        AND event_type LIKE 'thread.%'
    `;
  }
  yield* sql`DELETE FROM orchestration_events WHERE aggregate_kind = 'project'`;
  yield* sql`DROP INDEX IF EXISTS idx_orchestration_events_application_high_water`;
  yield* sql`
    CREATE INDEX idx_orchestration_events_application_high_water ON orchestration_events(sequence)
    WHERE application_event_version = 2 AND aggregate_kind = 'thread'
  `;
  for (const table of [
    "projection_threads",
    "orchestration_v2_projection_threads",
    "scheduled_tasks",
  ]) {
    const indexes = yield* sql<{ readonly name: string }>`
      SELECT name FROM sqlite_master
      WHERE type = 'index' AND tbl_name = ${table} AND sql LIKE '%project_id%'
    `;
    for (const index of indexes) yield* sql`DROP INDEX ${sql(index.name)}`;
    yield* sql`ALTER TABLE ${sql(table)} DROP COLUMN project_id`;
  }
  yield* sql`ALTER TABLE scheduled_tasks DROP COLUMN workspace_strategy_json`;
  yield* sql`DROP TABLE projection_projects`;
});
