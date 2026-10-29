import {
  ChatAttachmentId,
  ChatPrintEvent,
  ChatPrintInput,
  ChatSessionError,
  ChatSessionInput,
  ChatSessionResult,
  CommandId,
  EventId,
  MessageId,
  ProviderDriverKind,
  ThreadId,
  ChatAttachment,
  type ModelSelection,
  OrchestrationV2StoredEvent,
} from "@t3tools/contracts";
import { PiSettings } from "@t3tools/provider-pi/settings";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as ServerConfig from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ProviderSessionManager from "../orchestration-v2/ProviderSessionManager.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import { messageEvents } from "../project/AgentSessionImporter.ts";
import { attachmentRelativePath } from "../attachmentStore.ts";

const PiRecord = Schema.Struct({
  type: Schema.String,
  id: Schema.String,
  parentId: Schema.optional(Schema.NullOr(Schema.String)),
  version: Schema.optional(Schema.Number),
  timestamp: Schema.String,
  message: Schema.optional(
    Schema.Struct({
      role: Schema.String,
      content: Schema.Union([
        Schema.String,
        Schema.Array(
          Schema.Struct({
            type: Schema.String,
            text: Schema.optional(Schema.String),
          }),
        ),
      ]),
    }),
  ),
});
const decodePiRecord = Schema.decodeUnknownSync(PiRecord);
const decodePiSettings = Schema.decodeEffect(PiSettings);
const decodeAttachment = Schema.decodeEffect(ChatAttachment);
const isChatSessionError = Schema.is(ChatSessionError);
const encodeStoredEvent = Schema.encodeEffect(Schema.fromJsonString(OrchestrationV2StoredEvent));

const parseSession = (content: string) =>
  Effect.try({
    try: () => {
      const lines = content.trim().split("\n");
      const entries = lines.map((line) => decodePiRecord(JSON.parse(line)));
      const header = entries[0];
      if (
        header?.type !== "session" ||
        header.version !== 3 ||
        !Number.isFinite(Date.parse(header.timestamp))
      )
        throw new Error();
      const byId = new Map<string, typeof header>();
      for (const entry of entries.slice(1)) {
        if (byId.has(entry.id) || (entry.parentId != null && !byId.has(entry.parentId)))
          throw new Error();
        byId.set(entry.id, entry);
      }
      const branch: typeof entries = [];
      let entry = entries.length > 1 ? entries.at(-1) : undefined;
      while (entry !== undefined) {
        branch.unshift(entry);
        entry = entry.parentId == null ? undefined : byId.get(entry.parentId);
      }
      return { lines, entries, branch };
    },
    catch: (cause) => new ChatSessionError({ reason: "invalid_session", cause }),
  });

export class ChatSessions extends Context.Service<
  ChatSessions,
  {
    readonly execute: (
      input: ChatSessionInput,
    ) => Effect.Effect<ChatSessionResult, ChatSessionError>;
    readonly print: (input: ChatPrintInput) => Stream.Stream<ChatPrintEvent, ChatSessionError>;
  }
>()("ozi/sessions/ChatSessions") {}

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagement.ThreadManagementService;
  const providerSessions = yield* ProviderSessionManager.ProviderSessionManagerV2;
  const folders = yield* ManagedProjectFolders.ManagedProjectFolders;
  const projects = yield* ProjectService.ProjectService;
  const sink = yield* EventSink.EventSinkV2;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const settings = yield* ServerSettings.ServerSettingsService;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const crypto = yield* Crypto.Crypto;
  const uuid = () => crypto.randomUUIDv4().pipe(Effect.orDie);
  const commandId = () => uuid().pipe(Effect.map(CommandId.make));
  const load = (id: ThreadId) => threads.getThreadProjection(id);
  const idle = (projection: Effect.Success<ReturnType<typeof load>>) =>
    projection.runs.some((run) => ThreadManagement.isActiveRun(run) || run.status === "queued") ||
    projection.runtimeRequests.some((request) => request.status === "pending")
      ? Effect.fail(new ChatSessionError({ reason: "busy" }))
      : Effect.void;
  const nativeFile = (projection: Effect.Success<ReturnType<typeof load>>) => {
    const provider = projection.providerThreads.find(
      (item) => item.id === projection.thread.activeProviderThreadId,
    );
    if (provider?.driver !== "pi")
      return Effect.fail(
        new ChatSessionError({
          reason: provider === undefined ? "missing_history" : "pi_required",
        }),
      );
    const file = provider.nativeThreadRef?.nativeId;
    return file == null
      ? Effect.fail(new ChatSessionError({ reason: "missing_history" }))
      : Effect.succeed(file);
  };
  const create = Effect.fn("ChatSessions.create")(function* (input: {
    threadId?: ThreadId | undefined;
    title?: string | undefined;
    modelSelection?: ModelSelection | undefined;
    content?: string | undefined;
    fork?: boolean;
  }) {
    const source = input.threadId === undefined ? undefined : yield* load(input.threadId);
    const projectId = source?.thread.projectId ?? (yield* folders.ensureScratchProject).projectId;
    const project = yield* projects.getById(projectId);
    const selection =
      input.modelSelection ??
      source?.thread.modelSelection ??
      (project._tag === "Some" ? project.value.defaultModelSelection : null) ??
      (yield* settings.getSettings).defaultModelSelection;
    if (selection == null) return yield* new ChatSessionError({ reason: "model_required" });
    const provider = (yield* settings.getSettings).providerInstances[selection.instanceId];
    const threadId = ThreadId.make(yield* uuid());
    let sessionFile: string | undefined;
    let imported: Effect.Success<ReturnType<typeof parseSession>> | undefined;
    if (input.content !== undefined) {
      if (provider?.driver !== "pi") return yield* new ChatSessionError({ reason: "pi_required" });
      imported = yield* parseSession(input.content);
      const directory = path.join(config.providerStatusCacheDir, "pi-sessions");
      yield* fs.makeDirectory(directory, { recursive: true });
      sessionFile = path.join(directory, `${threadId}.jsonl`);
      yield* fs.writeFileString(sessionFile, input.content, { mode: 0o600 });
    }
    yield* threads.dispatch({
      type: "thread.create",
      commandId: yield* commandId(),
      threadId,
      projectId,
      title:
        input.title?.trim() || (input.content === undefined ? "New chat" : "Imported Pi session"),
      modelSelection: selection,
      runtimeMode: source?.thread.runtimeMode ?? "full-access",
      interactionMode: source?.thread.interactionMode ?? "default",
      branch: null,
      worktreePath: null,
      createdBy: "user",
      creationSource: "server",
      ...(sessionFile === undefined
        ? {}
        : {
            importedNativeThread: {
              ref: {
                driver: ProviderDriverKind.make("pi"),
                nativeId: sessionFile,
                strength: "strong" as const,
              },
            },
          }),
    });
    if (input.fork && source !== undefined) {
      const thread = (yield* load(threadId)).thread;
      yield* sink.write({
        events: [
          {
            id: EventId.make(yield* uuid()),
            type: "thread.metadata-updated",
            threadId,
            occurredAt: thread.updatedAt,
            payload: {
              ...thread,
              lineage: {
                parentThreadId: source.thread.id,
                relationshipToParent: "fork",
                rootThreadId: source.thread.lineage.rootThreadId,
              },
            },
          },
        ],
      });
    }
    if (imported !== undefined) {
      const now = DateTime.formatIso(yield* DateTime.now);
      const messages = imported.branch.flatMap((entry) => {
        const message = entry.message;
        if (entry.type !== "message" || (message?.role !== "user" && message?.role !== "assistant"))
          return [];
        const text =
          typeof message.content === "string"
            ? message.content
            : message.content
                .filter((part) => part.type === "text")
                .map((part) => part.text ?? "")
                .join("\n");
        return [
          {
            role: message.role,
            text,
            createdAt: Number.isFinite(Date.parse(entry.timestamp)) ? entry.timestamp : now,
          } as const,
        ];
      });
      if (messages.length > 0)
        yield* sink.write({
          events: messages.flatMap((message, index) => messageEvents({ threadId, index, message })),
        });
    }
    return { threadId };
  });

  const execute = Effect.fn("ChatSessions.execute")(
    function* (input: ChatSessionInput): Effect.fn.Return<ChatSessionResult, unknown> {
      if (input.action === "list") {
        const sessions = yield* threads.listProjectThreads({ includeSubagents: false });
        const archived = (yield* threads.getShellSnapshot({ location: "archive" })).threads.filter(
          (thread) => thread.lineage.relationshipToParent !== "subagent",
        );
        return {
          sessions: [...sessions, ...archived].map((thread) => ({
            threadId: thread.id,
            title: thread.title,
            parentThreadId: thread.lineage.parentThreadId,
            updatedAt: DateTime.formatIso(thread.updatedAt),
            archived: thread.archivedAt !== null,
          })),
        };
      }
      if (input.action === "new") return yield* create(input);
      if (input.action === "import") return yield* create(input);
      const projection = yield* load(input.threadId);
      if (input.action === "inspect")
        return {
          threadId: input.threadId,
          messages: projection.messages
            .filter((message) => message.role === "user")
            .map(({ id, text }) => ({ id, text })),
        };
      if (input.action === "resume") {
        if (projection.thread.archivedAt !== null)
          yield* threads.dispatch({
            type: "thread.unarchive",
            commandId: yield* commandId(),
            threadId: input.threadId,
          });
        return { threadId: input.threadId };
      }
      yield* idle(projection);
      if (input.action === "reload") {
        const provider = projection.providerThreads.find(
          (item) => item.id === projection.thread.activeProviderThreadId,
        );
        if (provider?.providerSessionId != null)
          yield* providerSessions.detach({
            providerSessionId: provider.providerSessionId,
            threadId: input.threadId,
          });
        return { threadId: input.threadId };
      }
      if (input.action === "clone" || input.action === "fork") {
        const selected =
          input.action === "fork"
            ? projection.messages.findIndex(
                (message) => message.id === input.messageId && message.role === "user",
              )
            : -1;
        if (input.action === "fork" && selected < 0)
          return yield* new ChatSessionError({ reason: "invalid_session" });
        const before =
          input.action === "fork" ? projection.messages.slice(0, selected) : projection.messages;
        const previous = before.findLast((message) => message.runId != null);
        const editorText =
          input.action === "fork" ? projection.messages[selected]!.text : undefined;
        const title = `${projection.thread.title} ${input.action === "clone" ? "copy" : "fork"}`;
        if (before.length === 0)
          return {
            ...(yield* create({ threadId: input.threadId, title, fork: true })),
            ...(editorText === undefined ? {} : { editorText }),
          };
        if (previous?.runId == null) {
          const file = yield* nativeFile(projection);
          let content = yield* fs.readFileString(file);
          if (input.action === "fork") {
            const parsed = yield* parseSession(content);
            const users = parsed.branch.filter(
              (entry) => entry.type === "message" && entry.message?.role === "user",
            );
            const index = projection.messages
              .slice(0, selected)
              .filter((message) => message.role === "user").length;
            const entry = users[index];
            const end = parsed.branch.findIndex((item) => item.id === entry?.id);
            if (end < 0) return yield* new ChatSessionError({ reason: "invalid_session" });
            const keep = new Set(parsed.branch.slice(0, end).map((item) => item.id));
            content =
              parsed.lines
                .filter((_, index) => index === 0 || keep.has(parsed.entries[index]!.id))
                .join("\n") + "\n";
          }
          return {
            ...(yield* create({ threadId: input.threadId, content, title, fork: true })),
            ...(editorText === undefined ? {} : { editorText }),
          };
        }
        const targetThreadId = ThreadId.make(yield* uuid());
        yield* threads.dispatch({
          type: "thread.fork",
          commandId: yield* commandId(),
          sourceThreadId: input.threadId,
          targetThreadId,
          sourcePoint:
            input.action === "clone"
              ? { type: "latest_stable" }
              : { type: "run", runId: previous.runId },
          title,
          createdBy: "user",
          creationSource: "server",
        });
        return { threadId: targetThreadId, ...(editorText === undefined ? {} : { editorText }) };
      }
      if (input.action !== "export")
        return yield* new ChatSessionError({ reason: "operation_failed" });
      const file = yield* nativeFile(projection);
      if (input.format === "jsonl")
        return { content: yield* fs.readFileString(file), filename: `${input.threadId}.jsonl` };
      const provider = (yield* settings.getSettings).providerInstances[
        projection.thread.providerInstanceId
      ];
      const pi = yield* decodePiSettings(provider?.config ?? {});
      return yield* Effect.scoped(
        Effect.gen(function* () {
          const directory = yield* fs.makeTempDirectoryScoped({ prefix: "ozi-export-" });
          const output = path.join(directory, "session.html");
          const process = yield* spawner.spawn(
            ChildProcess.make(pi.binaryPath || "pi", ["--export", file, output], {
              stdin: "ignore",
              stdout: "ignore",
              stderr: "ignore",
            }),
          );
          const code = yield* process.exitCode;
          if (code !== 0) return yield* new ChatSessionError({ reason: "operation_failed" });
          return { content: yield* fs.readFileString(output), filename: `${input.threadId}.html` };
        }),
      ).pipe(Effect.timeout("30 seconds"));
    },
    Effect.mapError((cause) =>
      isChatSessionError(cause)
        ? cause
        : new ChatSessionError({ reason: "operation_failed", cause }),
    ),
  );

  const print = (input: ChatPrintInput) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const projection = yield* load(input.threadId);
        const attachments: ChatAttachment[] = [];
        for (const file of input.files) {
          const bytes = Buffer.from(file.base64, "base64");
          const attachment = yield* decodeAttachment({
            type: file.mimeType.startsWith("image/") ? "image" : "file",
            id: ChatAttachmentId.make(yield* uuid()),
            name: file.name,
            mimeType: file.mimeType,
            sizeBytes: bytes.length,
          });
          yield* fs.writeFile(
            path.join(config.attachmentsDir, attachmentRelativePath(attachment)!),
            bytes,
            { mode: 0o600 },
          );
          attachments.push(attachment);
        }
        const afterSequence = yield* threads.getThreadEventSequence(input.threadId);
        const sent = yield* threads.sendToThread({
          projectId: projection.thread.projectId,
          commandId: yield* commandId(),
          threadId: input.threadId,
          messageId: MessageId.make(yield* uuid()),
          text: input.text,
          attachments,
          mode: "queue",
          createdBy: "user",
          creationSource: "server",
        });
        const runId = sent.run.id;
        const result = Effect.fn("ChatSessions.printResult")(function* (allowTerminal: boolean) {
          const current = yield* load(input.threadId);
          const run = current.runs.find((run) => run.id === runId);
          const terminal = run !== undefined && ThreadManagement.isTerminalRunStatus(run.status);
          if (terminal && !allowTerminal) return undefined;
          const request = terminal
            ? undefined
            : current.runtimeRequests.find((request) => request.status === "pending");
          if (!terminal && request === undefined) return undefined;
          const status = request === undefined ? run!.status : "waiting";
          return {
            type: "result" as const,
            threadId: input.threadId,
            runId,
            status,
            text:
              current.messages.findLast(
                (message) => message.runId === runId && message.role === "assistant",
              )?.text ?? "",
            ...(request === undefined
              ? {}
              : {
                  answer: `ozi answer ${request.id} '<response JSON>' --thread ${input.threadId}`,
                }),
          };
        });
        return threads.streamStoredEventsFrom({ threadId: input.threadId, afterSequence }).pipe(
          Stream.mapEffect((stored) =>
            Effect.gen(function* () {
              const event = stored.event;
              const ended =
                event.type === "run.updated" &&
                event.payload.id === runId &&
                ThreadManagement.isTerminalRunStatus(event.payload.status);
              const finished =
                ended ||
                (event.type === "runtime-request.updated" && event.payload.status === "pending") ||
                (event.type === "run.updated" &&
                  event.payload.id === runId &&
                  event.payload.status === "queued")
                  ? yield* result(ended)
                  : undefined;
              return [
                { type: "event" as const, json: yield* encodeStoredEvent(stored) },
                ...(finished === undefined ? [] : [finished]),
              ];
            }),
          ),
          Stream.flatMap(Stream.fromIterable),
          Stream.takeUntil((event) => event.type === "result"),
        );
      }),
    ).pipe(
      Stream.mapError((cause) =>
        isChatSessionError(cause)
          ? cause
          : new ChatSessionError({ reason: "operation_failed", cause }),
      ),
    );
  return ChatSessions.of({ execute, print });
});

export const layer = Layer.effect(ChatSessions, make);
