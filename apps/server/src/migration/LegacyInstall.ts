import {
  CommandId,
  EventId,
  OZI_PROVIDER_INSTANCE,
  OrchestrationV2AppThreadJson,
  OrchestrationV2ConversationMessageJson,
  OrchestrationV2ProviderThreadJson,
  ProjectId,
  ProviderInstanceId,
  type OrchestrationV2DomainEvent,
} from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Context from "effect/Context";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import type * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import * as Runtime from "effect/Runtime";
import * as SqlClient from "effect/sql/SqlClient";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as EventStore from "../orchestration-v2/EventStore.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import { runMigrations } from "../persistence/Migrations.ts";
import { parseSession } from "../sessions/ChatSessions.ts";
import { messageEvents } from "../project/AgentSessionImporter.ts";
import { isProcessAlive } from "../serverRuntimeState.ts";

export class MigrationError extends Schema.TaggedError<MigrationError>()("MigrationError", {
  message: Schema.String,
}) {
  override readonly [Runtime.errorReported] = false;
}

interface Input {
  readonly fromHome: string;
  readonly fromDataRoot: string;
  readonly home: string;
  readonly dryRun: boolean;
}

const FileMove = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
  cwd: Schema.optional(Schema.String),
});
type FileMove = typeof FileMove.Type;
const Report = Schema.Struct({
  fromHome: Schema.String,
  fromDataRoot: Schema.String,
  home: Schema.String,
  dataRoot: Schema.String,
  chats: Schema.Number,
  messages: Schema.Number,
  piSessions: Schema.Number,
  schedules: Schema.Number,
  webhooks: Schema.Number,
  secretFiles: Schema.Number,
  files: Schema.Array(FileMove),
});
type Report = typeof Report.Type;
const decodeCompleted = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      version: Schema.Literal(1),
      fromHome: Schema.String,
      fromDataRoot: Schema.String,
      report: Report,
    }),
  ),
);

export class LegacyInstall extends Context.Service<
  LegacyInstall,
  { readonly migrate: (input: Input) => Effect.Effect<Report & { status: string }, MigrationError> }
>()("ozi/migration/LegacyInstall") {}

const json = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
);
const isMigrationError = Schema.is(MigrationError);
const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeThread = Schema.decodeUnknownSync(OrchestrationV2AppThreadJson);
const decodeProvider = Schema.decodeUnknownSync(OrchestrationV2ProviderThreadJson);
const decodeMessage = Schema.decodeUnknownSync(OrchestrationV2ConversationMessageJson);
const webhookTables = [
  "scheduled_tasks",
  "scheduled_task_webhook_deliveries",
  "scheduled_task_webhook_replay_keys",
  "scheduled_task_webhook_pending",
] as const;
type Cell = string | number | null;

const snapshot = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const versions = yield* sql<{ name: string }>`SELECT name FROM effect_sql_migrations`;
  if (!versions.some((row) => row.name === "OziCompletion"))
    return yield* new MigrationError({ message: "Source is not an old Ozi harness install." });
  const threads = (yield* sql<{
    payload_json: string;
  }>`SELECT payload_json FROM orchestration_v2_projection_threads WHERE deleted_at IS NULL ORDER BY created_at, thread_id`)
    .map((row) => json(row.payload_json))
    .filter(
      (thread) =>
        thread.visibility !== "internal" &&
        thread.role !== "checker" &&
        thread.checkFor === undefined,
    );
  const providers = (yield* sql<{
    payload_json: string;
  }>`SELECT payload_json FROM orchestration_v2_projection_provider_threads`).map((row) =>
    json(row.payload_json),
  );
  const messages = (yield* sql<{
    payload_json: string;
  }>`SELECT payload_json FROM orchestration_v2_projection_messages ORDER BY created_at, rowid`).map(
    (row) => json(row.payload_json),
  );
  const tables: Record<string, ReadonlyArray<Record<string, Cell>>> = {};
  for (const table of webhookTables)
    tables[table] = yield* sql.unsafe<Record<string, Cell>>(`SELECT * FROM ${table}`);
  return { threads, providers, messages, tables };
});

export const layer = Layer.effect(
  LegacyInstall,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const fail = (message: string) => Effect.fail(new MigrationError({ message }));
    const migrate = Effect.fn("LegacyInstall.migrate")(
      function* (input: Input) {
        const fromHome = yield* fs.realPath(path.resolve(input.fromHome));
        const fromDataRoot = yield* fs.realPath(path.resolve(input.fromDataRoot));
        const parent = yield* fs.realPath(path.dirname(path.resolve(input.home)));
        const home = path.join(parent, path.basename(path.resolve(input.home)));
        const dataRoot = path.join(home, "harness");
        const contains = (a: string, b: string) => a === b || b.startsWith(`${a}${path.sep}`);
        if (
          contains(fromHome, home) ||
          contains(home, fromHome) ||
          contains(fromDataRoot, home) ||
          contains(home, fromDataRoot)
        )
          return yield* fail(
            "Source and target directories must not overlap. Both builds default to the same home; choose a separate GUI home.",
          );
        const marker = path.join(home, "migration.json");
        if (yield* fs.exists(home)) {
          if (yield* fs.exists(marker)) {
            const saved = decodeCompleted(yield* fs.readFileString(marker));
            if (
              saved.version === 1 &&
              saved.fromHome === fromHome &&
              saved.fromDataRoot === fromDataRoot &&
              saved.report.home === home
            )
              return { ...saved.report, status: "already-migrated" };
          }
          return yield* fail("Target home already exists. Choose a fresh GUI home.");
        }
        const runtime = path.join(fromHome, "userdata/server-runtime.json");
        if (
          (yield* fs.exists(runtime)) &&
          isProcessAlive(Number(json(yield* fs.readFileString(runtime)).pid))
        )
          return yield* fail(
            "Stop the old server and desktop app before migrating or planning the migration.",
          );
        if ((yield* fs.stat(path.join(fromDataRoot, ".git"))).type !== "Directory")
          return yield* fail(
            "Source data root must contain its own .git directory, not a worktree link.",
          );
        const oldAgent = path.join(fromHome, "caches/ozi-main-pi");
        const agent = path.join(home, "agents/ozi");
        const relocate = (value: string) => {
          for (const [from, to] of [
            [oldAgent, agent],
            [fromDataRoot, dataRoot],
            [fromHome, home],
          ] as const)
            if (contains(from, value)) return to + value.slice(from.length);
          return value;
        };
        const files: FileMove[] = [];
        const directories: string[] = [];
        const walk = Effect.fn("LegacyInstall.walk")(function* (
          from: string,
          to: string,
        ): Effect.fn.Return<void, MigrationError | PlatformError.PlatformError> {
          if (Option.isSome(yield* fs.readLink(from).pipe(Effect.option)))
            return yield* fail(
              "Source contains a symbolic link. Replace links with local files before migrating.",
            );
          if ((yield* fs.realPath(from)) !== path.resolve(from))
            return yield* fail("Source paths must not cross symbolic links.");
          const stat = yield* fs.stat(from);
          if (stat.type === "Directory") {
            directories.push(to);
            for (const name of (yield* fs.readDirectory(from)).toSorted())
              yield* walk(path.join(from, name), path.join(to, name));
          } else if (stat.type === "File") files.push({ from, to });
          else return yield* fail("Source contains a special file that cannot be migrated.");
        });
        yield* walk(fromDataRoot, dataRoot);
        for (const relative of [
          "caches",
          "userdata/secrets",
          "userdata/attachments",
          "userdata/themes",
          "userdata/keybindings.json",
          "workspace",
        ]) {
          const from = path.join(fromHome, relative);
          if (yield* fs.exists(from)) yield* walk(from, path.join(home, relative));
        }
        if (yield* fs.exists(oldAgent)) yield* walk(oldAgent, agent);
        const oldInstance = Buffer.from("pi").toString("base64url");
        const newInstance = Buffer.from("ozi").toString("base64url");
        const secretCopies: FileMove[] = [];
        for (const file of files) {
          if (!contains(path.join(fromHome, "userdata/secrets"), file.from)) continue;
          for (const prefix of ["provider-env-", "provider-config-"]) {
            const name = path.basename(file.from);
            if (name.startsWith(`${prefix}${oldInstance}-`))
              secretCopies.push({
                from: file.from,
                to: path.join(
                  home,
                  "userdata/secrets",
                  `${prefix}${newInstance}-${name.slice(prefix.length + oldInstance.length + 1)}`,
                ),
              });
          }
        }
        files.push(...secretCopies);
        const settingsPath = path.join(fromHome, "userdata/settings.json");
        const settings = (yield* fs.exists(settingsPath))
          ? json(yield* fs.readFileString(settingsPath))
          : {};
        const old = yield* Effect.scoped(
          Effect.gen(function* () {
            const directory = yield* fs.makeTempDirectoryScoped({ prefix: "ozi-legacy-snapshot-" });
            const database = path.join(directory, "state.sqlite");
            const source = path.join(fromHome, "userdata/statev2.sqlite");
            for (const suffix of ["", "-wal"]) {
              if (!(yield* fs.exists(source + suffix))) continue;
              yield* fs.copyFile(source + suffix, database + suffix);
              yield* fs.chmod(database + suffix, 0o600);
            }
            return yield* snapshot.pipe(
              Effect.provide(NodeSqliteClient.layer({ filename: database, readonly: true })),
            );
          }),
        );
        old.threads = old.threads.filter(
          (thread) =>
            thread.visibility !== "internal" &&
            (thread.id === "ozi-main" ||
              thread.role === "main-fork" ||
              old.providers.some(
                (provider) =>
                  provider.id === thread.activeProviderThreadId && provider.driver === "pi",
              )),
        );
        const main = old.threads.find((thread) => thread.id === "ozi-main");
        if (main === undefined) return yield* fail("Source has no main chat.");
        const referenced = new Set(
          old.providers.map(
            (provider) => (provider.nativeThreadRef as { nativeId?: string } | null)?.nativeId,
          ),
        );
        const sessionFiles = [
          ...new Set(
            files
              .filter((file) => contains(oldAgent, file.from) && file.from.endsWith(".jsonl"))
              .map((file) => file.from),
          ),
        ];
        for (const [index, file] of sessionFiles.entries()) {
          if (referenced.has(file)) continue;
          const content = yield* fs.readFileString(file);
          if (json(content.split("\n", 1)[0]!).type !== "session") continue;
          const parsed = yield* parseSession(content);
          const texts = parsed.branch.flatMap((entry) =>
            entry.message?.role === "user"
              ? [
                  typeof entry.message.content === "string"
                    ? entry.message.content
                    : entry.message.content
                        .filter((part) => part.type === "text")
                        .map((part) => part.text ?? "")
                        .join("\n"),
                ]
              : [],
          );
          if (
            texts.length === 0 ||
            texts.some((text) => text.startsWith("OZI COMPLETION CHECK round "))
          )
            continue;
          const id = `c5:pi:${index}`;
          const providerId = `c5:pi-provider:${index}`;
          old.threads.push({
            ...main,
            id,
            title: `Pi session ${parsed.entries[0]!.id}`,
            activeProviderThreadId: providerId,
          });
          old.providers.push({
            id: providerId,
            driver: "pi",
            providerInstanceId: "ozi",
            providerSessionId: null,
            appThreadId: id,
            ownerNodeId: null,
            nativeThreadRef: { driver: "pi", nativeId: file, strength: "strong" },
            nativeConversationHeadRef: null,
            status: "not_loaded",
            firstRunOrdinal: null,
            lastRunOrdinal: null,
            handoffIds: [],
            forkedFrom: null,
            createdAt: parsed.entries[0]!.timestamp,
            updatedAt: parsed.entries.at(-1)!.timestamp,
          });
          for (const entry of parsed.branch) {
            if (entry.message?.role !== "user" && entry.message?.role !== "assistant") continue;
            const text =
              typeof entry.message.content === "string"
                ? entry.message.content
                : entry.message.content
                    .filter((part) => part.type === "text")
                    .map((part) => part.text ?? "")
                    .join("\n");
            old.messages.push({
              id: `${id}:${entry.id}`,
              threadId: id,
              role: entry.message.role,
              text,
              attachments: [],
              createdBy: entry.message.role === "user" ? "user" : "agent",
              creationSource: "server",
              createdAt: entry.timestamp,
              updatedAt: entry.timestamp,
            });
          }
        }
        const nativeFiles = new Set<string>();
        const events: OrchestrationV2DomainEvent[] = [];
        const projectIds = new Set<string>();
        const instanceId = ProviderInstanceId.make("ozi");
        for (const [threadIndex, original] of old.threads.entries()) {
          const provider = old.providers.find(
            (item) => item.id === original.activeProviderThreadId,
          );
          const ref = provider?.nativeThreadRef as { nativeId?: string } | null | undefined;
          const sourceNative = provider?.driver === "pi" ? ref?.nativeId : undefined;
          const native = sourceNative === undefined ? undefined : path.resolve(sourceNative);
          if (provider !== undefined && provider.driver !== "pi")
            return yield* fail(
              "A saved chat uses another provider. Export it before migrating this Pi install.",
            );
          if (native !== undefined) {
            if (!contains(fromHome, path.resolve(native)) || !(yield* fs.exists(native)))
              return yield* fail(
                "A Pi session is missing or outside the source home. Copy it into the old home and rebind it before migrating.",
              );
            if (!files.some((file) => file.from === native && file.to === relocate(native)))
              yield* walk(native, relocate(native));
            yield* parseSession(yield* fs.readFileString(native));
            nativeFiles.add(native);
          }
          const thread = decodeThread({
            ...original,
            creationSource: original.creationSource === "cli" ? "server" : original.creationSource,
            providerInstanceId: instanceId,
            modelSelection: { ...(original.modelSelection as object), instanceId },
            branch: null,
            worktreePath: null,
            forkedFrom: null,
            activeProviderThreadId: native === undefined ? null : provider!.id,
            lineage: {
              parentThreadId: null,
              relationshipToParent: null,
              rootThreadId: original.id,
            },
          });
          projectIds.add(thread.projectId);
          events.push({
            id: EventId.make(`c5:thread:${thread.id}`),
            type: "thread.created",
            threadId: thread.id,
            occurredAt: thread.createdAt,
            payload: thread,
          });
          if (native !== undefined) {
            const sessionTarget = path.join(
              home,
              "userdata/pi-sessions",
              `c5-${threadIndex}.jsonl`,
            );
            files.push({
              from: native,
              to: sessionTarget,
              cwd: path.join(home, "workspace", thread.projectId),
            });
            const next = decodeProvider({
              ...provider,
              providerInstanceId: instanceId,
              providerSessionId: null,
              ownerNodeId: null,
              nativeThreadRef: { driver: "pi", nativeId: sessionTarget, strength: "strong" },
              status: "not_loaded",
              pendingBackgroundTasks: [],
              forkedFrom: null,
            });
            events.push({
              id: EventId.make(`c5:provider:${next.id}`),
              type: "provider-thread.updated",
              threadId: thread.id,
              occurredAt: next.updatedAt,
              payload: next,
            });
          }
          const messages = old.messages.filter((message) => message.threadId === thread.id);
          for (const [index, originalMessage] of messages.entries()) {
            const message = decodeMessage({
              ...originalMessage,
              creationSource:
                originalMessage.creationSource === "cli"
                  ? "server"
                  : originalMessage.creationSource,
              runId: null,
              nodeId: null,
              streaming: false,
            });
            if (message.role === "system") continue;
            const imported = messageEvents({
              threadId: thread.id,
              index,
              message: {
                role: message.role,
                text: message.text,
                createdAt: DateTime.formatIso(message.createdAt),
              },
            });
            events.push({ ...imported[0]!, type: "message.updated", payload: message });
            const item = imported[1]!;
            if (
              item.type === "turn-item.updated" &&
              (item.payload.type === "user_message" || item.payload.type === "assistant_message")
            )
              events.push({
                ...item,
                payload: {
                  ...item.payload,
                  messageId: message.id,
                  attachments: message.attachments,
                },
              });
          }
        }
        const tasks = old.tables.scheduled_tasks!;
        if (tasks.some((task) => !old.threads.some((thread) => thread.id === task.thread_id)))
          return yield* fail("A schedule targets a missing chat. Retarget it before migrating.");
        const report: Report = {
          fromHome,
          fromDataRoot,
          home,
          dataRoot,
          chats: old.threads.length,
          messages: events.filter((event) => event.type === "message.updated").length,
          piSessions: nativeFiles.size,
          schedules: tasks.length,
          webhooks: tasks.filter((task) => json(String(task.schedule_json)).type === "webhook")
            .length,
          secretFiles: files.filter((file) =>
            file.from.startsWith(path.join(fromHome, "userdata/secrets") + path.sep),
          ).length,
          files: [...files, { from: settingsPath, to: path.join(home, "userdata/settings.json") }],
        };
        if (input.dryRun) return { ...report, status: "dry-run" };
        return yield* Effect.scoped(
          Effect.gen(function* () {
            if (yield* fs.exists(home))
              return yield* fail(
                "Target home was created by another process. Retry with a fresh home.",
              );
            const stage = yield* Effect.acquireRelease(
              fs.makeTempDirectory({ directory: parent, prefix: ".ozi-migration-" }),
              (directory) =>
                fs.remove(directory, { recursive: true, force: true }).pipe(Effect.ignore),
            );
            yield* fs.chmod(stage, 0o700);
            const staged = (to: string) => stage + to.slice(home.length);
            for (const directory of directories)
              yield* fs.makeDirectory(staged(directory), { recursive: true, mode: 0o700 });
            for (const file of files) {
              const to = staged(file.to);
              yield* fs.makeDirectory(path.dirname(to), { recursive: true, mode: 0o700 });
              yield* fs.copyFile(file.from, to);
              if (file.cwd !== undefined) {
                const content = yield* fs.readFileString(file.from);
                const end = content.indexOf("\n");
                const header = json(end === -1 ? content : content.slice(0, end));
                yield* fs.writeFileString(
                  to,
                  encode({
                    ...header,
                    cwd: file.cwd,
                    ...(typeof header.parentSession === "string"
                      ? { parentSession: relocate(header.parentSession) }
                      : {}),
                  }) + (end === -1 ? "\n" : content.slice(end)),
                );
              }
              yield* fs.chmod(to, ((yield* fs.stat(file.from)).mode & 0o700) | 0o600);
            }
            const providers = settings.providerInstances as Record<string, unknown> | undefined;
            const pi = providers?.pi as
              | { config?: Record<string, unknown>; environment?: unknown }
              | undefined;
            const ozi = {
              ...pi,
              ...OZI_PROVIDER_INSTANCE,
              config: { ...pi?.config, harness: "ozi", dataRoot },
            };
            yield* fs.makeDirectory(path.join(stage, "userdata"), { recursive: true, mode: 0o700 });
            yield* fs.writeFileString(
              path.join(stage, "userdata/settings.json"),
              encode({
                ...settings,
                providerInstances: { ...providers, ozi },
                defaultModelSelection: { ...(main.modelSelection as object), instanceId },
              }),
              { mode: 0o600 },
            );
            const database = NodeSqliteClient.layer({
              filename: path.join(stage, "userdata/statev2.sqlite"),
            });
            for (const id of projectIds)
              yield* fs.makeDirectory(path.join(stage, "workspace", id), {
                recursive: true,
                mode: 0o700,
              });
            yield* Effect.scoped(
              Effect.gen(function* () {
                yield* runMigrations();
                yield* Effect.gen(function* () {
                  const sink = yield* EventSink.EventSinkV2;
                  const now = yield* DateTime.now;
                  const at = DateTime.formatIso(now);
                  for (const id of projectIds) {
                    const projectId = ProjectId.make(id);
                    const commandId = CommandId.make(`c5:project:${id}`);
                    yield* sink.commitProjectCommand({
                      commandId,
                      projectId,
                      commandType: "project.create",
                      acceptedAt: now,
                      event: {
                        eventId: EventId.make(commandId),
                        aggregateKind: "project",
                        aggregateId: projectId,
                        occurredAt: at,
                        commandId,
                        causationEventId: null,
                        correlationId: commandId,
                        metadata: {},
                        type: "project.created",
                        payload: {
                          projectId,
                          title: "Migrated Ozi",
                          workspaceRoot: path.join(home, "workspace", id),
                          defaultModelSelection: null,
                          scripts: [],
                          createdAt: at,
                          updatedAt: at,
                        },
                      },
                    });
                  }
                  yield* sink.write({ events });
                  const sql = yield* SqlClient.SqlClient;
                  for (const table of webhookTables)
                    for (const originalRow of old.tables[table]!) {
                      const row = { ...originalRow };
                      if (table === "scheduled_tasks")
                        row.model_selection_json = encode({
                          ...json(String(row.model_selection_json)),
                          instanceId,
                        });
                      if (row.creation_source === "cli") row.creation_source = "server";
                      if (table === "scheduled_task_webhook_pending") {
                        const task = json(String(row.task_json));
                        row.task_json = encode({
                          ...task,
                          creationSource:
                            task.creationSource === "cli" ? "server" : task.creationSource,
                          modelSelection: { ...(task.modelSelection as object), instanceId },
                        });
                      }
                      yield* sql`INSERT INTO ${sql(table)} ${sql.insert(row)}`;
                    }
                }).pipe(
                  Effect.provide(
                    EventSink.layer.pipe(
                      Layer.provide(Layer.merge(EventStore.layer, ProjectionStore.layer)),
                    ),
                  ),
                );
              }).pipe(Effect.provide(database)),
            );
            yield* fs.chmod(path.join(stage, "userdata/statev2.sqlite"), 0o600);
            yield* fs.writeFileString(
              path.join(stage, "migration.json"),
              encode({ version: 1, fromHome, fromDataRoot, report }),
              { mode: 0o600 },
            );
            yield* fs.rename(stage, home);
            return { ...report, status: "migrated" };
          }),
        );
      },
      Effect.catchCause((cause) => {
        const error = Cause.findErrorOption(cause);
        return Option.isSome(error) && isMigrationError(error.value)
          ? Effect.fail(error.value)
          : fail(
              "Migration failed before publication. Source is unchanged; check source files, schema and target permissions, then retry.",
            );
      }),
    );
    return LegacyInstall.of({ migrate });
  }),
);
