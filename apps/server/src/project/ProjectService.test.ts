import * as Context from "effect/Context";
import * as Queue from "effect/Queue";
import * as Tracer from "effect/Tracer";
import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { CommandId, ProjectId } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Metric from "effect/Metric";
import * as Option from "effect/Option";
import { TestClock } from "effect/testing";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerConfig from "../config.ts";
import {
  orchestrationCommandDuration,
  orchestrationCommandsTotal,
} from "../observability/Metrics.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as LegacyV1ThreadImporter from "../orchestration-v2/legacy/LegacyV1ThreadImporter.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as RuntimeLayer from "../orchestration-v2/runtimeLayer.ts";
import * as ThreadCommandExecutor from "../orchestration-v2/ThreadCommandExecutor.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import * as ProjectEnrichmentService from "./ProjectEnrichmentService.ts";
import * as ProjectFaviconResolver from "./ProjectFaviconResolver.ts";
import * as ProjectService from "./ProjectService.ts";

const layerWorkspacePaths = Layer.succeed(WorkspacePaths.WorkspacePaths, {
  normalizeWorkspaceRoot: (workspaceRoot) => Effect.succeed(workspaceRoot.replace(/\/$/, "")),
  resolveRelativePathWithinRoot: ({ workspaceRoot, relativePath }) =>
    Effect.succeed({ absolutePath: `${workspaceRoot}/${relativePath}`, relativePath }),
});

const layerMetadata = Layer.succeed(ProjectFaviconResolver.ProjectFaviconResolver, {
  invalidate: () => Effect.void,
  resolvePath: (workspaceRoot) => Effect.succeed(`${workspaceRoot}/favicon.svg`),
});

class EnrichmentCompletions extends Context.Service<EnrichmentCompletions, Queue.Queue<void>>()(
  "ozi/project/ProjectService.test/EnrichmentCompletions",
) {}

const layerEnrichmentCompletions = Layer.effectContext(
  Effect.gen(function* () {
    const completions = yield* Queue.unbounded<void>();
    const tracer = Tracer.make({
      span: (options) => {
        const span = new Tracer.NativeSpan(options);
        const end = span.end.bind(span);
        span.end = (...args) => {
          end(...args);
          if (
            span.name === "ProjectEnrichmentService.resolveRepositoryIdentity" ||
            span.name === "ProjectEnrichmentService.resolveFavicon"
          ) {
            Queue.offerUnsafe(completions, undefined);
          }
        };
        return span;
      },
    });
    return Context.make(EnrichmentCompletions, completions).pipe(
      Context.add(Tracer.Tracer, tracer),
    );
  }),
);

const layerTestFor = (
  projectMetadataLayer: Layer.Layer<ProjectFaviconResolver.ProjectFaviconResolver>,
) =>
  RuntimeLayer.layerProjectService.pipe(
    Layer.provideMerge(ProjectEnrichmentService.layer),
    Layer.provideMerge(layerWorkspacePaths),
    Layer.provideMerge(projectMetadataLayer),
    Layer.provideMerge(SqlitePersistence.layerMemory),
    Layer.provideMerge(ServerSettings.layerTest()),
    Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "project-service-test-" })),
    Layer.provide(NodeServices.layer),
    Layer.provideMerge(layerEnrichmentCompletions),
  );

const layerTest = layerTestFor(layerMetadata);

const layerProjectServiceDependencies = Layer.mergeAll(
  RuntimeLayer.layerEventSink,
  ProjectStore.layer,
  ProjectionStore.layer,
  IdAllocator.layer,
  ThreadCommandExecutor.layer,
).pipe(
  Layer.provideMerge(LegacyV1ThreadImporter.layer.pipe(Layer.provide(RuntimeLayer.layerEventSink))),
  Layer.provideMerge(ProjectEnrichmentService.layer),
  Layer.provideMerge(layerWorkspacePaths),
  Layer.provideMerge(layerMetadata),
  Layer.provideMerge(SqlitePersistence.layerMemory),
  Layer.provideMerge(ServerSettings.layerTest()),
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "project-service-race-" })),
  Layer.provide(NodeServices.layer),
);

it.layer(layerTest)("ProjectService", (it) => {
  it.effect("records the outcome and duration of a committed project command", () =>
    Effect.gen(function* () {
      const service = yield* ProjectService.ProjectService;
      const successes = Metric.value(
        Metric.withAttributes(orchestrationCommandsTotal, {
          commandType: "project.create",
          outcome: "success",
        }),
      );
      const durations = Metric.value(
        Metric.withAttributes(orchestrationCommandDuration, { commandType: "project.create" }),
      );
      const successesBefore = (yield* successes).count;
      const durationsBefore = (yield* durations).count;

      yield* service.create({
        commandId: CommandId.make("command:metrics:create"),
        projectId: ProjectId.make("project:metrics"),
        title: "Metrics",
        workspaceRoot: "/work/metrics",
      });

      assert.strictEqual((yield* successes).count - successesBefore, 1);
      assert.strictEqual((yield* durations).count - durationsBefore, 1);
    }),
  );

  it.effect("auto-bootstraps a workspace exactly once", () =>
    Effect.gen(function* () {
      const service = yield* ProjectService.ProjectService;
      yield* TestClock.setTime(Date.parse("2026-06-20T10:00:00.000Z"));
      const input = {
        commandId: CommandId.make("command:bootstrap:first"),
        projectId: ProjectId.make("project:bootstrap"),
        title: "Bootstrap",
        workspaceRoot: "/work/bootstrap/",
      };
      const first = yield* service.bootstrap(input);
      const second = yield* service.bootstrap({
        ...input,
        commandId: CommandId.make("command:bootstrap:second"),
        projectId: ProjectId.make("project:bootstrap:unused"),
      });
      assert.isTrue(first.created);
      assert.isFalse(second.created);
      assert.equal(second.project.id, first.project.id);
    }),
  );

  it.effect("rejects a workspace another active project holds", () =>
    Effect.gen(function* () {
      const service = yield* ProjectService.ProjectService;
      const other = ProjectId.make("project:conflict:mover");
      yield* service.create({
        commandId: CommandId.make("command:conflict:holder"),
        projectId: ProjectId.make("project:conflict:holder"),
        title: "Holder",
        workspaceRoot: "/work/conflict",
      });
      yield* service.create({
        commandId: CommandId.make("command:conflict:mover"),
        projectId: other,
        title: "Mover",
        workspaceRoot: "/work/conflict-mover",
      });
      const move = yield* service
        .update({
          commandId: CommandId.make("command:conflict:move"),
          projectId: other,
          workspaceRoot: "/work/conflict",
        })
        .pipe(Effect.flip);
      assert.equal(move._tag, "ProjectConflictError");
      assert.equal(
        Option.getOrThrow(yield* service.getById(other)).workspaceRoot,
        "/work/conflict-mover",
      );
    }),
  );

  it.effect("replays a workspace conflict after the workspace frees up", () =>
    Effect.gen(function* () {
      const service = yield* ProjectService.ProjectService;
      const holderId = ProjectId.make("project:freed:holder");
      yield* service.create({
        commandId: CommandId.make("command:freed:holder"),
        projectId: holderId,
        title: "Holder",
        workspaceRoot: "/work/freed",
      });
      const claim = {
        commandId: CommandId.make("command:freed:claim"),
        projectId: ProjectId.make("project:freed:claim"),
        title: "Claim",
        workspaceRoot: "/work/freed",
      };
      const first = yield* service.create(claim).pipe(Effect.flip);
      yield* service.delete({
        commandId: CommandId.make("command:freed:delete"),
        projectId: holderId,
      });
      const replayed = yield* service.create(claim).pipe(Effect.flip);
      assert.deepEqual(replayed, first);
      assert.instanceOf(replayed, ProjectService.ProjectConflictError);
      assert.isTrue(
        Option.isNone(yield* service.getById(claim.projectId, { includeDeleted: true })),
      );
    }),
  );

  it.effect("returns the deleted project when a completed delete is retried", () =>
    Effect.gen(function* () {
      const service = yield* ProjectService.ProjectService;
      const sql = yield* SqlClient.SqlClient;
      const projectId = ProjectId.make("project:delete-retry");
      yield* service.create({
        commandId: CommandId.make("command:delete-retry:create"),
        projectId,
        title: "Delete retry",
        workspaceRoot: "/work/delete-retry",
      });
      const input = { commandId: CommandId.make("command:delete-retry:delete"), projectId };
      const deleted = yield* service.delete(input);
      assert.deepEqual(yield* service.delete(input), deleted);
      const events = yield* sql<{ readonly command_id: string }>`
        SELECT command_id FROM orchestration_events
        WHERE stream_id = ${projectId} AND event_type = 'project.deleted'
      `;
      assert.deepEqual(events, [{ command_id: input.commandId }]);
    }),
  );

  it.effect("treats a deleted project as missing for updates and new deletes", () =>
    Effect.gen(function* () {
      const service = yield* ProjectService.ProjectService;
      const sql = yield* SqlClient.SqlClient;
      const projectId = ProjectId.make("project:deleted-target");
      yield* service.create({
        commandId: CommandId.make("command:deleted-target:create"),
        projectId,
        title: "Deleted target",
        workspaceRoot: "/work/deleted-target",
      });
      yield* service.delete({
        commandId: CommandId.make("command:deleted-target:delete"),
        projectId,
      });
      const again = yield* service
        .delete({ commandId: CommandId.make("command:deleted-target:delete-again"), projectId })
        .pipe(Effect.flip);
      assert.instanceOf(again, ProjectService.ProjectNotFoundError);
      const events = yield* sql<{ readonly event_type: string }>`
        SELECT event_type FROM orchestration_events
        WHERE stream_id = ${projectId} ORDER BY sequence ASC
      `;
      assert.deepEqual(
        events.map((event) => event.event_type),
        ["project.created", "project.deleted"],
      );
    }),
  );

  it.effect("rolls back the event and receipt when the row write fails", () =>
    Effect.gen(function* () {
      const service = yield* ProjectService.ProjectService;
      const sql = yield* SqlClient.SqlClient;
      const projectId = ProjectId.make("project:atomic");
      yield* sql`
        CREATE TRIGGER fail_project_row BEFORE INSERT ON projection_projects
        WHEN NEW.project_id = 'project:atomic'
        BEGIN SELECT RAISE(ABORT, 'injected row failure'); END
      `;
      const input = {
        commandId: CommandId.make("command:atomic:create"),
        projectId,
        title: "Atomic",
        workspaceRoot: "/work/atomic",
      };
      const failure = yield* service.create(input).pipe(Effect.flip);
      assert.equal(failure._tag, "ProjectOperationError");
      const leftovers = yield* sql<{ readonly count: number }>`
        SELECT
          (SELECT COUNT(*) FROM orchestration_events WHERE command_id = ${input.commandId}) +
          (SELECT COUNT(*) FROM orchestration_command_receipts WHERE command_id = ${input.commandId}) +
          (SELECT COUNT(*) FROM projection_projects WHERE project_id = ${projectId}) AS count
      `;
      assert.equal(leftovers[0]?.count, 0);
      yield* sql`DROP TRIGGER fail_project_row`;
      assert.equal((yield* service.create(input)).id, projectId);
    }),
  );
});

it.effect("serializes two projects claiming the same workspace root", () =>
  Effect.gen(function* () {
    const eventSink = yield* EventSink.EventSinkV2;
    const firstReachedCommit = yield* Deferred.make<void>();
    const releaseFirst = yield* Deferred.make<void>();
    const gatedSink = EventSink.EventSinkV2.of({
      ...eventSink,
      commitProjectCommand: (input) =>
        input.projectId === "project:race:first"
          ? Deferred.succeed(firstReachedCommit, undefined).pipe(
              Effect.andThen(Deferred.await(releaseFirst)),
              Effect.andThen(eventSink.commitProjectCommand(input)),
            )
          : eventSink.commitProjectCommand(input),
    });
    const service = yield* ProjectService.make.pipe(
      Effect.provideService(EventSink.EventSinkV2, gatedSink),
    );
    const claim = (name: string) =>
      service.create({
        commandId: CommandId.make(`command:race:${name}`),
        projectId: ProjectId.make(`project:race:${name}`),
        title: name,
        workspaceRoot: "/work/race",
      });
    const first = yield* claim("first").pipe(Effect.forkChild({ startImmediately: true }));
    yield* Deferred.await(firstReachedCommit);
    const second = yield* claim("second").pipe(
      Effect.flip,
      Effect.forkChild({ startImmediately: true }),
    );
    yield* Effect.yieldNow;
    assert.isUndefined(second.pollUnsafe());
    yield* Deferred.succeed(releaseFirst, undefined);
    assert.equal((yield* Fiber.join(first)).id, "project:race:first");
    assert.equal((yield* Fiber.join(second))._tag, "ProjectConflictError");
  }).pipe(Effect.provide(layerProjectServiceDependencies)),
);

it.effect("rejects an update that waited on the lock while its project was deleted", () =>
  Effect.gen(function* () {
    const eventSink = yield* EventSink.EventSinkV2;
    const deleteReachedCommit = yield* Deferred.make<void>();
    const releaseDelete = yield* Deferred.make<void>();
    const gatedSink = EventSink.EventSinkV2.of({
      ...eventSink,
      commitProjectCommand: (input) =>
        input.commandType === "project.delete"
          ? Deferred.succeed(deleteReachedCommit, undefined).pipe(
              Effect.andThen(Deferred.await(releaseDelete)),
              Effect.andThen(eventSink.commitProjectCommand(input)),
            )
          : eventSink.commitProjectCommand(input),
    });
    const service = yield* ProjectService.make.pipe(
      Effect.provideService(EventSink.EventSinkV2, gatedSink),
    );
    const sql = yield* SqlClient.SqlClient;
    const projectId = ProjectId.make("project:update-race");
    yield* service.create({
      commandId: CommandId.make("command:update-race:create"),
      projectId,
      title: "Update race",
      workspaceRoot: "/work/update-race",
    });
    const deletion = yield* service
      .delete({ commandId: CommandId.make("command:update-race:delete"), projectId })
      .pipe(Effect.forkChild({ startImmediately: true }));
    yield* Deferred.await(deleteReachedCommit);
    const updateCommandId = CommandId.make("command:update-race:update");
    const update = yield* service
      .update({ commandId: updateCommandId, projectId, title: "Too late" })
      .pipe(Effect.flip, Effect.forkChild({ startImmediately: true }));
    yield* Effect.yieldNow;
    yield* Deferred.succeed(releaseDelete, undefined);
    assert.isNotNull((yield* Fiber.join(deletion)).deletedAt);
    assert.instanceOf(yield* Fiber.join(update), ProjectService.ProjectNotFoundError);
    const receipts = yield* sql<{ readonly status: string }>`
      SELECT status FROM orchestration_command_receipts WHERE command_id = ${updateCommandId}
    `;
    assert.deepEqual(receipts, [{ status: "rejected" }]);
    const events = yield* sql<{ readonly event_type: string }>`
      SELECT event_type FROM orchestration_events
      WHERE stream_id = ${projectId} ORDER BY sequence ASC
    `;
    assert.deepEqual(
      events.map((event) => event.event_type),
      ["project.created", "project.deleted"],
    );
    assert.equal(
      Option.getOrThrow(yield* service.getById(projectId, { includeDeleted: true })).title,
      "Update race",
    );
  }).pipe(Effect.provide(layerProjectServiceDependencies)),
);
