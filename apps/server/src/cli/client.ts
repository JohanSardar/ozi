import {
  AuthPairingCredentialResult,
  AuthWebSocketTicketResult,
  ChatAttachment,
  ChatAttachmentId,
  CommandId,
  MessageId,
  ProviderInstanceId,
  ORCHESTRATION_V2_WS_METHODS as O,
  OrchestrationV2DispatchCommandResult,
  OrchestrationV2ShellSnapshot,
  OrchestrationV2ThreadProjection,
  ServerConfig,
  ThreadId,
  WS_METHODS as W,
  WsRpcGroup,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
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
import { RpcClient, RpcSerialization } from "effect/rpc";
import { OwnerCredential } from "../ozi/OwnerCredential.ts";
import { resolveBaseDir } from "../os-jank.ts";
import { isProcessAlive, readPersistedServerRuntimeState } from "../serverRuntimeState.ts";
import { buildPairingUrl } from "../startupAccess.ts";
import { baseDirFlag, homeConfig } from "./config.ts";

const locationFlags = { baseDir: baseDirFlag, json: Flag.Boolean("json") };
const threadFlag = Flag.String("thread").pipe(Flag.withSchema(ThreadId), Flag.optional);
const makeClient = RpcClient.make(WsRpcGroup);
type Client = Effect.Success<typeof makeClient>;

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const encodePairing = Schema.encodeEffect(AuthPairingCredentialResult);
const encodeProjection = Schema.encodeSync(OrchestrationV2ThreadProjection);

class ClientError extends Schema.TaggedError<ClientError>()("OziClientError", {
  operation: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message() {
    return `Ozi ${this.operation}.`;
  }
}

const request = Effect.fn("ozi.request")(function* <A>(
  origin: string,
  token: string,
  path: string,
  schema: Schema.Codec<A, unknown>,
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
  return yield* HttpClientResponse.schemaBodyJson(schema)(
    yield* HttpClientResponse.filterStatusOk(response),
  );
});

const connect = Effect.fn("ozi.connect")(function* (baseDir: Option.Option<string>) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = yield* resolveBaseDir(Option.getOrUndefined(baseDir) ?? (yield* homeConfig));
  for (const variant of ["userdata", "dev"]) {
    const dir = path.join(home, variant);
    const state = yield* readPersistedServerRuntimeState(path.join(dir, "server-runtime.json"));
    if (Option.isNone(state) || !isProcessAlive(state.value.pid)) continue;
    const owner = yield* fs
      .readFileString(path.join(dir, "owner.json"))
      .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(OwnerCredential))));
    const { ticket } = yield* request(
      state.value.origin,
      owner.token,
      "/api/auth/websocket-ticket",
      AuthWebSocketTicketResult,
    );
    const url = new URL("/ws", state.value.origin);
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
    const client = yield* makeClient.pipe(Effect.provide(context));
    return { client, state: state.value, token: owner.token };
  }
  return yield* new ClientError({ operation: "found no running server; start ozi serve" });
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
  shell.threads.toSorted(
    (a, b) => DateTime.toEpochMillis(b.updatedAt) - DateTime.toEpochMillis(a.updatedAt),
  )[0];

const targetThread = Effect.fn("ozi.targetThread")(function* (
  client: Client,
  id: Option.Option<ThreadId>,
  create = false,
) {
  if (Option.isSome(id)) return id.value;
  const main = mainThread(yield* snapshot(client));
  if (main) return main.id;
  if (!create) return yield* new ClientError({ operation: "has no main thread" });
  const { projectId } = yield* client[W.projectsEnsureScratch]({});
  const launched = yield* client[O.launchThread]({
    commandId: CommandId.make(yield* (yield* Crypto.Crypto).randomUUIDv4()),
    projectId,
    title: "Main",
    creationSource: "cli",
    generateTitle: false,
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-6.1-sol",
      options: [],
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    workspaceStrategy: { type: "root" },
  });
  return launched.threadId;
});

const print = (value: unknown) => encodeJson(value).pipe(Effect.flatMap(Console.log));
const emit = <A, E>(schema: Schema.Codec<A, E>, value: A) =>
  Schema.encodeEffect(schema)(value).pipe(Effect.flatMap(print));

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
  const threadId = yield* targetThread(client, flags.thread ?? Option.none(), !steer);
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
  const active = projection.runs.find((run) =>
    ["preparing", "starting", "running", "waiting"].includes(run.status),
  );
  if (steer && !active) return yield* new ClientError({ operation: "has no active turn to steer" });
  const result = yield* client[O.dispatchCommand]({
    type: "message.dispatch",
    commandId: CommandId.make(yield* (yield* Crypto.Crypto).randomUUIDv4()),
    threadId,
    messageId: MessageId.make(yield* (yield* Crypto.Crypto).randomUUIDv4()),
    text: flags.text,
    attachments,
    createdBy: "user",
    creationSource: "cli",
    ...(steer ? { deliveryIntent: "steer" as const } : {}),
    dispatchMode:
      steer && active
        ? { type: "steer_active", targetRunId: active.id }
        : active
          ? { type: "queue_after_active" }
          : { type: "start_immediately" },
  });
  yield* emit(OrchestrationV2DispatchCommandResult, result);
});

const sayCommand = Command.make("say", {
  ...locationFlags,
  text: Argument.String("text"),
  files: Flag.String("file").pipe(Flag.atLeast(0)),
}).pipe(Command.withHandler((flags) => send(flags)));
const steerCommand = Command.make("steer", {
  ...locationFlags,
  text: Argument.String("text"),
  thread: threadFlag,
}).pipe(Command.withHandler((flags) => send(flags, true)));
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
}).pipe(
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const { client } = yield* connect(flags.baseDir);
      if (Option.isSome(flags.provider) || Option.isSome(flags.model)) {
        const current = yield* client[O.getThreadProjection]({ threadId: flags.id });
        yield* client[O.dispatchCommand]({
          type: "thread.model-selection.set",
          commandId: CommandId.make(yield* (yield* Crypto.Crypto).randomUUIDv4()),
          threadId: flags.id,
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
      yield* emit(
        OrchestrationV2ThreadProjection,
        yield* client[O.getThreadProjection]({ threadId: flags.id }),
      );
    }),
  ),
);

const waitCommand = Command.make("wait", {
  ...locationFlags,
  entity: Argument.Literals("entity", ["thread", "job", "check"]),
  id: Argument.String("id"),
  state: Argument.String("state"),
  timeout: Flag.Finite("timeout").pipe(
    Flag.withSchema(Schema.Number.check(Schema.isGreaterThan(0))),
    Flag.withDefault(30),
  ),
}).pipe(
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const { client } = yield* connect(flags.baseDir);
      const threadId = ThreadId.make(flags.id);
      const result = yield* client[O.subscribeThread]({ threadId }).pipe(
        Stream.mapEffect((item) =>
          item.kind === "snapshot"
            ? Effect.succeed(item.projection)
            : client[O.getThreadProjection]({ threadId }),
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

export const clientCommands = [
  statusCommand,
  sayCommand,
  steerCommand,
  stopCommand,
  threadCommand,
  waitCommand,
  pairCommand,
];
