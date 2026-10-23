import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { OZI_PI_INTERACTIVE_ERROR, OZI_WS_METHODS, OziMainPiError } from "@t3tools/contracts";
import { piMainAgentDir } from "@t3tools/provider-pi/server";
import * as Cause from "effect/Cause";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stdio from "effect/Stdio";
import * as Stream from "effect/Stream";
import { FetchHttpClient } from "effect/http";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import { homeConfig } from "./cli/config.ts";
import { connect, localServer } from "./cli/client.ts";
import { resolveBaseDir } from "./os-jank.ts";

const Settings = Schema.Struct({
  providerInstances: Schema.optional(
    Schema.Struct({
      pi: Schema.optional(
        Schema.Struct({
          config: Schema.optional(Schema.Struct({ binaryPath: Schema.optional(Schema.String) })),
        }),
      ),
    }),
  ),
});

const pi = Effect.fn("ozi.pi")(function* (args: ReadonlyArray<string>) {
  let explicit: string | undefined;
  const piArgs: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--") {
      piArgs.push(...args.slice(index));
      break;
    }
    if (arg === "--home" || arg === "--base-dir") {
      explicit = args[++index];
      if (explicit === undefined)
        return yield* new OziMainPiError({ message: `Missing value for ${arg}.` });
    } else piArgs.push(arg);
  }
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = yield* resolveBaseDir(explicit ?? (yield* homeConfig));
  if ((yield* fs.exists(path.join(home, "remote.json"))) && !(yield* localServer(home))) {
    if (piArgs.length === 0)
      return yield* new OziMainPiError({ message: OZI_PI_INTERACTIVE_ERROR });
    const { client } = yield* connect(Option.some(home));
    const result = yield* client[OZI_WS_METHODS.piRun]({ args: piArgs });
    const stdio = yield* Stdio.Stdio;
    yield* Stream.run(Stream.make(result.stdout), stdio.stdout());
    yield* Stream.run(Stream.make(result.stderr), stdio.stderr());
    return result.exitCode;
  }
  const stateDir = path.join(home, "userdata");
  const settings = yield* fs.readFileString(path.join(stateDir, "settings.json")).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Settings))),
    Effect.orElseSucceed(() => Settings.make({})),
  );
  const agentDir = piMainAgentDir(path.join(home, "caches"));
  yield* fs.makeDirectory(agentDir, { recursive: true });
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return yield* spawner.exitCode(
    ChildProcess.make(settings.providerInstances?.pi?.config?.binaryPath || "pi", piArgs, {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
      env: { PI_CODING_AGENT_DIR: agentDir },
      extendEnv: true,
    }),
  );
});

export const runPi = (args: ReadonlyArray<string>) =>
  NodeRuntime.runMain(
    pi(args).pipe(
      Effect.flatMap((code) =>
        Effect.sync(() => {
          process.exitCode = code;
        }),
      ),
      Effect.tapCause((cause) => {
        const error = Cause.squash(cause);
        return Console.error(
          (error instanceof Error ? error.message : String(error)).split(/[\r\n]/)[0],
        );
      }),
      Effect.scoped,
      Effect.provide(Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer)),
    ),
    { disableErrorReporting: true },
  );
