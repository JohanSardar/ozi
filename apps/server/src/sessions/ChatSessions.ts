import {
  ChatAttachmentId,
  ChatPrintEvent,
  ChatPrintInput,
  ChatSessionError,
  ChatSessionInput,
  ChatSessionResult,
  ChatSessionAnswerInput,
  EventId,
  TurnItemId,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2TurnItem,
  CommandId,
  MessageId,
  ProviderDriverKind,
  ProviderSessionId,
  OZI_PROVIDER_INSTANCE,
  isConfiguredProviderInstanceEnabled,
  ThreadId,
  ChatAttachment,
  type ModelSelection,
  OrchestrationV2StoredEvent,
} from "@t3tools/contracts";
import { PiSettings } from "@t3tools/provider-pi/settings";
import { bundledPiBinary, piCliLaunch } from "@t3tools/provider-pi/server";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import { mergeProviderInstanceEnvironment } from "@t3tools/provider-core/server/instanceEnvironment";
import * as ServerConfig from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ProviderSessionManager from "../orchestration-v2/ProviderSessionManager.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import { attachmentRelativePath } from "../attachmentStore.ts";

const PiRecord = Schema.Struct({
  type: Schema.String,
  id: Schema.String,
  parentId: Schema.optional(Schema.NullOr(Schema.String)),
  version: Schema.optional(Schema.Number),
  cwd: Schema.optional(Schema.String),
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

export const parseSession = (content: string) =>
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
    readonly answer: (
      input: ChatSessionAnswerInput,
    ) => Effect.Effect<ChatSessionResult, ChatSessionError>;
  }
>()("ozi/sessions/ChatSessions") {}

export function messageEvents(input: {
  readonly threadId: ThreadId;
  readonly index: number;
  readonly message: {
    readonly role: "user" | "assistant";
    readonly text: string;
    readonly createdAt: string;
  };
}): ReadonlyArray<OrchestrationV2DomainEvent> {
  const ordinal = input.index + 1;
  const suffix = String(input.index).padStart(6, "0");
  const messageId = MessageId.make(`${input.threadId}:${suffix}`);
  const turnItemId = TurnItemId.make(
    `${"chat-session-import:v2"}:turn-item:${input.threadId}:${suffix}`,
  );
  const at = DateTime.makeUnsafe(input.message.createdAt);
  const message: OrchestrationV2ConversationMessage = {
    createdBy: input.message.role === "user" ? "user" : "agent",
    creationSource: "server",
    id: messageId,
    threadId: input.threadId,
    runId: null,
    nodeId: null,
    role: input.message.role,
    text: input.message.text,
    attachments: [],
    streaming: false,
    createdAt: at,
    updatedAt: at,
  };
  const common = {
    id: turnItemId,
    threadId: input.threadId,
    runId: null,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal,
    status: "completed" as const,
    title: null,
    startedAt: at,
    completedAt: at,
    updatedAt: at,
  };
  const turnItem: OrchestrationV2TurnItem =
    input.message.role === "user"
      ? {
          ...common,
          createdBy: "user",
          creationSource: "server",
          type: "user_message",
          messageId,
          inputIntent: "turn_start",
          text: input.message.text,
          attachments: [],
        }
      : {
          ...common,
          type: "assistant_message",
          messageId,
          text: input.message.text,
          streaming: false,
        };
  return [
    {
      id: EventId.make(`${"chat-session-import:v2"}:message:${input.threadId}:${suffix}`),
      type: "message.updated",
      threadId: input.threadId,
      occurredAt: at,
      payload: message,
    },
    {
      id: EventId.make(`${"chat-session-import:v2"}:turn-item:${input.threadId}:${suffix}`),
      type: "turn-item.updated",
      threadId: input.threadId,
      occurredAt: at,
      payload: turnItem,
    },
  ];
}

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagement.ThreadManagementService;
  const providerSessions = yield* ProviderSessionManager.ProviderSessionManagerV2;
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
  type Projection = Effect.Success<ReturnType<typeof load>>;
  type SessionMessage = Projection["messages"][number] & { sourceThreadId: ThreadId };
  const history = Effect.fn("ChatSessions.history")(function* (
    projection: Projection,
  ): Effect.fn.Return<SessionMessage[], Effect.Error<ReturnType<typeof load>>> {
    const inherited: SessionMessage[] = [];
    const fork = projection.thread.forkedFrom;
    if (fork?.type === "run") {
      const source = yield* load(fork.threadId);
      const boundary = source.runs.find((run) => run.id === fork.runId);
      if (boundary !== undefined)
        for (const message of yield* history(source))
          if (
            message.sourceThreadId !== source.thread.id ||
            message.runId === null ||
            source.runs.some((run) => run.id === message.runId && run.ordinal <= boundary.ordinal)
          )
            inherited.push(message);
    }
    return [
      ...inherited,
      ...projection.messages.map((message) => ({
        ...message,
        sourceThreadId: projection.thread.id,
      })),
    ];
  });
  const inherit = Effect.fn("ChatSessions.inherit")(function* (
    threadId: ThreadId,
    source: Projection,
  ) {
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
            providerInstanceId: source.thread.providerInstanceId,
            modelSelection: source.thread.modelSelection,
            runtimeMode: source.thread.runtimeMode,
            interactionMode: source.thread.interactionMode,
            lineage: {
              parentThreadId: source.thread.id,
              relationshipToParent: "fork",
              rootThreadId: source.thread.lineage.rootThreadId,
            },
          },
        },
      ],
    });
  });
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
  const sessionContent = Effect.fn("ChatSessions.sessionContent")(function* (
    projection: Projection,
  ): Effect.fn.Return<
    string,
    ChatSessionError | PlatformError.PlatformError | Effect.Error<ReturnType<typeof load>>
  > {
    const fork = projection.thread.forkedFrom;
    if (projection.thread.activeProviderThreadId !== null || fork?.type !== "run")
      return yield* fs.readFileString(yield* nativeFile(projection));
    const parsed = yield* parseSession(yield* sessionContent(yield* load(fork.threadId)));
    const count = (yield* history(projection)).filter((message) => message.role === "user").length;
    const next = parsed.branch.filter((entry) => entry.message?.role === "user")[count];
    const end = next === undefined ? parsed.branch.length : parsed.branch.indexOf(next);
    const keep = new Set(parsed.branch.slice(0, end).map((entry) => entry.id));
    return (
      parsed.lines
        .filter((_, index) => index === 0 || keep.has(parsed.entries[index]!.id))
        .join("\n") + "\n"
    );
  });
  const create = Effect.fn("ChatSessions.create")(function* (input: {
    threadId?: ThreadId | undefined;
    title?: string | undefined;
    modelSelection?: ModelSelection | undefined;
    content?: string | undefined;
    fork?: boolean;
  }) {
    const source = input.threadId === undefined ? undefined : yield* load(input.threadId);
    const selection =
      input.modelSelection ??
      source?.thread.modelSelection ??
      (yield* settings.getSettings).defaultModelSelection;
    if (selection == null) return yield* new ChatSessionError({ reason: "model_required" });
    const provider = (yield* settings.getSettings).providerInstances[selection.instanceId];
    const threadId = ThreadId.make(yield* uuid());
    let sessionFile: string | undefined;
    let imported: Effect.Success<ReturnType<typeof parseSession>> | undefined;
    if (input.content !== undefined) {
      if (provider?.driver !== "pi") return yield* new ChatSessionError({ reason: "pi_required" });
      imported = yield* parseSession(input.content);
      const directory = path.join(config.stateDir, "pi-sessions");
      yield* fs.makeDirectory(directory, { recursive: true });
      sessionFile = path.join(directory, `${threadId}.jsonl`);
      yield* fs.writeFileString(sessionFile, input.content, { mode: 0o600 });
    }
    yield* threads.dispatch({
      type: "thread.create",
      commandId: yield* commandId(),
      threadId,
      title:
        input.title?.trim() || (input.content === undefined ? "New chat" : "Imported Pi session"),
      modelSelection: selection,
      runtimeMode: source?.thread.runtimeMode ?? "full-access",
      interactionMode: source?.thread.interactionMode ?? "default",
      workingDirectory: source?.thread.workingDirectory ?? imported?.entries[0]?.cwd ?? null,
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
    if (input.fork && source !== undefined) yield* inherit(threadId, source);
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

  const piCommand = Effect.fn("ChatSessions.piCommand")(function* (
    projection: Projection,
    input: Extract<ChatSessionInput, { action: "pi-rpc" | "pi-cli" }>,
  ) {
    const currentSettings = yield* settings.getSettings;
    const instance =
      currentSettings.providerInstances[projection.thread.providerInstanceId] ??
      (projection.thread.providerInstanceId === "ozi" ? OZI_PROVIDER_INSTANCE : undefined);
    if (
      instance?.driver !== "pi" ||
      !isConfiguredProviderInstanceEnabled(currentSettings, projection.thread.providerInstanceId)
    )
      return yield* new ChatSessionError({ reason: "pi_required" });
    if (input.action === "pi-cli") {
      const launch = yield* piCliLaunch(
        yield* decodePiSettings(instance.config ?? {}),
        yield* mergeProviderInstanceEnvironment(instance.environment),
        config.baseDir,
        input.args,
      ).pipe(
        Effect.provideService(Path.Path, path),
        Effect.provideService(FileSystem.FileSystem, fs),
      );
      return yield* Effect.scoped(
        Effect.gen(function* () {
          const child = yield* spawner.spawn(
            ChildProcess.make(launch.binary, launch.args, {
              cwd: projection.thread.workingDirectory ?? config.cwd,
              env: launch.env,
              extendEnv: false,
              stdin: "ignore",
            }),
          );
          const [stdout, stderr, exitCode] = yield* Effect.all(
            [
              child.stdout.pipe(Stream.decodeText(), Stream.mkString),
              child.stderr.pipe(Stream.decodeText(), Stream.mkString),
              child.exitCode,
            ],
            { concurrency: "unbounded" },
          );
          return { threadId: input.threadId, stdout, stderr, exitCode: Number(exitCode) };
        }),
      ).pipe(Effect.timeout("2 minutes"));
    }
    const providerThread = projection.providerThreads.find(
      (item) =>
        item.id === projection.thread.activeProviderThreadId &&
        item.providerInstanceId === projection.thread.providerInstanceId,
    );
    const runtimePolicy = {
      runtimeMode: projection.thread.runtimeMode,
      interactionMode: projection.thread.interactionMode,
      cwd: projection.thread.workingDirectory ?? config.cwd,
    };
    const previousSession = projection.providerSessions.find(
      (item) => item.id === providerThread?.providerSessionId,
    );
    const session = yield* providerSessions.open({
      threadId: input.threadId,
      providerSessionId:
        providerThread?.providerSessionId ?? ProviderSessionId.make(`pi-command:${input.threadId}`),
      modelSelection: projection.thread.modelSelection,
      runtimePolicy,
      ...(providerThread?.nativeThreadRef?.nativeId == null
        ? {}
        : { initialNativeThreadId: providerThread.nativeThreadRef.nativeId }),
      ...(previousSession === undefined ? {} : { resumeFromSession: previousSession }),
      ...(providerThread?.nativeMetadata?.itemIdentityVersion === undefined
        ? {}
        : {
            initialProviderItemIdentityVersion: providerThread.nativeMetadata.itemIdentityVersion,
          }),
    });
    const registered =
      providerThread === undefined
        ? yield* session.ensureThread({
            threadId: input.threadId,
            title: projection.thread.title,
            modelSelection: projection.thread.modelSelection,
            runtimePolicy,
          })
        : yield* session.resumeThread({
            providerThread,
            modelSelection: projection.thread.modelSelection,
            runtimePolicy,
          });
    yield* sink.write({
      events: [
        {
          id: EventId.make(yield* uuid()),
          type: "provider-thread.updated",
          threadId: input.threadId,
          driver: registered.driver,
          providerInstanceId: registered.providerInstanceId,
          occurredAt: registered.updatedAt,
          payload: registered,
        },
      ],
    });
    if (session.executePiCommand === undefined)
      return yield* new ChatSessionError({ reason: "pi_required" });
    const data = yield* session.executePiCommand(input.command);
    const command = input.command;
    if (command.type === "set_session_name")
      yield* threads.dispatch({
        type: "thread.metadata.update",
        commandId: yield* commandId(),
        threadId: input.threadId,
        title: command.name,
      });
    if (command.type === "set_model" || command.type === "set_thinking_level") {
      const selection = projection.thread.modelSelection;
      const modelSelection =
        command.type === "set_model"
          ? { ...selection, model: `${command.provider}/${command.modelId}` }
          : {
              ...selection,
              options: [
                ...(selection.options ?? []).filter((option) => option.id !== "thinking"),
                { id: "thinking", value: command.level },
              ],
            };
      yield* threads.dispatch({
        type: "thread.model-selection.set",
        commandId: yield* commandId(),
        threadId: input.threadId,
        modelSelection,
      });
    }
    return { threadId: input.threadId, data };
  });

  const execute = Effect.fn("ChatSessions.execute")(
    function* (input: ChatSessionInput): Effect.fn.Return<ChatSessionResult, unknown> {
      if (input.action === "list") {
        const sessions = yield* threads.listThreads({ includeSubagents: false });
        const archived = (yield* threads.getShellSnapshot({ location: "archive" })).threads.filter(
          (thread) => thread.lineage.relationshipToParent !== "subagent",
        );
        return {
          sessions: [...sessions, ...archived]
            .map((thread) => ({
              threadId: thread.id,
              title: thread.title,
              parentThreadId: thread.lineage.parentThreadId,
              updatedAt: DateTime.formatIso(thread.updatedAt),
              archived: thread.archivedAt !== null,
            }))
            .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
        };
      }
      if (input.action === "new") return yield* create(input);
      if (input.action === "import") return yield* create(input);
      const projection = yield* load(input.threadId);
      if (input.action === "pi-rpc" || input.action === "pi-cli")
        return yield* piCommand(projection, input);
      if (input.action === "inspect")
        return {
          threadId: input.threadId,
          modelSelection: projection.thread.modelSelection,
          workingDirectory: projection.thread.workingDirectory ?? config.cwd,
          messages: (yield* history(projection))
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
        const messages = yield* history(projection);
        const selected =
          input.action === "fork"
            ? messages.findIndex(
                (message) => message.id === input.messageId && message.role === "user",
              )
            : -1;
        if (input.action === "fork" && selected < 0)
          return yield* new ChatSessionError({ reason: "invalid_session" });
        const before = input.action === "fork" ? messages.slice(0, selected) : messages;
        const previous = before.findLast((message) => message.runId != null);
        const editorText = input.action === "fork" ? messages[selected]!.text : undefined;
        const title = `${projection.thread.title} ${input.action}`;
        if (before.length === 0)
          return {
            ...(yield* create({ threadId: input.threadId, title, fork: true })),
            ...(editorText === undefined ? {} : { editorText }),
          };
        if (previous?.runId == null) {
          const file = yield* nativeFile(yield* load(before.at(-1)!.sourceThreadId));
          let content = yield* fs.readFileString(file);
          if (input.action === "fork") {
            const parsed = yield* parseSession(content);
            const users = parsed.branch.filter(
              (entry) => entry.type === "message" && entry.message?.role === "user",
            );
            const index = messages
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
          sourceThreadId: previous.sourceThreadId,
          targetThreadId,
          sourcePoint: { type: "run", runId: previous.runId },
          title,
          createdBy: "user",
          creationSource: "server",
        });
        yield* inherit(targetThreadId, projection);
        return { threadId: targetThreadId, ...(editorText === undefined ? {} : { editorText }) };
      }
      if (input.action !== "export")
        return yield* new ChatSessionError({ reason: "operation_failed" });
      const content = yield* sessionContent(projection);
      if (input.format === "jsonl") return { content, filename: `${input.threadId}.jsonl` };
      const provider = (yield* settings.getSettings).providerInstances[
        projection.thread.providerInstanceId
      ];
      const pi = yield* decodePiSettings(provider?.config ?? {});
      const binary =
        pi.harness === "ozi" && (!pi.binaryPath || pi.binaryPath === "pi")
          ? bundledPiBinary
          : pi.binaryPath || "pi";
      return yield* Effect.scoped(
        Effect.gen(function* () {
          const directory = yield* fs.makeTempDirectoryScoped({ prefix: "ozi-export-" });
          const file = path.join(directory, "session.jsonl");
          yield* fs.writeFileString(file, content, { mode: 0o600 });
          const output = path.join(directory, "session.html");
          const process = yield* spawner.spawn(
            ChildProcess.make(binary, ["--no-extensions", "--export", file, output], {
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
        yield* load(input.threadId);
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
  const answer = Effect.fn("ChatSessions.answer")(
    function* (input: ChatSessionAnswerInput) {
      yield* threads.dispatch({
        type: "runtime-request.respond",
        commandId: yield* commandId(),
        ...input,
      });
      return { threadId: input.threadId };
    },
    Effect.mapError((cause) => new ChatSessionError({ reason: "operation_failed", cause })),
  );
  return ChatSessions.of({ execute, print, answer });
});

export const layer = Layer.effect(ChatSessions, make);
