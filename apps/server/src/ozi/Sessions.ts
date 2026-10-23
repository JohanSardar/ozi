import {
  CommandId,
  OZI_MAIN_THREAD_ID,
  OziSessionError,
  OziMainPiError,
  TrimmedNonEmptyString,
  ProviderDriverKind,
  type OziSession,
  type OziSessionCreateInput,
  type OziSessionImportInput,
  type OziSessionExportInput,
  type OziMainSettings,
  type OziMainSettingsInput,
  type OziSessionResult,
  ThreadId,
} from "@t3tools/contracts";
import { piMainAgentDir } from "@t3tools/provider-pi/server";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as ServerConfig from "../config.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as Projections from "../orchestration-v2/ProjectionStore.ts";
import * as ProviderSessions from "../orchestration-v2/ProviderSessionManager.ts";

export class Sessions extends Context.Service<
  Sessions,
  {
    readonly create: (
      input: OziSessionCreateInput,
    ) => Effect.Effect<OziSessionResult, OziSessionError>;
    readonly list: Effect.Effect<ReadonlyArray<OziSession>, OziSessionError>;
    readonly import: (
      input: OziSessionImportInput,
    ) => Effect.Effect<OziSessionResult, OziSessionError>;
    readonly reload: (threadId: ThreadId) => Effect.Effect<OziSessionResult, OziSessionError>;
    readonly settings: (
      input: OziMainSettingsInput,
    ) => Effect.Effect<OziMainSettings, OziSessionError>;
    readonly export: (
      input: OziSessionExportInput,
    ) => Effect.Effect<{ content: string }, OziSessionError>;
    readonly mainPi: (
      input: Readonly<Record<string, unknown>>,
    ) => Effect.Effect<unknown, OziMainPiError>;
  }
>()("ozi/ozi/Sessions") {}

const sessionError = (message: string) => () => new OziSessionError({ message });
const decodeHeader = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ type: Schema.Literal("session") })),
);
const PiSettingsFile = Schema.Record(Schema.String, Schema.Unknown);
const decodePiSettings = Schema.decodeUnknownEffect(Schema.fromJsonString(PiSettingsFile));
const encodePiSettings = Schema.encodeEffect(Schema.fromJsonString(PiSettingsFile, { space: 2 }));
const PiSettingsView = Schema.Struct({
  steeringMode: Schema.optional(Schema.Literals(["one-at-a-time", "all"])),
  followUpMode: Schema.optional(Schema.Literals(["one-at-a-time", "all"])),
  compaction: Schema.optional(Schema.Struct({ enabled: Schema.optional(Schema.Boolean) })),
  retry: Schema.optional(Schema.Struct({ enabled: Schema.optional(Schema.Boolean) })),
});
const decodePiSettingsView = Schema.decodeUnknownEffect(PiSettingsView);
const decodeSessionState = Schema.decodeUnknownEffect(
  Schema.Struct({ sessionFile: Schema.String }),
);
const decodeSessionName = Schema.decodeUnknownEffect(
  Schema.Struct({
    name: TrimmedNonEmptyString,
    threadId: Schema.optional(ThreadId),
  }),
);

export const layer = Layer.effect(
  Sessions,
  Effect.gen(function* () {
    const projections = yield* Projections.ProjectionStoreV2;
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const providers = yield* ProviderSessions.ProviderSessionManagerV2;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const config = yield* ServerConfig.ServerConfig;
    const crypto = yield* Crypto.Crypto;

    const create = Effect.fn("Sessions.create")(
      function* (input: OziSessionCreateInput, nativeId?: string) {
        const main = yield* projections.getThread(OZI_MAIN_THREAD_ID);
        const threadId = ThreadId.make(yield* crypto.randomUUIDv4());
        yield* orchestrator.dispatch({
          type: "thread.create",
          mainFork: true,
          commandId: CommandId.make(yield* crypto.randomUUIDv4()),
          threadId,
          projectId: main.projectId,
          title: input.title ?? "New session",
          modelSelection: main.modelSelection,
          runtimeMode: main.runtimeMode,
          interactionMode: main.interactionMode,
          branch: main.branch,
          worktreePath: main.worktreePath,
          createdBy: "user",
          creationSource: "cli",
          ...(nativeId === undefined
            ? {}
            : {
                importedNativeThread: {
                  ref: {
                    driver: ProviderDriverKind.make("pi"),
                    nativeId,
                    strength: "strong" as const,
                  },
                },
              }),
        });
        return { threadId };
      },
      Effect.mapError(sessionError("Could not create a session.")),
    );

    return Sessions.of({
      create: (input) => create(input),
      list: Effect.gen(function* () {
        const shell = yield* projections.getShellSnapshot();
        return yield* Effect.forEach(
          shell.threads.filter(
            (thread) => thread.id === OZI_MAIN_THREAD_ID || thread.role === "main-fork",
          ),
          (thread) =>
            Effect.gen(function* () {
              return {
                id: thread.id,
                title: thread.title,
                forkedFrom: thread.lineage.parentThreadId,
                updatedAt: thread.updatedAt,
                messageCount: yield* projections.getMessageCount(thread.id),
              };
            }),
        );
      }).pipe(Effect.mapError(sessionError("Could not list sessions."))),
      import: Effect.fn("Sessions.import")(function* (input) {
        yield* decodeHeader(input.content.split("\n", 1)[0]).pipe(
          Effect.mapError(
            sessionError("Invalid Pi session file: first line must have type session."),
          ),
        );
        const directory = path.join(piMainAgentDir(config.providerStatusCacheDir), "sessions");
        const id = yield* crypto
          .randomUUIDv4()
          .pipe(Effect.mapError(sessionError("Could not copy the Pi session file.")));
        const nativeId = path.join(directory, `${id}.jsonl`);
        yield* fs
          .makeDirectory(directory, { recursive: true })
          .pipe(
            Effect.andThen(fs.writeFileString(nativeId, input.content, { flag: "wx" })),
            Effect.mapError(sessionError("Could not copy the Pi session file.")),
          );
        return yield* create(input, nativeId).pipe(
          Effect.onError(() => fs.remove(nativeId).pipe(Effect.ignore)),
        );
      }),
      settings: Effect.fn("Sessions.settings")(
        function* (input) {
          const file = path.join(piMainAgentDir(config.providerStatusCacheDir), "settings.json");
          const current = (yield* fs.exists(file))
            ? yield* decodePiSettings(yield* fs.readFileString(file))
            : {};
          const section = (key: string) => {
            const value = current[key];
            return typeof value === "object" && value !== null ? value : {};
          };
          const next = {
            ...current,
            ...(input.steeringMode === undefined ? {} : { steeringMode: input.steeringMode }),
            ...(input.followUpMode === undefined ? {} : { followUpMode: input.followUpMode }),
            ...(input.autoCompaction === undefined
              ? {}
              : { compaction: { ...section("compaction"), enabled: input.autoCompaction } }),
            ...(input.autoRetry === undefined
              ? {}
              : { retry: { ...section("retry"), enabled: input.autoRetry } }),
          };
          if (Object.values(input).some((value) => value !== undefined)) {
            yield* fs.makeDirectory(path.dirname(file), { recursive: true });
            yield* fs.writeFileString(file, `${yield* encodePiSettings(next)}\n`);
          }
          const view = yield* decodePiSettingsView(next);
          return {
            autoCompaction: view.compaction?.enabled ?? true,
            autoRetry: view.retry?.enabled ?? true,
            steeringMode: view.steeringMode ?? "one-at-a-time",
            followUpMode: view.followUpMode ?? "one-at-a-time",
          };
        },
        Effect.mapError(sessionError("Could not read or write main's Pi settings.")),
      ),
      export: Effect.fn("Sessions.export")(
        function* (input) {
          const threadId = input.threadId ?? OZI_MAIN_THREAD_ID;
          if (input.format === "jsonl") {
            const state = yield* providers.mainPi({ type: "get_state", threadId });
            return {
              content: yield* fs.readFileString((yield* decodeSessionState(state)).sessionFile),
            };
          }
          return yield* Effect.scoped(
            Effect.gen(function* () {
              const outputPath = path.join(yield* fs.makeTempDirectoryScoped(), "session.html");
              yield* providers.mainPi({ type: "export_html", outputPath, threadId });
              return { content: yield* fs.readFileString(outputPath) };
            }),
          );
        },
        (effect) =>
          effect.pipe(
            Effect.mapError(
              (error) =>
                new OziSessionError({
                  message:
                    error._tag === "OziMainPiError"
                      ? error.message
                      : "Could not export the session.",
                }),
            ),
          ),
      ),
      reload: Effect.fn("Sessions.reload")(function* (threadId) {
        const projection = yield* projections
          .getThreadRecords(threadId, ["runs"])
          .pipe(Effect.mapError(sessionError("Unknown session.")));
        if (
          projection.thread.deletedAt !== null ||
          (threadId !== OZI_MAIN_THREAD_ID && projection.thread.role !== "main-fork")
        )
          return yield* new OziSessionError({ message: "Unknown session." });
        if (
          projection.runs.some((run) =>
            ["preparing", "starting", "running", "waiting"].includes(run.status),
          )
        )
          return yield* new OziSessionError({ message: "Session must be idle to reload." });
        yield* providers.reload(threadId);
        return { threadId };
      }),
      mainPi: Effect.fn("Sessions.mainPi")(function* (input) {
        const rename =
          input.type === "set_session_name"
            ? yield* decodeSessionName(input).pipe(
                Effect.mapError(
                  () => new OziMainPiError({ message: "A session name must be nonempty." }),
                ),
              )
            : undefined;
        const result = yield* providers.mainPi(input);
        if (rename !== undefined) {
          yield* Effect.gen(function* () {
            yield* orchestrator.dispatch({
              type: "thread.metadata.update",
              commandId: CommandId.make(yield* crypto.randomUUIDv4()),
              threadId: rename.threadId ?? OZI_MAIN_THREAD_ID,
              title: rename.name,
            });
          }).pipe(
            Effect.mapError(
              () => new OziMainPiError({ message: "Could not update the session title." }),
            ),
          );
        }
        return result;
      }),
    });
  }),
);
