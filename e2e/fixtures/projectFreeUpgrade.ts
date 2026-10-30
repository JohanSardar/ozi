import { OrchestrationV2AppThreadJson } from "../../packages/contracts/src/orchestrationV2.ts";
import { v2Projection } from "../../packages/client-runtime/src/state/orchestrationV2TestFixtures.ts";
import * as NodeSqliteClient from "../../packages/shared/src/nodeSqliteClient.ts";
import { runMigrations } from "../../apps/server/src/persistence/Migrations.ts";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";
const root = NodePath.resolve(import.meta.dirname, "../..");
const serverRequire = NodeModule.createRequire(NodePath.join(root, "apps/server/package.json"));
const [Effect, Layer, Schema, SqlClient, NodeServices] = await Promise.all(
  [
    "effect/Effect",
    "effect/Layer",
    "effect/Schema",
    "effect/sql/SqlClient",
    "@effect/platform-node/NodeServices",
  ].map((module) => import(serverRequire.resolve(module))),
);
const encodeThread = Schema.encodeSync(OrchestrationV2AppThreadJson);
export async function createProjectFreeUpgrade(stateHome: string, legacyWorkingDirectory: string) {
  const directory = NodePath.join(stateHome, "userdata");
  const encoded = encodeThread({
    ...v2Projection.thread,
    id: "legacy-g1" as typeof v2Projection.thread.id,
    title: "Legacy chat",
    workingDirectory: null,
  });
  const payload = JSON.stringify({ ...encoded, projectId: "legacy-folder" });
  await Effect.runPromise(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 74 });
      yield* sql`INSERT INTO projection_projects (project_id,title,workspace_root,scripts_json,created_at,updated_at) VALUES ('legacy-folder','Legacy',${legacyWorkingDirectory},'[]',${encoded.createdAt},${encoded.updatedAt})`;
      yield* sql`INSERT INTO orchestration_v2_projection_threads (thread_id,project_id,title,default_provider,provider_instance_id,runtime_mode,interaction_mode,created_at,updated_at,payload_json) VALUES ('legacy-g1','legacy-folder','Legacy chat','codex','codex','full-access','default',${encoded.createdAt},${encoded.updatedAt},${payload})`;
      yield* sql`INSERT INTO orchestration_events (event_id,aggregate_kind,stream_id,stream_version,event_type,occurred_at,actor_kind,payload_json,metadata_json,application_event_version) VALUES ('legacy-g1-created','thread','legacy-g1',1,'thread.created',${encoded.createdAt},'user',${payload},'{}',2)`;
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          NodeSqliteClient.layer({ filename: NodePath.join(directory, "statev2.sqlite") }),
          NodeServices.layer,
        ),
      ),
    ),
  );
}
