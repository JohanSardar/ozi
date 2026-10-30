import * as ProjectFaviconResolver from "./ProjectFaviconResolver.ts";
import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { CommandId, ProjectId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Scope from "effect/Scope";

import * as ServerConfig from "../config.ts";
import * as RuntimeLayer from "../orchestration-v2/runtimeLayer.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import * as ProjectEnrichmentService from "./ProjectEnrichmentService.ts";
import * as ProjectService from "./ProjectService.ts";
import * as ManagedProjectFolders from "./ManagedProjectFolders.ts";

const layerEnrichment = ProjectEnrichmentService.layer.pipe(
  Layer.provide(
    Layer.mock(ProjectFaviconResolver.ProjectFaviconResolver)({
      resolvePath: () => Effect.succeed(null),
      invalidate: () => Effect.void,
    }),
  ),
);

interface HarnessOptions {
  readonly projects?: (
    real: ProjectService.ProjectService["Service"],
  ) => ProjectService.ProjectService["Service"];
}

const layer = (baseDir: string, options?: HarnessOptions) =>
  ManagedProjectFolders.layer.pipe(
    Layer.provide(
      options?.projects === undefined
        ? Layer.empty
        : Layer.effect(
            ProjectService.ProjectService,
            ProjectService.ProjectService.pipe(Effect.map(options.projects)),
          ),
    ),
    Layer.provideMerge(RuntimeLayer.layerProjectService),
    Layer.provideMerge(layerEnrichment),
    Layer.provideMerge(WorkspacePaths.layer),
    Layer.provideMerge(SqlitePersistence.layerMemory),
    Layer.provideMerge(ServerSettings.layerTest()),
    Layer.provideMerge(ServerConfig.layerTest(baseDir, baseDir)),
    Layer.provideMerge(NodeServices.layer),
  );

const withScratch = <A, E>(
  body: (input: {
    readonly baseDir: string;
  }) => Effect.Effect<
    A,
    E,
    | ManagedProjectFolders.ManagedProjectFolders
    | ProjectService.ProjectService
    | NodeServices.NodeServices
    | Scope.Scope
  >,
  options?: HarnessOptions,
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const baseDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-managed-folders-" });
    return yield* body({ baseDir }).pipe(Effect.provide(layer(baseDir, options)));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

const requireRoot = Effect.gen(function* () {
  const scratch = yield* ManagedProjectFolders.ManagedProjectFolders;
  return Option.getOrThrow(yield* scratch.scratchRoot);
});

it.effect("creates one Scratch project, even for concurrent first requests", () =>
  withScratch(() =>
    Effect.gen(function* () {
      const scratch = yield* ManagedProjectFolders.ManagedProjectFolders;
      const projects = yield* ProjectService.ProjectService;
      const racers = yield* Effect.all(
        Array.from({ length: 8 }, () => scratch.ensureScratchProject),
        { concurrency: "unbounded" },
      );
      const again = yield* scratch.ensureScratchProject;
      assert.deepEqual(
        new Set(racers.map((result) => result.projectId)),
        new Set([again.projectId]),
      );

      const snapshot = yield* projects.snapshot;
      const root = yield* requireRoot;
      const scratchProjects = snapshot.projects.filter((project) => project.workspaceRoot === root);
      assert.lengthOf(scratchProjects, 1);
      assert.equal(scratchProjects[0]?.title, "No project");
      assert.deepEqual(scratchProjects[0]?.projectIcon, {
        kind: "lucide",
        name: "message-square-dashed",
        color: "gray",
      });
    }),
  ),
);

it.effect("recreates the Scratch folder after it is deleted", () =>
  withScratch(() =>
    Effect.gen(function* () {
      const scratch = yield* ManagedProjectFolders.ManagedProjectFolders;
      const fileSystem = yield* FileSystem.FileSystem;
      const { projectId } = yield* scratch.ensureScratchProject;
      const root = yield* requireRoot;
      yield* fileSystem.remove(root, { recursive: true });

      assert.equal((yield* scratch.ensureScratchProject).projectId, projectId);
      assert.isTrue(yield* fileSystem.exists(root));

      yield* fileSystem.remove(root, { recursive: true });
      const folder = yield* scratch.folderForThread({
        projectId,
        threadId: ThreadId.make("thread-after-delete"),
        text: "Still works",
      });
      assert.isTrue(yield* fileSystem.exists(Option.getOrThrow(folder)));
    }),
  ),
);

it.effect("gives each Scratch thread its own folder, named from its message", () =>
  withScratch(() =>
    Effect.gen(function* () {
      const scratch = yield* ManagedProjectFolders.ManagedProjectFolders;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { projectId } = yield* scratch.ensureScratchProject;
      const root = yield* requireRoot;
      const text = "Convert these PNGs to WebP, please!";
      const first = Option.getOrThrow(
        yield* scratch.folderForThread({
          projectId,
          threadId: ThreadId.make("thread:a:0123456789abcdef"),
          text,
        }),
      );
      const second = Option.getOrThrow(
        yield* scratch.folderForThread({
          projectId,
          threadId: ThreadId.make("thread:b:0123456789abcdef"),
          text,
        }),
      );

      const third = Option.getOrThrow(
        yield* scratch.folderForThread({
          projectId,
          threadId: ThreadId.make("thread:b0123456789abcdef"),
          text,
        }),
      );

      assert.equal(new Set([first, second, third]).size, 3);
      for (const folder of [first, second, third]) {
        assert.equal(path.dirname(folder), root);
        assert.match(path.basename(folder), /^\d{4}-\d{2}-\d{2}-convert-these-pngs-to-webp-/);
        assert.isTrue(yield* fileSystem.exists(folder));
      }

      const pasted = Option.getOrThrow(
        yield* scratch.folderForThread({
          projectId,
          threadId: ThreadId.make("thread-pasted"),
          text: `${"word ".repeat(10_000)}../../etc`,
        }),
      );
      assert.equal(path.dirname(pasted), root);
      assert.isAtMost(path.basename(pasted).length, 80);
    }),
  ),
);

it.effect("leaves threads in other projects alone", () =>
  withScratch(({ baseDir }) =>
    Effect.gen(function* () {
      const scratch = yield* ManagedProjectFolders.ManagedProjectFolders;
      const projects = yield* ProjectService.ProjectService;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { projectId: scratchId } = yield* scratch.ensureScratchProject;
      const other = yield* projects.create({
        commandId: CommandId.make("command:other"),
        projectId: ProjectId.make("project:other"),
        title: "Other",
        workspaceRoot: path.join(baseDir, "other"),
        createWorkspaceRootIfMissing: true,
      });

      const folder = yield* scratch.folderForThread({
        projectId: other.id,
        threadId: ThreadId.make("thread-other"),
        text: "Hello",
      });
      assert.isTrue(Option.isNone(folder));
      assert.deepEqual(yield* fileSystem.readDirectory(yield* requireRoot), []);
      assert.isTrue(yield* scratch.isScratchProject(scratchId));
      assert.isFalse(yield* scratch.isScratchProject(other.id));
    }),
  ),
);
