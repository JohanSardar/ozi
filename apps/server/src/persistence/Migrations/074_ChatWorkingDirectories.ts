import * as SqlClient from "effect/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(projection_threads)`;
  if (columns.some((column) => column.name === "worktree_path")) {
    yield* sql`ALTER TABLE projection_threads RENAME COLUMN worktree_path TO working_directory`;
  }
  yield* sql`UPDATE orchestration_v2_projection_threads SET payload_json = replace(payload_json, '"worktreePath":', '"workingDirectory":')`;
  yield* sql`UPDATE orchestration_v2_events SET payload_json = replace(payload_json, '"worktreePath":', '"workingDirectory":')`;
  yield* sql`UPDATE orchestration_events SET payload_json = replace(payload_json, '"worktreePath":', '"workingDirectory":')`;
  if (columns.some((column) => column.name === "branch"))
    yield* sql`ALTER TABLE projection_threads DROP COLUMN branch`;
  yield* sql`ALTER TABLE projection_projects DROP COLUMN default_thread_env_mode`;
  yield* sql`ALTER TABLE projection_projects DROP COLUMN auto_pull`;
  yield* sql`DROP TABLE IF EXISTS orchestration_v2_thread_launch_workflows`;
  yield* sql`DROP TABLE IF EXISTS checkpoint_diff_blobs`;
  yield* sql`DROP TABLE IF EXISTS projection_thread_pull_requests`;
  yield* sql`DROP TABLE IF EXISTS pull_request_files_viewed`;
  yield* sql`DROP TABLE IF EXISTS pull_request_review_guides`;
});
