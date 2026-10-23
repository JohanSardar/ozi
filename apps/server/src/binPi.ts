import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { piMainAgentDir } from "@t3tools/provider-pi/server";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import { homeConfig } from "./cli/config.ts";
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
  const explicit = args[0] === "--home" || args[0] === "--base-dir" ? args[1] : undefined;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = yield* resolveBaseDir(explicit ?? (yield* homeConfig));
  const stateDir = path.join(home, "userdata");
  const settings = yield* fs.readFileString(path.join(stateDir, "settings.json")).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Settings))),
    Effect.orElseSucceed(() => Settings.make({})),
  );
  const agentDir = piMainAgentDir(path.join(home, "caches"));
  yield* fs.makeDirectory(agentDir, { recursive: true });
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return yield* spawner.exitCode(
    ChildProcess.make(
      settings.providerInstances?.pi?.config?.binaryPath || "pi",
      explicit === undefined ? args : args.slice(2),
      {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
        env: { PI_CODING_AGENT_DIR: agentDir },
        extendEnv: true,
      },
    ),
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
      Effect.provide(NodeServices.layer),
    ),
  );
