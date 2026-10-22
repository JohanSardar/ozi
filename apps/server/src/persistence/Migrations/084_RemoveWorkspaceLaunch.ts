import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`DROP TABLE IF EXISTS orchestration_v2_thread_launch_workflows`;
  yield* sql`UPDATE scheduled_tasks SET workspace_strategy_json = '{"type":"root"}' WHERE json_extract(workspace_strategy_json, '$.type') != 'root'`;
});
