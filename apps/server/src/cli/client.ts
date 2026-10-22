import { OZI_WS_METHODS, OziCheck } from "@t3tools/contracts";
import {
  AuthAccessTokenResult,
  AuthAccessTokenType,
  AuthEnvironmentBootstrapTokenType,
  AuthPairingCredentialResult,
  AuthTokenExchangeGrantType,
  AuthWebSocketTicketResult,
  ChatAttachment,
  ChatAttachmentId,
  CommandId,
  EventId,
  OZI_MAIN_THREAD_ID,
  OZI_WS_METHODS as J,
  OziJobCard,
  OziTodoSettings,
  OziTodos,
  OZI_MAIN_SELECTION,
  ScheduledTask,
  ScheduledTaskId,
  ScheduledTaskDeleteResult,
  ScheduledTaskUpsertSchedule,
  ScheduledTaskWebhookFilter,
  SecretRef,
  RuntimeRequestId,
  TurnItemId,
  MessageId,
  ProviderInstanceId,
  ORCHESTRATION_V2_WS_METHODS as O,
  OrchestrationV2DispatchCommandResult,
  OrchestrationV2ShellSnapshot,
  OrchestrationV2ThreadProjection,
  ServerConfig,
  ServerProvider,
  ThreadId,
  WS_METHODS as W,
  WsRpcGroup,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Cause from "effect/Cause";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { Argument, Command, Flag } from "effect/cli";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { Socket } from "effect/socket";
import { Rpc, RpcClient, RpcGroup, RpcSerialization } from "effect/rpc";
import { OwnerCredential } from "../ozi/OwnerCredential.ts";
import { Fix, Mistake, Replay } from "../ozi/RepairModel.ts";
import { resolveBaseDir } from "../os-jank.ts";
import { isProcessAlive, readPersistedServerRuntimeState } from "../serverRuntimeState.ts";
import { buildPairingUrl } from "../startupAccess.ts";
import { baseDirFlag, homeConfig, jsonFlag } from "./config.ts";

const locationFlags = { baseDir: baseDirFlag, json: jsonFlag };
const threadFlag = Flag.String("thread").pipe(Flag.withSchema(ThreadId), Flag.optional);
const makeClient = RpcClient.make(WsRpcGroup);
type Client = Effect.Success<typeof makeClient>;

const decodeRequestPayload = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const encodePairing = Schema.encodeEffect(AuthPairingCredentialResult);
const decodePairingUrl = Schema.decodeEffect(Schema.URLFromString);
const decodeTodoSettings = Schema.decodeUnknownEffect(Schema.fromJsonString(OziTodoSettings));
const decodeSchedule = Schema.decodeUnknownEffect(ScheduledTaskUpsertSchedule);
const decodeWebhookFilter = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ScheduledTaskWebhookFilter),
);
const encodeProjection = Schema.encodeSync(OrchestrationV2ThreadProjection);

class ClientError extends Schema.TaggedError<ClientError>()("OziClientError", {
  operation: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message() {
    return `Ozi ${this.operation}.`;
  }
}

const post = Effect.fn("ozi.post")(function* (
  origin: string,
  token: string,
  path: string,
  body?: unknown,
) {
  const client = yield* HttpClient.HttpClient;
  let outgoing = HttpClientRequest.post(new URL(path, origin).toString()).pipe(
    HttpClientRequest.setHeader("Authorization", `Bearer ${token}`),
  );
  if (body !== undefined)
    outgoing = outgoing.pipe(
      HttpClientRequest.bodyText(yield* encodeJson(body), "application/json"),
    );
  const response = yield* client.execute(outgoing);
  return yield* HttpClientResponse.filterStatusOk(response);
});

const request = Effect.fn("ozi.request")(
  <A>(
    origin: string,
    token: string,
    path: string,
    schema: Schema.Codec<A, unknown>,
    body?: unknown,
  ) =>
    post(origin, token, path, body).pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(schema))),
);

const decodeRepairRow = Schema.decodeEffect(
  Schema.fromJsonString(Schema.NullOr(Schema.Union([Mistake, Replay, Fix]))),
);

const RemoteConnection = Schema.Struct({ origin: Schema.String, token: Schema.String });
const remoteSessionError = (cause: unknown) =>
  new ClientError({ operation: "remote session rejected; run ozi connect again", cause });
const clientHome = Effect.fn("ozi.clientHome")(function* (baseDir: Option.Option<string>) {
  return yield* resolveBaseDir(Option.getOrUndefined(baseDir) ?? (yield* homeConfig));
});

const resolveConnection = Effect.fn("ozi.resolveConnection")(function* (
  baseDir: Option.Option<string>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = yield* clientHome(baseDir);
  for (const variant of ["userdata", "dev"]) {
    const dir = path.join(home, variant);
    const state = yield* readPersistedServerRuntimeState(path.join(dir, "server-runtime.json"));
    if (Option.isNone(state) || !isProcessAlive(state.value.pid)) continue;
    const owner = yield* fs
      .readFileString(path.join(dir, "owner.json"))
      .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(OwnerCredential))));
    return { state: state.value, token: owner.token, remote: false };
  }
  const file = path.join(home, "remote.json");
  if (yield* fs.exists(file)) {
    const remote = yield* fs
      .readFileString(file)
      .pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(RemoteConnection))),
        Effect.mapError(remoteSessionError),
      );
    return {
      state: { origin: remote.origin, devUrl: undefined },
      token: remote.token,
      remote: true,
    };
  }
  return yield* new ClientError({ operation: "found no running server; start ozi serve" });
});

const connectTransport = Effect.fn("ozi.connectTransport")(function* (
  baseDir: Option.Option<string>,
) {
  const { state, token, remote } = yield* resolveConnection(baseDir);
  const { ticket } = yield* request(
    state.origin,
    token,
    "/api/auth/websocket-ticket",
    AuthWebSocketTicketResult,
  ).pipe(
    Effect.mapError((cause) =>
      remote &&
      cause._tag === "HttpClientError" &&
      cause.reason._tag === "StatusCodeError" &&
      (cause.reason.response.status === 401 || cause.reason.response.status === 403)
        ? remoteSessionError(cause)
        : cause,
    ),
  );
  const url = new URL("/ws", state.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("wsTicket", ticket);
  url.searchParams.set("orchestrationProtocol", "2");
  const protocol = RpcClient.layerProtocolSocket({
    retryTransientErrors: false,
    retryPolicy: Schedule.recurs(0),
  }).pipe(
    Layer.provide(Socket.layerWebSocket(url.toString())),
    Layer.provide(Socket.layerWebSocketConstructorGlobal),
    Layer.provide(RpcSerialization.layerJson),
  );
  const context = yield* Layer.build(protocol);
  return { context, state, token };
});

const connect = Effect.fn("ozi.connect")(function* (baseDir: Option.Option<string>) {
  const transport = yield* connectTransport(baseDir);
  const client = yield* makeClient.pipe(Effect.provide(transport.context));
  return { ...transport, client };
});

const snapshot = Effect.fn("ozi.snapshot")(function* (client: Client) {
  const item = yield* client[O.subscribeShell]({}).pipe(
    Stream.filter((item) => item.kind === "snapshot"),
    Stream.runHead,
  );
  if (Option.isNone(item)) return yield* new ClientError({ operation: "shell subscription ended" });
  return item.value.snapshot;
});

const mainThread = (shell: OrchestrationV2ShellSnapshot) =>
  shell.threads.find((thread) => thread.id === OZI_MAIN_THREAD_ID);

const targetThread = Effect.fn("ozi.targetThread")(function* (
  client: Client,
  id: Option.Option<ThreadId>,
) {
  if (Option.isSome(id)) return id.value;
  const main = mainThread(yield* snapshot(client));
  if (main) return main.id;
  return yield* new ClientError({ operation: "has no main thread" });
});

const print = (value: unknown) => encodeJson(value).pipe(Effect.flatMap(Console.log));
const emit = <A, E>(schema: Schema.Codec<A, E>, value: A) =>
  Schema.encodeEffect(schema)(value).pipe(Effect.flatMap(print));

const connectCommand = Command.make("connect", {
  ...locationFlags,
  url: Argument.String("pairing-url"),
}).pipe(
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const invalid = (cause?: unknown) =>
        new ClientError({
          operation: "could not connect; run ozi connect with a new pairing URL",
          cause,
        });
      const url = yield* decodePairingUrl(flags.url).pipe(Effect.mapError(invalid));
      const credential = new URLSearchParams(url.hash.slice(1)).get("token");
      if (
        !credential ||
        !["http:", "https:"].includes(url.protocol) ||
        url.pathname !== "/pair" ||
        url.username ||
        url.password
      )
        return yield* invalid();
      const http = yield* HttpClient.HttpClient;
      const session = yield* http
        .execute(
          HttpClientRequest.post(new URL("/oauth/token", url.origin).toString()).pipe(
            HttpClientRequest.bodyUrlParams({
              grant_type: AuthTokenExchangeGrantType,
              subject_token: credential,
              subject_token_type: AuthEnvironmentBootstrapTokenType,
              requested_token_type: AuthAccessTokenType,
              client_label: "Ozi CLI",
            }),
          ),
        )
        .pipe(
          Effect.flatMap(HttpClientResponse.filterStatusOk),
          Effect.flatMap(HttpClientResponse.schemaBodyJson(AuthAccessTokenResult)),
          Effect.timeout("10 seconds"),
          Effect.mapError(invalid),
        );
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* clientHome(flags.baseDir);
      yield* fs.makeDirectory(home, { recursive: true, mode: 0o700 });
      const directory = yield* fs.makeTempDirectoryScoped({ directory: home, prefix: "remote-" });
      const temporary = path.join(directory, "remote.json");
      yield* fs.writeFileString(
        temporary,
        yield* encodeJson({ origin: url.origin, token: session.access_token }),
        { mode: 0o600 },
      );
      yield* fs.rename(temporary, path.join(home, "remote.json"));
      yield* flags.json
        ? print({ origin: url.origin })
        : Console.log(`Connected to ${url.origin}.`);
    }),
  ),
);

const disconnectCommand = Command.make("disconnect", locationFlags).pipe(
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      yield* fs.remove(path.join(yield* clientHome(flags.baseDir), "remote.json"), { force: true });
      yield* flags.json ? print({ disconnected: true }) : Console.log("Disconnected.");
    }),
  ),
);

const statusSchema = Schema.Struct({
  server: ServerConfig,
  snapshot: OrchestrationV2ShellSnapshot,
  main: Schema.NullOr(OrchestrationV2ThreadProjection),
});
const statusCommand = Command.make("status", locationFlags).pipe(
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const { client } = yield* connect(flags.baseDir);
      const server = yield* client[W.serverGetConfig]({});
      const shell = yield* snapshot(client);
      const main = mainThread(shell);
      const projection = main ? yield* client[O.getThreadProjection]({ threadId: main.id }) : null;
      yield* emit(statusSchema, { server, snapshot: shell, main: projection });
    }),
  ),
);

const pairCommand = Command.make("pair", locationFlags).pipe(
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const { state, token } = yield* connect(flags.baseDir);
      const credential = yield* request(
        state.origin,
        token,
        "/api/auth/pairing-token",
        AuthPairingCredentialResult,
        {},
      );
      yield* print({
        ...(yield* encodePairing(credential)),
        url: buildPairingUrl(state.devUrl ?? state.origin, credential.credential),
      });
    }),
  ),
);

const send = Effect.fn("ozi.send")(function* (
  flags: {
    baseDir: Option.Option<string>;
    text: string;
    thread?: Option.Option<ThreadId>;
    files?: ReadonlyArray<string>;
  },
  steer = false,
) {
  const { client, state } = yield* connect(flags.baseDir);
  const threadId = yield* targetThread(client, flags.thread ?? Option.none());
  const attachments: ChatAttachment[] = [];
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  for (const file of flags.files ?? []) {
    const bytes = yield* fs.readFile(file);
    const metadata = {
      type: "file" as const,
      name: path.basename(file),
      mimeType: "application/octet-stream",
      sizeBytes: bytes.length,
    };
    const upload = yield* client[W.attachmentsCreateUploadUrl](metadata);
    const http = yield* HttpClient.HttpClient;
    yield* http
      .execute(
        HttpClientRequest.post(new URL(upload.relativeUrl, state.origin).toString()).pipe(
          HttpClientRequest.bodyUint8Array(bytes),
        ),
      )
      .pipe(Effect.flatMap(HttpClientResponse.filterStatusOk));
    attachments.push({ ...metadata, id: ChatAttachmentId.make(upload.attachmentId) });
  }
  const projection = yield* client[O.getThreadProjection]({ threadId });
  const active = projection.runs.find(
    (run) =>
      (run.completionCheck?.state === "checking" && !run.completionCheck.sourceCaptured) ||
      ["preparing", "starting", "running", "waiting"].includes(run.status),
  );
  const pendingCheck = projection.runs.some((run) => run.completionCheck?.state === "checking");
  if (steer && !active && !pendingCheck)
    return yield* new ClientError({ operation: "has no active turn to steer" });
  const result = yield* client[O.dispatchCommand]({
    type: "message.dispatch",
    commandId: CommandId.make(yield* (yield* Crypto.Crypto).randomUUIDv4()),
    threadId,
    messageId: MessageId.make(yield* (yield* Crypto.Crypto).randomUUIDv4()),
    text: flags.text,
    attachments,
    createdBy: "user",
    creationSource: "cli",
    ...(steer && active ? { deliveryIntent: "steer" as const } : {}),
    dispatchMode:
      steer && active
        ? { type: "steer_active", targetRunId: active.id }
        : active
          ? { type: "queue_after_active" }
          : { type: "start_immediately" },
  });
  return result;
});

const sayCommand = Command.make("say", {
  ...locationFlags,
  text: Argument.String("text"),
  files: Flag.String("file").pipe(Flag.atLeast(0)),
}).pipe(
  Command.withHandler((flags) =>
    send(flags).pipe(
      Effect.flatMap((result) => emit(OrchestrationV2DispatchCommandResult, result)),
    ),
  ),
);
const steerCommand = Command.make("steer", {
  ...locationFlags,
  text: Argument.String("text"),
  thread: threadFlag,
}).pipe(
  Command.withHandler((flags) =>
    send(flags, true).pipe(
      Effect.flatMap((result) => emit(OrchestrationV2DispatchCommandResult, result)),
    ),
  ),
);
const stopCommand = Command.make("stop", { ...locationFlags, thread: threadFlag }).pipe(
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const { client } = yield* connect(flags.baseDir);
      const threadId = yield* targetThread(client, flags.thread);
      const result = yield* client[O.dispatchCommand]({
        type: "thread.stop",
        commandId: CommandId.make(yield* (yield* Crypto.Crypto).randomUUIDv4()),
        threadId,
      });
      yield* emit(OrchestrationV2DispatchCommandResult, result);
    }),
  ),
);
const threadCommand = Command.make("thread", {
  ...locationFlags,
  id: Argument.String("id").pipe(Argument.withSchema(ThreadId)),
  provider: Flag.String("provider").pipe(Flag.withSchema(ProviderInstanceId), Flag.optional),
  model: Flag.String("model").pipe(Flag.optional),
  fork: Flag.Boolean("fork").pipe(Flag.withDefault(false)),
  message: Flag.String("message").pipe(Flag.optional),
}).pipe(
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const { client } = yield* connect(flags.baseDir);
      let threadId = flags.id;
      if (flags.fork) {
        threadId = ThreadId.make(yield* (yield* Crypto.Crypto).randomUUIDv4());
        yield* client[O.dispatchCommand]({
          type: "thread.fork",
          commandId: CommandId.make(yield* (yield* Crypto.Crypto).randomUUIDv4()),
          sourceThreadId: flags.id,
          targetThreadId: threadId,
          sourcePoint: { type: "latest_stable" },
          createdBy: "user",
          creationSource: "cli",
        });
      }
      if (Option.isSome(flags.provider) || Option.isSome(flags.model)) {
        const current = yield* client[O.getThreadProjection]({ threadId });
        yield* client[O.dispatchCommand]({
          type: "thread.model-selection.set",
          commandId: CommandId.make(yield* (yield* Crypto.Crypto).randomUUIDv4()),
          threadId,
          modelSelection: {
            instanceId: Option.getOrElse(
              flags.provider,
              () => current.thread.modelSelection.instanceId,
            ),
            model: Option.getOrElse(flags.model, () => current.thread.modelSelection.model),
            options: [],
          },
        });
      }
      if (Option.isSome(flags.message))
        yield* send({
          baseDir: flags.baseDir,
          thread: Option.some(threadId),
          text: flags.message.value,
        });
      yield* emit(
        OrchestrationV2ThreadProjection,
        yield* client[O.getThreadProjection]({ threadId }),
      );
    }),
  ),
);

const jobsCommand = Command.make("jobs", locationFlags).pipe(
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const { client } = yield* connect(flags.baseDir);
      yield* emit(Schema.Array(OziJobCard), yield* client[J.jobsGet]({}));
    }),
  ),
);
const jobCommand = Command.make("job", {
  ...locationFlags,
  id: Argument.String("id").pipe(Argument.withSchema(ThreadId)),
}).pipe(
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const { client } = yield* connect(flags.baseDir);
      const card = (yield* client[J.jobsGet]({})).find((card) => card.jobId === flags.id);
      if (!card) return yield* new ClientError({ operation: "found no such job" });
      yield* emit(Schema.Struct({ card: OziJobCard, lead: OrchestrationV2ThreadProjection }), {
        card,
        lead: yield* client[O.getThreadProjection]({ threadId: flags.id }),
      });
    }),
  ),
);
const closeCommand = Command.make("close", {
  ...locationFlags,
  jobId: Argument.String("jobId").pipe(Argument.withSchema(ThreadId)),
  eventId: Argument.String("eventId").pipe(Argument.withSchema(EventId)),
  commandId: Flag.String("command-id").pipe(Flag.withSchema(CommandId), Flag.optional),
}).pipe(
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const { client } = yield* connect(flags.baseDir);
      yield* emit(
        OrchestrationV2DispatchCommandResult,
        yield* client[J.jobsHandle]({
          commandId: Option.isSome(flags.commandId)
            ? flags.commandId.value
            : CommandId.make(yield* (yield* Crypto.Crypto).randomUUIDv4()),
          jobId: flags.jobId,
          eventId: flags.eventId,
          evidence: { type: "close" },
        }),
      );
    }),
  ),
);
const answerCommand = Command.make("answer", {
  ...locationFlags,
  requestId: Argument.String("requestId"),
  values: Argument.String("value").pipe(Argument.atLeast(1)),
}).pipe(
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const { client } = yield* connect(flags.baseDir);
      const request = (yield* client[J.jobsGet]({}))
        .flatMap((card) => card.requests)
        .find((request) => request.id === flags.requestId);
      if (!request) return yield* new ClientError({ operation: "found no such request" });
      const value = flags.values.join(" ");
      if (request.kind === "secret") {
        yield* client[W.secretsAnswerRequest]({
          threadId: request.threadId,
          turnItemId: TurnItemId.make(request.id),
          answer: { type: "save", secret: value },
        });
        yield* print({ answered: true });
        return;
      }
      if (request.kind === "blocked") {
        yield* emit(
          OrchestrationV2DispatchCommandResult,
          yield* send({
            baseDir: flags.baseDir,
            thread: Option.some(request.threadId),
            text: value,
          }),
        );
        return;
      }
      if (request.kind !== "question" && request.kind !== "approval")
        return yield* new ClientError({ operation: "requires the indicated human action" });
      if (request.kind === "approval" && value !== "allow" && value !== "deny")
        return yield* new ClientError({ operation: "approval requires allow or deny" });
      const projection = yield* client[O.getThreadProjection]({ threadId: request.threadId });
      const item = projection.turnItems.find(
        (item) => item.type === "user_input_request" && item.requestId === request.id,
      );
      const answers =
        item?.type === "user_input_request"
          ? Object.fromEntries(
              item.questions.map((question, index) => [
                question.id,
                item.questions.length === 1 ? value : (flags.values[index] ?? ""),
              ]),
            )
          : {};
      yield* emit(
        OrchestrationV2DispatchCommandResult,
        yield* client[O.dispatchCommand]({
          type: "runtime-request.respond",
          commandId: CommandId.make(yield* (yield* Crypto.Crypto).randomUUIDv4()),
          threadId: request.threadId,
          requestId: RuntimeRequestId.make(request.id),
          ...(request.kind === "approval"
            ? { decision: value === "allow" ? ("accept" as const) : ("decline" as const) }
            : { answers }),
        }),
      );
    }),
  ),
);

const waitCommand = Command.make("wait", {
  ...locationFlags,
  entity: Argument.Literals("entity", [
    "thread",
    "job",
    "check",
    "mistake",
    "replay",
    "fix",
    "provider",
  ]),
  id: Argument.String("id"),
  state: Argument.String("state"),
  timeout: Flag.Finite("timeout").pipe(
    Flag.withSchema(Schema.Number.check(Schema.isGreaterThan(0))),
    Flag.withDefault(30),
  ),
}).pipe(
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      if (flags.entity === "mistake" || flags.entity === "replay" || flags.entity === "fix") {
        const { state, token } = yield* connect(flags.baseDir);
        const result = yield* post(state.origin, token, "/api/ozi/repair", {
          kind: "wait",
          entity: flags.entity,
          id: flags.id,
        }).pipe(
          Effect.flatMap((response) =>
            response.stream.pipe(
              Stream.decodeText(),
              Stream.splitLines,
              Stream.mapEffect((line) => decodeRepairRow(line)),
              Stream.filter(
                (row) =>
                  row !== null &&
                  row.id === flags.id &&
                  (("status" in row ? row.status : row.state) === flags.state ||
                    ("checkpoint" in row && `at:${row.checkpoint}` === flags.state) ||
                    ("reason" in row && row.reason === flags.state) ||
                    (flags.state === "finished" &&
                      "state" in row &&
                      (row.state === "passed" || row.state === "failed"))),
              ),
              Stream.runHead,
            ),
          ),
          Effect.timeout(`${flags.timeout} seconds`),
        );
        if (Option.isNone(result))
          return yield* new ClientError({ operation: "repair subscription ended" });
        yield* print(result.value);
        return;
      }
      const { client } = yield* connect(flags.baseDir);
      if (flags.entity === "provider") {
        const result = yield* client[W.subscribeServerConfig]({}).pipe(
          Stream.map((event) =>
            (event.type === "snapshot"
              ? event.config.providers
              : event.type === "providerStatuses"
                ? event.payload.providers
                : []
            ).find(
              (provider) => provider.instanceId === flags.id && provider.status === flags.state,
            ),
          ),
          Stream.filter((provider): provider is ServerProvider => provider !== undefined),
          Stream.runHead,
          Effect.timeout(`${flags.timeout} seconds`),
        );
        if (Option.isNone(result))
          return yield* new ClientError({ operation: "provider subscription ended" });
        yield* emit(ServerProvider, result.value);
        return;
      }
      if (flags.entity === "job") {
        const result = yield* client[J.jobsSubscribe]({}).pipe(
          Stream.map((cards) =>
            cards.find((card) => card.jobId === flags.id && card.column === flags.state),
          ),
          Stream.filter((card): card is OziJobCard => card !== undefined),
          Stream.runHead,
          Effect.timeout(`${flags.timeout} seconds`),
        );
        if (Option.isNone(result))
          return yield* new ClientError({ operation: "jobs subscription ended" });
        yield* emit(OziJobCard, result.value);
        return;
      }
      if (flags.entity === "check") {
        const result = yield* client[OZI_WS_METHODS.checksSubscribe]({}).pipe(
          Stream.filter((checks) =>
            checks.some((check) => check.id === flags.id && check.state === flags.state),
          ),
          Stream.runHead,
          Effect.timeout(`${flags.timeout} seconds`),
        );
        if (Option.isNone(result))
          return yield* new ClientError({ operation: "check subscription ended" });
        return yield* emit(Schema.Array(OziCheck), result.value);
      }
      const threadId = ThreadId.make(flags.id);
      const { client: reader } = yield* connect(flags.baseDir);
      const result = yield* client[O.subscribeThread]({ threadId }).pipe(
        Stream.mapEffect((item) =>
          item.kind === "snapshot"
            ? Effect.succeed(item.projection)
            : reader[O.getThreadProjection]({ threadId }),
        ),
        Stream.filter((projection) => {
          const latest = projection.runs.findLast((run) => run.status !== "queued");
          if (flags.state.startsWith("text:"))
            return projection.messages.some((message) =>
              message.text.includes(flags.state.slice(5)),
            );
          if (flags.entity === "thread")
            return (
              latest?.status === flags.state ||
              (flags.state === "idle" &&
                !projection.runs.some((run) =>
                  ["preparing", "starting", "running", "waiting"].includes(run.status),
                ))
            );
          const encoded = encodeProjection(projection) as Record<string, unknown>;
          const records = encoded[flags.entity === "check" ? "checks" : "jobs"];
          return (
            Array.isArray(records) &&
            records.some(
              (record) =>
                record.id === flags.id &&
                (record.state === flags.state ||
                  record.status === flags.state ||
                  record.column === flags.state),
            )
          );
        }),
        Stream.runHead,
        Effect.timeout(`${flags.timeout} seconds`),
      );
      if (Option.isNone(result))
        return yield* new ClientError({ operation: "wait subscription ended" });
      yield* emit(OrchestrationV2ThreadProjection, result.value);
    }),
  ),
);

const checksCommand = Command.make("checks", {
  ...locationFlags,
  threadId: Argument.String("threadId").pipe(Argument.withSchema(ThreadId), Argument.optional),
}).pipe(
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const { client } = yield* connect(flags.baseDir);
      yield* emit(
        Schema.Array(OziCheck),
        yield* client[OZI_WS_METHODS.checksList](
          Option.isSome(flags.threadId) ? { threadId: flags.threadId.value } : {},
        ),
      );
    }),
  ),
);

const todosCommand = Command.make("todos", {
  ...locationFlags,
  configure: Flag.String("configure").pipe(Flag.optional),
  clear: Flag.Boolean("clear").pipe(Flag.withDefault(false)),
}).pipe(
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      if (flags.clear && Option.isSome(flags.configure))
        return yield* new ClientError({ operation: "requires either --configure or --clear" });
      const { client } = yield* connect(flags.baseDir);
      if (flags.clear || Option.isSome(flags.configure)) {
        const externalTodos = Option.isSome(flags.configure)
          ? yield* decodeTodoSettings(flags.configure.value)
          : null;
        yield* client[W.serverUpdateSettings]({ patch: { externalTodos } });
      }
      yield* emit(OziTodos, yield* client[J.todosGet]({}));
    }),
  ),
);

const duration = (value: string) => {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h|d|w)$/.exec(value);
  const units: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
  };
  const result = match ? Number(match[1]) * units[match[2]!]! : NaN;
  return Number.isSafeInteger(result) && result > 0
    ? Effect.succeed(result)
    : Effect.fail(new ClientError({ operation: "requires a duration such as 5m or 1h" }));
};
const scheduleJson = (task: ScheduledTask) => ({
  ...task,
  ...(task.webhook?.url == null ? {} : { webhookUrl: task.webhook.url }),
});
const schedulesCommand = Command.make("schedules", locationFlags).pipe(
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const { client } = yield* connect(flags.baseDir);
      const { tasks } = yield* client[W.scheduledTasksList]({});
      yield* print(tasks.map(scheduleJson));
    }),
  ),
);
const scheduleAddCommand = Command.make("add", {
  ...locationFlags,
  every: Flag.String("every").pipe(Flag.optional),
  at: Flag.String("at").pipe(Flag.optional),
  days: Flag.String("days").pipe(Flag.optional),
  webhook: Flag.Boolean("webhook").pipe(Flag.withDefault(false)),
  secretRef: Flag.String("secret-ref").pipe(Flag.withSchema(SecretRef), Flag.optional),
  filters: Flag.String("filter").pipe(Flag.atLeast(0)),
  replayKey: Flag.String("replay-key").pipe(Flag.optional),
  coalesceKey: Flag.String("coalesce-key").pipe(Flag.optional),
  coalesceWindow: Flag.String("coalesce-window").pipe(Flag.optional),
  prompt: Flag.String("prompt"),
}).pipe(
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      if (
        Number(Option.isSome(flags.every)) +
          Number(Option.isSome(flags.at)) +
          Number(flags.webhook) !==
        1
      )
        return yield* new ClientError({
          operation: "requires exactly one of --every, --at or --webhook",
        });
      if (Option.isSome(flags.days) && Option.isNone(flags.at))
        return yield* new ClientError({ operation: "--days requires --at" });
      if (
        !flags.webhook &&
        (Option.isSome(flags.secretRef) ||
          flags.filters.length ||
          Option.isSome(flags.replayKey) ||
          Option.isSome(flags.coalesceKey) ||
          Option.isSome(flags.coalesceWindow))
      )
        return yield* new ClientError({ operation: "webhook options require --webhook" });
      const schedule = yield* decodeSchedule(
        Option.isSome(flags.every)
          ? { type: "interval", everyMs: yield* duration(flags.every.value) }
          : Option.isSome(flags.at)
            ? {
                type: "fixed_time",
                timeOfDay: flags.at.value,
                ...(Option.isSome(flags.days)
                  ? { weekdays: flags.days.value.split(",").map(Number) }
                  : {}),
              }
            : {
                type: "webhook",
                ...(Option.isSome(flags.secretRef)
                  ? {
                      signature: {
                        header: "x-hub-signature-256",
                        encoding: "hex",
                        prefix: "sha256=",
                        secretRef: flags.secretRef.value,
                      },
                    }
                  : {}),
                filters: yield* Effect.forEach(flags.filters, (filter) =>
                  decodeWebhookFilter(filter),
                ),
                dedupe: {
                  ...(Option.isSome(flags.replayKey) ? { replayKey: flags.replayKey.value } : {}),
                  ...(Option.isSome(flags.coalesceKey)
                    ? { coalesceKey: flags.coalesceKey.value }
                    : {}),
                  ...(Option.isSome(flags.coalesceWindow)
                    ? {
                        coalesceWindowSeconds: (yield* duration(flags.coalesceWindow.value)) / 1000,
                      }
                    : {}),
                },
              },
      );
      const { client } = yield* connect(flags.baseDir);
      const main = yield* client[O.getThreadProjection]({ threadId: OZI_MAIN_THREAD_ID });
      const { task } = yield* client[W.scheduledTasksUpsert]({
        title: flags.prompt.split("\n")[0]!.slice(0, 80),
        prompt: flags.prompt,
        enabled: true,
        schedule,
        projectId: main.thread.projectId,
        threadId: OZI_MAIN_THREAD_ID,
        workspaceStrategy: { type: "root" },
        modelSelection: OZI_MAIN_SELECTION,
        runtimeMode: main.thread.runtimeMode,
        interactionMode: main.thread.interactionMode,
        createdBy: "user",
        creationSource: "cli",
      });
      yield* print(scheduleJson(task));
    }),
  ),
);
const scheduleIdFlags = {
  ...locationFlags,
  id: Argument.String("id").pipe(Argument.withSchema(ScheduledTaskId)),
};
const scheduleRmCommand = Command.make("rm", scheduleIdFlags).pipe(
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const { client } = yield* connect(flags.baseDir);
      yield* emit(
        ScheduledTaskDeleteResult,
        yield* client[W.scheduledTasksDelete]({ id: flags.id }),
      );
    }),
  ),
);

const repairCommands = ["mistakes", "replays", "fixes"].map((kind) =>
  Command.make(kind, locationFlags).pipe(
    Command.withHandler((flags) =>
      Effect.gen(function* () {
        const { state, token } = yield* connect(flags.baseDir);
        yield* print(
          yield* request(state.origin, token, "/api/ozi/repair", Schema.Unknown, { kind }),
        );
      }),
    ),
  ),
);
const undoCommand = Command.make("undo", { ...locationFlags, id: Argument.String("id") }).pipe(
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const { state, token } = yield* connect(flags.baseDir);
      yield* print(
        yield* request(state.origin, token, "/api/ozi/repair", Schema.Unknown, {
          kind: "undo",
          id: flags.id,
        }),
      );
    }),
  ),
);
const mistakeCommand = Command.make("mistake", {
  ...locationFlags,
  id: Argument.String("id"),
}).pipe(
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const { state, token } = yield* connect(flags.baseDir);
      const rows = yield* request(
        state.origin,
        token,
        "/api/ozi/repair",
        Schema.Array(Schema.Unknown),
        { kind: "mistakes", id: flags.id },
      );
      if (!rows[0]) return yield* new ClientError({ operation: "mistake not found" });
      yield* print(rows[0]);
    }),
  ),
);
const eventsCommand = Command.make("events", { ...locationFlags, id: Argument.String("id") }).pipe(
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const { state, token } = yield* connect(flags.baseDir);
      yield* print(
        yield* request(state.origin, token, "/api/ozi/repair", Schema.Unknown, {
          kind: "events",
          id: flags.id,
        }),
      );
    }),
  ),
);
const scheduleRunCommand = Command.make("run", scheduleIdFlags).pipe(
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const { client } = yield* connect(flags.baseDir);
      const result = yield* client[W.scheduledTasksRunNow]({ id: flags.id });
      yield* print(result);
    }),
  ),
);
const scheduleCommand = Command.make("schedule").pipe(
  Command.withSubcommands([scheduleAddCommand, scheduleRmCommand, scheduleRunCommand]),
);
const testClockCommand = Command.make("test-clock", {
  ...locationFlags,
  advance: Flag.String("advance"),
}).pipe(
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const { client } = yield* connect(flags.baseDir);
      yield* print(yield* client[J.clockAdvance]({ milliseconds: yield* duration(flags.advance) }));
    }),
  ),
);

const requestCommand = Command.make("request", {
  ...locationFlags,
  targets: Argument.String("target").pipe(Argument.variadic({ min: 1 })),
  method: Flag.Literals("method", ["GET", "POST"]).pipe(Flag.withDefault("GET")),
  payload: Flag.String("payload").pipe(Flag.withDefault("{}")),
}).pipe(
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const { context, state, token } = yield* connectTransport(flags.baseDir);
      const payload = yield* decodeRequestPayload(flags.payload);
      const group = RpcGroup.make(
        ...[...new Set(flags.targets.filter((target) => !target.startsWith("/")))].map((tag) =>
          Rpc.make(tag, {
            payload: Schema.Unknown,
            success: Schema.Unknown,
            error: Schema.Record(Schema.String, Schema.Unknown),
          }),
        ),
      );
      const client = yield* RpcClient.make(group).pipe(Effect.provide(context));
      const http = yield* HttpClient.HttpClient;
      const rows: Array<Record<string, unknown>> = [];
      for (const target of flags.targets) {
        if (!target.startsWith("/")) {
          rows.push(
            yield* client[target]!(payload).pipe(
              Effect.timeout("10 seconds"),
              Effect.matchCause({
                onSuccess: (result) => ({ target, ok: true, result }),
                onFailure: (cause) => ({ target, ok: false, error: Cause.pretty(cause) }),
              }),
            ),
          );
          continue;
        }
        const url = new URL(target, state.origin);
        if (url.origin !== new URL(state.origin).origin || url.username || url.password)
          return yield* new ClientError({ operation: "request must address this server" });
        let outgoing = (
          flags.method === "POST"
            ? HttpClientRequest.post(url.toString())
            : HttpClientRequest.get(url.toString())
        ).pipe(HttpClientRequest.setHeader("Authorization", "Bearer " + token));
        if (flags.method === "POST")
          outgoing = outgoing.pipe(
            HttpClientRequest.bodyText(yield* encodeJson(payload), "application/json"),
          );
        const response = yield* http.execute(outgoing);
        rows.push({ target, status: response.status, body: yield* response.text });
      }
      yield* print(rows);
    }),
  ),
);

export const clientCommands = [
  connectCommand,
  disconnectCommand,
  requestCommand,
  checksCommand,
  todosCommand,
  schedulesCommand,
  scheduleCommand,
  ...(process.env.OZI_TEST_CLOCK ? [testClockCommand] : []),
  ...repairCommands,
  undoCommand,
  mistakeCommand,
  eventsCommand,
  statusCommand,
  sayCommand,
  steerCommand,
  stopCommand,
  threadCommand,
  waitCommand,
  pairCommand,
  jobsCommand,
  jobCommand,
  answerCommand,
  closeCommand,
];
