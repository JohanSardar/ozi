import { ChatSessionError, ChatSessionResult, ThreadId, MessageId, ProviderInstanceId, WsRpcGroup, type ChatSessionInput } from "@t3tools/contracts";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Runtime from "effect/Runtime";
import * as Schema from "effect/Schema";
import * as Stdio from "effect/Stdio";
import * as Stream from "effect/Stream";
import * as Socket from "effect/socket/Socket";
import * as RpcClient from "effect/rpc/RpcClient";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
import { Argument, Command, Flag, GlobalFlag } from "effect/cli";
import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../config.ts";
import { readPersistedServerRuntimeState } from "../serverRuntimeState.ts";
import { baseDirFlag, resolveCliAuthConfig } from "./config.ts";

class SessionCliError extends Schema.TaggedError<SessionCliError>()("SessionCliError", { message: Schema.String }) {
  override readonly [Runtime.errorReported] = false;
}

const makeClient = RpcClient.make(WsRpcGroup);
type SessionClient = Effect.Success<typeof makeClient>;
const withClient = Effect.fn("cli.sessions.withClient")(function* <A, E, R>(
  flags: { readonly baseDir: Option.Option<string> },
  run: (client: SessionClient) => Effect.Effect<A, E, R>,
) {
  const config = yield* resolveCliAuthConfig(flags, yield* GlobalFlag.LogLevel);
  return yield* Effect.scoped(Effect.gen(function* () {
    const runtime = yield* readPersistedServerRuntimeState(config.serverRuntimeStatePath);
    if (Option.isNone(runtime)) return yield* new SessionCliError({ message: "Start the Ozi server before using sessions." });
    const auth = yield* EnvironmentAuth.EnvironmentAuth;
    const session = yield* Effect.acquireRelease(
      auth.issueMcpClientSession({ label: "ozi sessions CLI", access: "full-access", peerLink: false, client: { deviceType: "bot" } }),
      (issued) => auth.revokeSession(issued.sessionId).pipe(Effect.ignore),
    );
    const ticket = yield* auth.issueWebSocketTicket(session, { use: "rpc" });
    const url = new URL("/ws", runtime.value.origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("wsTicket", ticket.ticket);
    url.searchParams.set("orchestrationProtocol", "2");
    const protocol = RpcClient.layerProtocolSocket().pipe(Layer.provide(Layer.mergeAll(
      RpcSerialization.layerJson,
      Socket.layerWebSocket(url.href).pipe(Layer.provide(Socket.layerWebSocketConstructorGlobal)),
    )));
    return yield* Effect.gen(function* () { return yield* run(yield* makeClient); }).pipe(Effect.provide(protocol));
  })).pipe(Effect.provide(EnvironmentAuth.layerRuntime.pipe(Layer.provide(ServerConfig.layer(config)))));
});

const report = <A, E, R>(effect: Effect.Effect<A, E, R>) => effect.pipe(
  Effect.catch((error) => new SessionCliError({ message: error instanceof Error ? error.message.split("\n")[0]! : "Session command failed." })),
  Effect.tapError((error) => Console.error(error.message)),
);
const jsonFlag = Flag.Boolean("json").pipe(Flag.withDefault(false));
const threadFlag = Flag.String("thread").pipe(Flag.optional);
const idArgument = Argument.String("id").pipe(Argument.optional);
const selectionFlags = {
  provider: Flag.String("provider").pipe(Flag.optional),
  model: Flag.String("model").pipe(Flag.optional),
};
const selection = (flags: { provider: Option.Option<string>; model: Option.Option<string> }) => {
  if (Option.isSome(flags.provider) && Option.isSome(flags.model)) return { instanceId: ProviderInstanceId.make(flags.provider.value), model: flags.model.value };
  return undefined;
};
const printJson = (value: unknown) => Console.log(JSON.stringify(value));
const current = Effect.fn("cli.sessions.current")(function* (client: SessionClient, identifier?: string) {
  const { sessions = [] } = yield* client["chatSessions.execute"]({ action: "list" });
  if (identifier === undefined) {
    const latest = sessions.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (latest !== undefined) return latest.threadId;
    const created = yield* client["chatSessions.execute"]({ action: "new" });
    return created.threadId!;
  }
  const matches = sessions.filter((session) => session.threadId === identifier || session.threadId.includes(identifier) || session.title === identifier);
  if (matches.length !== 1) return yield* new SessionCliError({ message: matches.length === 0 ? "No matching session." : "Session name or id is ambiguous." });
  return matches[0]!.threadId;
});
const output = (result: ChatSessionResult, json: boolean) => json ? printJson(result) : Console.log(result.threadId ?? "Done.");

const list = Command.make("list", { baseDir: baseDirFlag, json: jsonFlag }).pipe(Command.withHandler((flags) => report(withClient(flags, Effect.fn("cli.sessions.list")(function* (client) {
  const result = yield* client["chatSessions.execute"]({ action: "list" });
  if (flags.json) return yield* printJson(result);
  for (const session of result.sessions ?? []) yield* Console.log(`${session.threadId}  ${session.title}`);
})))));
const create = Command.make("new", { baseDir: baseDirFlag, json: jsonFlag, thread: threadFlag, title: Flag.String("title").pipe(Flag.optional), ...selectionFlags }).pipe(Command.withHandler((flags) => report(withClient(flags, Effect.fn("cli.sessions.new")(function* (client) {
  return yield* output(yield* client["chatSessions.execute"]({ action: "new", ...(Option.isSome(flags.thread) ? { threadId: yield* current(client, flags.thread.value) } : {}), ...(Option.isSome(flags.title) ? { title: flags.title.value } : {}), ...(selection(flags) === undefined ? {} : { modelSelection: selection(flags) }) }), flags.json);
})))));
const operations = (["resume", "reload", "clone"] as const).map((action) => Command.make(action, { baseDir: baseDirFlag, json: jsonFlag, id: idArgument }).pipe(Command.withHandler((flags) => report(withClient(flags, Effect.fn(`cli.sessions.${action}`)(function* (client) {
  return yield* output(yield* client["chatSessions.execute"]({ action, threadId: yield* current(client, Option.getOrUndefined(flags.id)) }), flags.json);
}))))));
const fork = Command.make("fork", { baseDir: baseDirFlag, json: jsonFlag, id: Argument.String("id"), message: Argument.String("message-id") }).pipe(Command.withHandler((flags) => report(withClient(flags, Effect.fn("cli.sessions.fork")(function* (client) {
  return yield* output(yield* client["chatSessions.execute"]({ action: "fork", threadId: yield* current(client, flags.id), messageId: MessageId.make(flags.message) }), flags.json);
})))));
const inspect = Command.make("show", { baseDir: baseDirFlag, id: idArgument, json: jsonFlag }).pipe(Command.withHandler((flags) => report(withClient(flags, Effect.fn("cli.sessions.show")(function* (client) {
  const result = yield* client["chatSessions.execute"]({ action: "inspect", threadId: yield* current(client, Option.getOrUndefined(flags.id)) });
  return yield* printJson(result);
})))));
const importCommand = Command.make("import", { baseDir: baseDirFlag, json: jsonFlag, file: Argument.String("file"), thread: threadFlag, ...selectionFlags }).pipe(Command.withHandler((flags) => report(withClient(flags, Effect.fn("cli.sessions.import")(function* (client) {
  const fs = yield* FileSystem.FileSystem;
  const content = yield* fs.readFileString(flags.file);
  return yield* output(yield* client["chatSessions.execute"]({ action: "import", content, ...(Option.isSome(flags.thread) ? { threadId: yield* current(client, flags.thread.value) } : {}), ...(selection(flags) === undefined ? {} : { modelSelection: selection(flags) }) }), flags.json);
})))));
const exportCommand = Command.make("export", { baseDir: baseDirFlag, json: jsonFlag, id: idArgument, format: Flag.Literals("format", ["html", "jsonl"]).pipe(Flag.withDefault("html")), output: Flag.String("output").pipe(Flag.optional) }).pipe(Command.withHandler((flags) => report(withClient(flags, Effect.fn("cli.sessions.export")(function* (client) {
  const result = yield* client["chatSessions.execute"]({ action: "export", threadId: yield* current(client, Option.getOrUndefined(flags.id)), format: flags.format });
  if (Option.isNone(flags.output)) return yield* flags.json ? printJson(result) : Console.log(result.content ?? "");
  const fs = yield* FileSystem.FileSystem;
  yield* fs.writeFileString(flags.output.value, result.content ?? "", { mode: 0o600 });
  return yield* flags.json ? printJson({ output: flags.output.value }) : Console.log(flags.output.value);
})))));

export const sessionCommand = Command.make("session").pipe(Command.withDescription("Create, branch, resume, import and export chat sessions."), Command.withSubcommands([list, create, ...operations, fork, inspect, importCommand, exportCommand]));

export const printCommand = Command.make("print", {
  baseDir: baseDirFlag, thread: threadFlag, json: jsonFlag,
  mode: Flag.Literals("mode", ["text", "json"]).pipe(Flag.withDefault("text")),
  files: Flag.String("file").pipe(Flag.variadic),
  prompts: Argument.String("prompt").pipe(Argument.variadic),
}).pipe(Command.withDescription("Send prompts in order and print each run's last reply."), Command.withHandler((flags) => report(withClient(flags, Effect.fn("cli.print")(function* (client) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const prompts = flags.prompts.filter((prompt) => !prompt.startsWith("@"));
  const paths = [...flags.files, ...flags.prompts.filter((prompt) => prompt.startsWith("@")).map((prompt) => prompt.slice(1))];
  if (!process.stdin.isTTY) {
    const stdio = yield* Stdio.Stdio;
    const text = yield* stdio.stdin.pipe(Stream.decodeText(), Stream.mkString);
    if (text.trim()) prompts.splice(0, prompts.length === 0 ? 0 : 1, [text.trimEnd(), prompts[0]].filter(Boolean).join("\n\n"));
  }
  if (prompts.length === 0) return yield* new SessionCliError({ message: "Provide a prompt or piped stdin." });
  const files = yield* Effect.forEach(paths, Effect.fn("cli.print.file")(function* (file) {
    const bytes = yield* fs.readFile(file);
    const extension = path.extname(file).toLowerCase();
    const mimeType = ({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".txt": "text/plain", ".md": "text/markdown", ".pdf": "application/pdf" } as Record<string, string>)[extension] ?? "application/octet-stream";
    return { name: path.basename(file), mimeType, base64: Buffer.from(bytes).toString("base64") };
  }));
  const threadId = yield* current(client, Option.getOrUndefined(flags.thread));
  for (const [index, text] of prompts.entries()) {
    yield* client["chatSessions.print"]({ threadId, text, files: index === 0 ? files : [] }).pipe(Stream.runForEach((event) => Effect.gen(function* () {
      if (event.type === "event") { if (flags.mode === "json") yield* Console.log(event.json); return; }
      const { type: _type, answer, ...result } = event;
      if (flags.json || flags.mode === "json") yield* printJson(result);
      else if (event.status === "completed") yield* Console.log(event.text);
      if (event.status !== "completed") return yield* new SessionCliError({ message: answer === undefined ? `Run ${event.runId} ${event.status}.` : `Waiting for an answer: ${answer}` });
    })));
  }
})))));
