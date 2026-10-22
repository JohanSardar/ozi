import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE projection_threads DROP COLUMN snoozed_until`;
  yield* sql`ALTER TABLE projection_threads DROP COLUMN snoozed_at`;
  yield* sql`UPDATE orchestration_events SET event_type = 'thread.metadata-updated' WHERE application_event_version = 2 AND event_type IN ('thread.snoozed', 'thread.unsnoozed')`;
  yield* sql`UPDATE orchestration_events SET payload_json = json_remove(payload_json, '$.snoozedUntil', '$.snoozedAt', '$.lastSnoozeWakeAt', '$.limitRecovery.snooze') WHERE aggregate_kind = 'thread'`;
  yield* sql`UPDATE orchestration_v2_projection_threads SET payload_json = json_remove(payload_json, '$.snoozedUntil', '$.snoozedAt', '$.lastSnoozeWakeAt', '$.limitRecovery.snooze')`;
});
