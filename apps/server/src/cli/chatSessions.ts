import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import * as NetService from "@t3tools/shared/Net";
import {
  ChatSessionResult,
  PiRpcCommand,
  ServerSettings,
  MessageId,
  ProviderInstanceId,
  ChatSessionRpcGroup,
  RuntimeRequestId,
  ProviderApprovalDecision,
  ProviderUserInputAnswers,
  ORCHESTRATION_PROTOCOL_QUERY_PARAM,
  ORCHESTRATION_PROTOCOL_VERSION,
} from "@t3tools/contracts";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Runtime from "effect/Runtime";
import * as References from "effect/References";
import * as Schema from "effect/Schema";
import * as Stdio from "effect/Stdio";
import * as Stream from "effect/Stream";
import * as RpcClient from "effect/rpc/RpcClient";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
import { Argument, Command, Flag, GlobalFlag } from "effect/cli";
import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../config.ts";
import { isProcessAlive, readPersistedServerRuntimeState } from "../serverRuntimeState.ts";
import { baseDirFlag, resolveCliAuthConfig } from "./config.ts";
import { readRemoteConnection } from "./remote.ts";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import { PiSettings } from "@t3tools/provider-pi/settings";
import { piCliLaunch } from "@t3tools/provider-pi/server";
import { mergeProviderInstanceEnvironment } from "@t3tools/provider-core/server/instanceEnvironment";
import packageJson from "../../package.json" with { type: "json" };

class SessionCliError extends Schema.TaggedError<SessionCliError>()("SessionCliError", {
  message: Schema.String,
}) {
  override readonly [Runtime.errorReported] = false;
}

const decodeCommandPayload = Schema.decodeEffect(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
);
const decodePiCommand = Schema.decodeUnknownEffect(PiRpcCommand);
const decodePiSettings = Schema.decodeEffect(PiSettings);
const decodeSettings = Schema.decodeEffect(Schema.fromJsonString(ServerSettings));
const makeClient = RpcClient.make(ChatSessionRpcGroup);
const decodeResponse = Schema.decodeEffect(
  Schema.fromJsonString(
    Schema.Struct({
      decision: Schema.optional(ProviderApprovalDecision),
      answers: Schema.optional(ProviderUserInputAnswers),
    }),
  ),
);
type SessionClient = Effect.Success<typeof makeClient>;
const withClient = Effect.fn("cli.sessions.withClient")(function* <A, E, R>(
  flags: { readonly baseDir: Option.Option<string> },
  run: (client: SessionClient) => Effect.Effect<A, E, R>,
) {
  const config = yield* resolveCliAuthConfig(flags, yield* GlobalFlag.LogLevel);
  const connect = Effect.fn("cli.sessions.connect")(function* (url: URL, token: string) {
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set(
      ORCHESTRATION_PROTOCOL_QUERY_PARAM,
      String(ORCHESTRATION_PROTOCOL_VERSION),
    );
    const protocol = RpcClient.layerProtocolSocket({ retryTransientErrors: false }).pipe(
      Layer.provide(
        Layer.mergeAll(
          RpcSerialization.layerJson,
          NodeSocket.layerWebSocket(url.href, {
            headers: { authorization: `Bearer ${token}` },
          }),
        ),
      ),
    );
    return yield* Effect.gen(function* () {
      return yield* run(yield* makeClient);
    }).pipe(Effect.provide(protocol));
  });
  const runtime = yield* readPersistedServerRuntimeState(config.serverRuntimeStatePath);
  if (Option.isNone(runtime) || !isProcessAlive(runtime.value.pid))
    return yield* Effect.gen(function* () {
      const remote = yield* readRemoteConnection(Option.some(config.baseDir));
      if (Option.isNone(remote))
        return yield* new SessionCliError({
          message: "Start Ozi or run `ozi connect <pairing-url>` before using sessions.",
        });
      return yield* connect(new URL("/mcp/sessions", remote.value.origin), remote.value.token).pipe(
        Effect.catchTags({
          RpcClientError: () =>
            new SessionCliError({
              message:
                "Remote session connection failed. Run `ozi connect <pairing-url> --access full-access` again and check the server version.",
            }),
        }),
      );
    }).pipe(Effect.scoped);
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const auth = yield* EnvironmentAuth.EnvironmentAuth;
      const session = yield* Effect.acquireRelease(
        auth.issueSession({ label: "ozi sessions CLI" }),
        (issued) => auth.revokeSession(issued.sessionId).pipe(Effect.ignore),
      );
      return yield* connect(new URL("/ws", runtime.value.origin), session.token);
    }),
  ).pipe(
    Effect.provide(
      EnvironmentAuth.layerRuntime.pipe(
        Layer.provide(ServerConfig.layer(config)),
        Layer.provide(Layer.succeed(References.MinimumLogLevel, "Error")),
      ),
    ),
  );
});

const report =
  (json: boolean) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.catch(
        (error) =>
          new SessionCliError({
            message:
              error instanceof Error ? error.message.split("\n")[0]! : "Session command failed.",
          }),
      ),
      Effect.tapError((error) =>
        Console.error(
          json
            ? JSON.stringify({ error: { code: "SessionCommandFailed", message: error.message } })
            : error.message,
        ),
      ),
    );
const jsonFlag = Flag.Boolean("json").pipe(Flag.withDefault(false));
const threadFlag = Flag.String("thread").pipe(Flag.optional);
const idArgument = Argument.String("id").pipe(Argument.optional);
const selectionFlags = {
  provider: Flag.String("provider").pipe(Flag.optional),
  model: Flag.String("model").pipe(Flag.optional),
};
const selection = Effect.fn("cli.sessions.selection")(function* (flags: {
  provider: Option.Option<string>;
  model: Option.Option<string>;
}) {
  if (Option.isSome(flags.provider) !== Option.isSome(flags.model))
    return yield* new SessionCliError({ message: "--provider and --model go together." });
  if (Option.isSome(flags.provider) && Option.isSome(flags.model))
    return { instanceId: ProviderInstanceId.make(flags.provider.value), model: flags.model.value };
  return undefined;
});
const printJson = (value: unknown) => Console.log(JSON.stringify(value));
const current = Effect.fn("cli.sessions.current")(function* (
  client: SessionClient,
  identifier?: string,
) {
  const { sessions = [] } = yield* client["chatSessions.execute"]({ action: "list" });
  if (identifier === undefined) {
    const latest = sessions
      .filter((session) => !session.archived)
      .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (latest !== undefined) return latest.threadId;
    const created = yield* client["chatSessions.execute"]({ action: "new" });
    return created.threadId!;
  }
  const exact = sessions.find((session) => session.threadId === identifier);
  if (exact !== undefined) return exact.threadId;
  const matches = sessions.filter(
    (session) =>
      session.threadId === identifier ||
      session.threadId.includes(identifier) ||
      session.title === identifier,
  );
  if (matches.length !== 1)
    return yield* new SessionCliError({
      message: matches.length === 0 ? "No matching session." : "Session name or id is ambiguous.",
    });
  return matches[0]!.threadId;
});
const output = (result: ChatSessionResult, json: boolean) =>
  json ? printJson(result) : Console.log(result.threadId ?? "Done.");

const list = Command.make("list", { baseDir: baseDirFlag, json: jsonFlag }).pipe(
  Command.withHandler((flags) =>
    report(flags.json)(
      withClient(
        flags,
        Effect.fn("cli.sessions.list")(function* (client) {
          const result = yield* client["chatSessions.execute"]({ action: "list" });
          if (flags.json) return yield* printJson(result);
          for (const session of result.sessions ?? [])
            yield* Console.log(`${session.threadId}  ${session.title}`);
        }),
      ),
    ),
  ),
);
const create = Command.make("new", {
  baseDir: baseDirFlag,
  json: jsonFlag,
  thread: threadFlag,
  title: Flag.String("title").pipe(Flag.optional),
  ...selectionFlags,
}).pipe(
  Command.withHandler((flags) =>
    report(flags.json)(
      withClient(
        flags,
        Effect.fn("cli.sessions.new")(function* (client) {
          const modelSelection = yield* selection(flags);
          return yield* output(
            yield* client["chatSessions.execute"]({
              action: "new",
              ...(Option.isSome(flags.thread)
                ? { threadId: yield* current(client, flags.thread.value) }
                : {}),
              ...(Option.isSome(flags.title) ? { title: flags.title.value } : {}),
              ...(modelSelection === undefined ? {} : { modelSelection }),
            }),
            flags.json,
          );
        }),
      ),
    ),
  ),
);
const operations = (["resume", "reload", "clone"] as const).map((action) =>
  Command.make(action, { baseDir: baseDirFlag, json: jsonFlag, id: idArgument }).pipe(
    Command.withHandler((flags) =>
      report(flags.json)(
        withClient(
          flags,
          Effect.fn(`cli.sessions.${action}`)(function* (client) {
            return yield* output(
              yield* client["chatSessions.execute"]({
                action,
                threadId: yield* current(client, Option.getOrUndefined(flags.id)),
              }),
              flags.json,
            );
          }),
        ),
      ),
    ),
  ),
);
const fork = Command.make("fork", {
  baseDir: baseDirFlag,
  json: jsonFlag,
  id: Argument.String("id"),
  message: Argument.String("message-id"),
}).pipe(
  Command.withHandler((flags) =>
    report(flags.json)(
      withClient(
        flags,
        Effect.fn("cli.sessions.fork")(function* (client) {
          return yield* output(
            yield* client["chatSessions.execute"]({
              action: "fork",
              threadId: yield* current(client, flags.id),
              messageId: MessageId.make(flags.message),
            }),
            flags.json,
          );
        }),
      ),
    ),
  ),
);
const inspect = Command.make("show", { baseDir: baseDirFlag, id: idArgument, json: jsonFlag }).pipe(
  Command.withHandler((flags) =>
    report(flags.json)(
      withClient(
        flags,
        Effect.fn("cli.sessions.show")(function* (client) {
          const result = yield* client["chatSessions.execute"]({
            action: "inspect",
            threadId: yield* current(client, Option.getOrUndefined(flags.id)),
          });
          return yield* printJson(result);
        }),
      ),
    ),
  ),
);
const importCommand = Command.make("import", {
  baseDir: baseDirFlag,
  json: jsonFlag,
  file: Argument.String("file"),
  thread: threadFlag,
  ...selectionFlags,
}).pipe(
  Command.withHandler((flags) =>
    report(flags.json)(
      withClient(
        flags,
        Effect.fn("cli.sessions.import")(function* (client) {
          const fs = yield* FileSystem.FileSystem;
          const content = yield* fs.readFileString(flags.file);
          const modelSelection = yield* selection(flags);
          return yield* output(
            yield* client["chatSessions.execute"]({
              action: "import",
              content,
              ...(Option.isSome(flags.thread)
                ? { threadId: yield* current(client, flags.thread.value) }
                : {}),
              ...(modelSelection === undefined ? {} : { modelSelection }),
            }),
            flags.json,
          );
        }),
      ),
    ),
  ),
);
const exportCommand = Command.make("export", {
  baseDir: baseDirFlag,
  json: jsonFlag,
  id: idArgument,
  format: Flag.Literals("format", ["html", "jsonl"]).pipe(Flag.withDefault("html")),
  output: Flag.String("output").pipe(Flag.optional),
}).pipe(
  Command.withHandler((flags) =>
    report(flags.json)(
      withClient(
        flags,
        Effect.fn("cli.sessions.export")(function* (client) {
          const result = yield* client["chatSessions.execute"]({
            action: "export",
            threadId: yield* current(client, Option.getOrUndefined(flags.id)),
            format: flags.format,
          });
          if (Option.isNone(flags.output))
            return yield* flags.json ? printJson(result) : Console.log(result.content ?? "");
          const fs = yield* FileSystem.FileSystem;
          yield* fs.writeFileString(flags.output.value, result.content ?? "", { mode: 0o600 });
          return yield* flags.json
            ? printJson({ output: flags.output.value })
            : Console.log(flags.output.value);
        }),
      ),
    ),
  ),
);

export const sessionCommand = Command.make("session").pipe(
  Command.withDescription("Create, branch, resume, import and export chat sessions."),
  Command.withSubcommands([
    list,
    create,
    ...operations,
    fork,
    inspect,
    importCommand,
    exportCommand,
  ]),
);

export const answerCommand = Command.make("answer", {
  baseDir: baseDirFlag,
  json: jsonFlag,
  thread: Flag.String("thread"),
  request: Argument.String("request-id"),
  response: Argument.String("response-json"),
}).pipe(
  Command.withDescription("Answer a print-mode request with decision or answers JSON."),
  Command.withHandler((flags) =>
    report(flags.json)(
      withClient(
        flags,
        Effect.fn("cli.answer")(function* (client) {
          const response = yield* decodeResponse(flags.response);
          const receipt = yield* client["chatSessions.answer"]({
            threadId: yield* current(client, flags.thread),
            requestId: RuntimeRequestId.make(flags.request),
            ...response,
          });
          yield* flags.json ? printJson(receipt) : Console.log("Answered.");
        }),
      ),
    ),
  ),
);

export const printCommand = Command.make("print", {
  baseDir: baseDirFlag,
  thread: threadFlag,
  json: jsonFlag,
  mode: Flag.Literals("mode", ["text", "json"]).pipe(Flag.withDefault("text")),
  files: Flag.String("file").pipe(Flag.atLeast(0)),
  prompts: Argument.String("prompt").pipe(Argument.variadic()),
}).pipe(
  Command.withDescription("Send prompts in order and print each run's last reply."),
  Command.withHandler((flags) =>
    report(flags.json || flags.mode === "json")(
      withClient(
        flags,
        Effect.fn("cli.print")(function* (client) {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const prompts = flags.prompts.filter((prompt) => !prompt.startsWith("@"));
          const paths = [
            ...flags.files,
            ...flags.prompts
              .filter((prompt) => prompt.startsWith("@"))
              .map((prompt) => prompt.slice(1)),
          ];
          if (!process.stdin.isTTY) {
            const stdio = yield* Stdio.Stdio;
            const text = yield* stdio.stdin.pipe(Stream.decodeText(), Stream.mkString);
            if (text.trim())
              prompts.splice(
                0,
                prompts.length === 0 ? 0 : 1,
                [text.trimEnd(), prompts[0]].filter(Boolean).join("\n\n"),
              );
          }
          if (prompts.length === 0)
            return yield* new SessionCliError({ message: "Provide a prompt or piped stdin." });
          const files = yield* Effect.forEach(
            paths,
            Effect.fn("cli.print.file")(function* (file) {
              const bytes = yield* fs.readFile(file);
              const extension = path.extname(file).toLowerCase();
              const mimeType =
                (
                  {
                    ".png": "image/png",
                    ".jpg": "image/jpeg",
                    ".jpeg": "image/jpeg",
                    ".gif": "image/gif",
                    ".webp": "image/webp",
                    ".txt": "text/plain",
                    ".md": "text/markdown",
                    ".pdf": "application/pdf",
                  } as Record<string, string>
                )[extension] ?? "application/octet-stream";
              return {
                name: path.basename(file),
                mimeType,
                base64: Buffer.from(bytes).toString("base64"),
              };
            }),
          );
          const threadId = yield* current(client, Option.getOrUndefined(flags.thread));
          for (const [index, text] of prompts.entries()) {
            yield* client["chatSessions.print"]({
              threadId,
              text,
              files: index === 0 ? files : [],
            }).pipe(
              Stream.runForEach((event) =>
                Effect.gen(function* () {
                  if (event.type === "event") {
                    if (flags.mode === "json") yield* Console.log(event.json);
                    return;
                  }
                  const { type: _type, answer, ...result } = event;
                  if (flags.json || flags.mode === "json") yield* printJson(result);
                  else if (event.status === "completed") yield* Console.log(event.text);
                  if (event.status !== "completed")
                    return yield* new SessionCliError({
                      message:
                        answer === undefined
                          ? `Run ${event.runId} ${event.status}.`
                          : `Waiting for an answer: ${answer}`,
                    });
                }),
              ),
            );
          }
        }),
      ),
    ),
  ),
);

export const mainCommand = Command.make("main", {
  baseDir: baseDirFlag,
  json: jsonFlag,
  thread: threadFlag,
  command: Argument.String("command"),
  payload: Flag.String("payload").pipe(Flag.withDefault("{}")),
}).pipe(
  Command.withDescription("Run an allowlisted Pi RPC command on a chat."),
  Command.withHandler((flags) =>
    report(flags.json)(
      withClient(
        flags,
        Effect.fn("cli.main")(function* (client) {
          const payload = yield* decodeCommandPayload(flags.payload);
          if (Object.hasOwn(payload, "type"))
            return yield* new SessionCliError({
              message: "--payload must omit type; select the command by name.",
            });
          const command = yield* decodePiCommand(
            { ...payload, type: flags.command },
            { onExcessProperty: "error" },
          );
          const result = yield* client["chatSessions.execute"]({
            action: "pi-rpc",
            threadId: yield* current(client, Option.getOrUndefined(flags.thread)),
            command,
          });
          yield* printJson(result.data ?? {});
        }),
      ),
    ),
  ),
);

export const piCommand = Command.make("pi", {
  baseDir: baseDirFlag,
  json: jsonFlag,
  thread: threadFlag,
  args: Argument.String("args").pipe(Argument.variadic()),
}).pipe(
  Command.withDescription(
    "Run Pi's CLI using the chat's agent directory. Use -- before Pi flags that overlap Ozi flags.",
  ),
  Command.withHandler((flags) =>
    report(flags.json)(
      Effect.gen(function* () {
        const config = yield* resolveCliAuthConfig(flags, yield* GlobalFlag.LogLevel);
        const runtime = yield* readPersistedServerRuntimeState(config.serverRuntimeStatePath);
        const local = Option.isSome(runtime) && isProcessAlive(runtime.value.pid);
        const remote = local
          ? Option.none()
          : yield* readRemoteConnection(Option.some(config.baseDir));
        if (!local && Option.isSome(remote)) {
          const result = yield* withClient(
            flags,
            Effect.fn("cli.pi.remote")(function* (client) {
              return yield* client["chatSessions.execute"]({
                action: "pi-cli",
                threadId: yield* current(client, Option.getOrUndefined(flags.thread)),
                args: flags.args,
              });
            }),
          );
          if (flags.json) yield* printJson(result);
          else {
            yield* Console.log(result.stdout ?? "");
            if (result.stderr) yield* Console.error(result.stderr);
          }
          process.exitCode = result.exitCode ?? 0;
          return;
        }
        const fs = yield* FileSystem.FileSystem;
        const settings = yield* fs.readFileString(config.settingsPath).pipe(
          Effect.catchIf(
            (error) => error.reason._tag === "NotFound",
            () => Effect.succeed("{}"),
          ),
          Effect.flatMap(decodeSettings),
        );
        const selected = local
          ? yield* withClient(
              flags,
              Effect.fn("cli.pi.current")(function* (client) {
                return yield* client["chatSessions.execute"]({
                  action: "inspect",
                  threadId: yield* current(client, Option.getOrUndefined(flags.thread)),
                });
              }),
            )
          : undefined;
        if (!local && Option.isSome(flags.thread))
          return yield* new SessionCliError({
            message: "Start Ozi to select a chat with --thread.",
          });
        const instanceId =
          selected?.modelSelection?.instanceId ??
          settings.defaultModelSelection?.instanceId ??
          ProviderInstanceId.make("ozi");
        const instance = settings.providerInstances[instanceId];
        if (instance?.driver !== "pi")
          return yield* new SessionCliError({ message: "Choose a Pi chat with --thread." });
        const launch = yield* piCliLaunch(
          yield* decodePiSettings(instance.config ?? {}),
          yield* mergeProviderInstanceEnvironment(instance.environment),
          config.baseDir,
        );
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        yield* Effect.scoped(
          Effect.gen(function* () {
            const child = yield* spawner.spawn(
              ChildProcess.make(launch.binary, flags.args, {
                env: launch.env,
                extendEnv: false,
                cwd: selected?.workingDirectory ?? config.cwd,
                stdin: "inherit",
                stdout: flags.json ? "pipe" : "inherit",
                stderr: flags.json ? "pipe" : "inherit",
              }),
            );
            const [stdout, stderr, code] = yield* Effect.all(
              [
                child.stdout.pipe(Stream.decodeText(), Stream.mkString),
                child.stderr.pipe(Stream.decodeText(), Stream.mkString),
                child.exitCode,
              ],
              { concurrency: "unbounded" },
            );
            if (flags.json) yield* printJson({ stdout, stderr, exitCode: Number(code) });
            process.exitCode = Number(code);
          }),
        );
      }),
    ),
  ),
);

export function runSessionCli() {
  if (process.argv[2] === "pi") {
    const wrapper: string[] = [];
    const args: string[] = [];
    const raw = process.argv.slice(3);
    for (let index = 0; index < raw.length; index++) {
      const arg = raw[index]!;
      if (arg === "--") {
        args.push(...raw.slice(index + 1));
        break;
      }
      if (arg === "--json") wrapper.push(arg);
      else if (arg === "--home" || arg === "--thread") {
        wrapper.push(arg);
        if (raw[index + 1] !== undefined) wrapper.push(raw[++index]!);
      } else if (arg.startsWith("--home=") || arg.startsWith("--thread=")) wrapper.push(arg);
      else args.push(arg);
    }
    process.argv.splice(3, process.argv.length - 3, ...wrapper, "--", ...args);
  }
  Command.run(
    Command.make("ozi").pipe(
      Command.withSubcommands([
        sessionCommand,
        printCommand,
        answerCommand,
        mainCommand,
        piCommand,
      ]),
    ),
    { version: packageJson.version },
  ).pipe(
    Effect.scoped,
    Effect.provide(Layer.mergeAll(NodeServices.layer, NetService.layer)),
    NodeRuntime.runMain,
  );
}
