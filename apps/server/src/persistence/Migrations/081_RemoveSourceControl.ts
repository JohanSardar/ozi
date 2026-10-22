import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`DROP TABLE IF EXISTS pull_request_files_viewed`;
  yield* sql`DROP TABLE IF EXISTS pull_request_review_guides`;
  yield* sql`DELETE FROM orchestration_events WHERE event_type LIKE 'thread.pull-request%'`;
  yield* sql`UPDATE orchestration_v2_projection_nodes SET payload_json = json_remove(payload_json, '$.linkedPullRequest', '$.branchPullRequest', '$.pullRequests')`;
});
