import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE projection_projects DROP COLUMN default_thread_env_mode`;
  yield* sql`ALTER TABLE projection_projects DROP COLUMN auto_pull`;
  yield* sql`ALTER TABLE projection_projects DROP COLUMN favicon_path`;
  yield* sql`ALTER TABLE projection_projects DROP COLUMN project_icon_json`;
  yield* sql`ALTER TABLE projection_projects DROP COLUMN scripts_json`;
});
