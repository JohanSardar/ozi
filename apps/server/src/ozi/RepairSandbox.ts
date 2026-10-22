import * as HostProcess from "@t3tools/shared/HostProcess";
import { resolveCommandPath } from "@t3tools/shared/shell";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as ProcessRunner from "../processRunner.ts";
import { RepairError } from "./RepairModel.ts";
import { repairProgram, inferenceProgram, extensionProgram } from "./RepairProgram.ts";

export const ReplayEvidence = Schema.Struct({
  transcript: Schema.Array(Schema.String),
  effects: Schema.Array(Schema.Unknown),
  unknown: Schema.Array(Schema.String),
  loadout: Schema.Struct({
    provider: Schema.String,
    model: Schema.String,
    systemPromptSha256: Schema.String,
    loaded: Schema.Record(Schema.String, Schema.String),
  }),
  nativeFork: Schema.Boolean,
  prefixSha256: Schema.String,
});
export type ReplayEvidence = typeof ReplayEvidence.Type;

export class RepairSandbox extends Context.Service<
  RepairSandbox,
  {
    readonly run: (input: {
      directory: string;
      root: string;
      protectedRoot: string;
      frozen: string;
      binary: string;
      stage: "author" | "baseline" | "candidate" | "observer";
      driver: string;
      model: string;
      main: boolean;
      message: string;
      boundary: string;
      nativeId: string;
      case: unknown;
      attachments: ReadonlyArray<{ file: string; mimeType: string; type: string }>;
      effects: ReadonlyArray<unknown>;
      tools: ReadonlyArray<unknown>;
      options: ReadonlyArray<{ id: string; value: string | boolean }>;
      workerPrompt: string;
    }) => Effect.Effect<{ evidence: ReplayEvidence; command: ReadonlyArray<string> }, RepairError>;
  }
>()("ozi/ozi/RepairSandbox") {}

const isRepairError = Schema.is(RepairError);
const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const decodeEvidence = Schema.decodeEffect(Schema.fromJsonString(ReplayEvidence));

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const runner = yield* ProcessRunner.ProcessRunner;
  const environment = yield* HostProcess.Environment;
  const executable = yield* HostProcess.ExecutablePath;
  const platform = yield* HostProcess.Platform;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const run: RepairSandbox["Service"]["run"] = Effect.fn("RepairSandbox.run")(
    function* (input) {
      if (platform !== "linux") return yield* new RepairError({ reason: "requires-bwrap" });
      const binary = yield* resolveCommandPath(input.binary, { env: environment }).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, path),
      );
      if (!binary) return yield* new RepairError({ reason: "missing-provider" });
      const launcher = path.join(input.directory, "launcher");
      const provider = path.join(input.directory, "transport");
      const caseRoot = path.join(input.directory, "case");
      yield* fs.makeDirectory(launcher, { recursive: true });
      yield* fs.makeDirectory(provider, { recursive: true });
      yield* fs.makeDirectory(caseRoot, { recursive: true });
      yield* fs.writeFileString(path.join(launcher, "run.mjs"), repairProgram);
      yield* fs.writeFileString(path.join(launcher, "extension.mjs"), extensionProgram);
      const proxy = path.join(launcher, "inference.mjs");
      yield* fs.writeFileString(proxy, inferenceProgram);
      const socket = path.join(input.directory, "inference.sock");
      const failure = path.join(input.directory, "inference.failure");
      const process = yield* spawner.spawn(
        ChildProcess.make(executable, [proxy, socket, failure, input.driver], {
          env: environment,
          stdout: "pipe",
        }),
      );
      yield* process.stdout.pipe(Stream.runHead);
      const source = yield* fs.realPath(binary);
      const modulesIndex = source.indexOf("/node_modules/");
      const modules =
        modulesIndex < 0 ? undefined : source.slice(0, modulesIndex + "/node_modules".length);
      yield* fs.copyFile(source, path.join(provider, path.basename(binary)));
      yield* fs.chmod(path.join(provider, path.basename(binary)), 0o500);
      for (const name of yield* fs.readDirectory(path.dirname(source))) {
        if (!/\.(?:mjs|cjs|js)$/.test(name)) continue;
        const file = path.join(path.dirname(source), name);
        if ((yield* fs.stat(file)).type !== "File") continue;
        yield* fs.copyFile(file, path.join(provider, name));
      }
      yield* fs.copyFile(input.frozen, path.join(caseRoot, "session.jsonl"));
      if (input.attachments.length) {
        yield* fs.makeDirectory(path.join(caseRoot, "attachments"));
        for (const attachment of input.attachments)
          yield* fs.copyFile(
            path.join(path.dirname(input.frozen), "attachments", attachment.file),
            path.join(caseRoot, "attachments", attachment.file),
          );
      }
      yield* fs.writeFileString(
        path.join(caseRoot, "input.json"),
        yield* encodeJson({
          ...input,
          binary: path.basename(binary),
          executable:
            modules || source.startsWith("/usr/") ? source : `/transport/${path.basename(binary)}`,
        }),
      );
      const args = [
        "--unshare-all",
        "--die-with-parent",
        "--new-session",
        "--cap-drop",
        "ALL",
        "--clearenv",
        "--ro-bind",
        "/usr",
        "/usr",
        "--ro-bind",
        "/lib",
        "/lib",
        ...((yield* fs.exists("/lib64")) ? ["--ro-bind", "/lib64", "/lib64"] : []),
        "--symlink",
        "usr/bin",
        "/bin",
        "--symlink",
        "usr/sbin",
        "/sbin",
        "--proc",
        "/proc",
        "--dev",
        "/dev",
        "--tmpfs",
        "/tmp",
        "--tmpfs",
        "/home",
        "--dir",
        "/home/repair",
        "--dir",
        "/runtime",
        "--ro-bind",
        yield* fs.realPath(executable),
        "/runtime/node",
        "--ro-bind",
        provider,
        "/transport",
        "--ro-bind",
        launcher,
        "/launcher",
        "--ro-bind",
        caseRoot,
        "/case",
        "--bind",
        input.root,
        "/data",
        "--ro-bind",
        input.protectedRoot,
        "/data/protected",
        "--setenv",
        "PATH",
        "/runtime:/usr/bin:/bin",
        "--setenv",
        "HOME",
        "/home/repair",
        "--setenv",
        "CODEX_HOME",
        "/home/repair/codex",
        "--setenv",
        "CLAUDE_CONFIG_DIR",
        "/home/repair/claude",
        "--setenv",
        "PI_CODING_AGENT_DIR",
        "/home/repair/pi",
        "--setenv",
        "OZI_DATA_ROOT",
        "/data",
      ];
      if (environment.OZI_FAKE_SCRIPT) {
        yield* fs.copyFile(environment.OZI_FAKE_SCRIPT, path.join(caseRoot, "script.json"));
        args.push("--setenv", "OZI_FAKE_SCRIPT", "/case/script.json");
      }
      args.push("--ro-bind", socket, "/inference.sock");
      if (modules) args.push("--ro-bind", modules, modules);
      args.push("--chdir", "/data", "--remount-ro", "/");
      const command = ["bwrap", ...args, "/runtime/node", "/launcher/run.mjs"];
      const result = yield* runner.run({
        command: "bwrap",
        args: command.slice(1),
        env: {},
        timeout: "60 seconds",
        timeoutBehavior: "timedOutResult",
        maxOutputBytes: 1024 * 1024,
      });
      if (yield* fs.exists(failure))
        return yield* new RepairError({ reason: yield* fs.readFileString(failure) });
      if (result.timedOut)
        return yield* new RepairError({
          reason: "sandbox-timeout",
          cause: "bwrap timed out after 60000ms",
        });
      if (result.code !== 0)
        return yield* new RepairError({ reason: "sandbox-run-failed", cause: result });
      const evidence = yield* decodeEvidence(result.stdout.trim());
      return { evidence, command };
    },
    Effect.scoped,
    Effect.catchTags({
      ProcessTimeoutError: (cause) => new RepairError({ reason: "sandbox-timeout", cause }),
    }),
    Effect.mapError((cause) =>
      isRepairError(cause) ? cause : new RepairError({ reason: "sandbox-failed", cause }),
    ),
  );
  return RepairSandbox.of({ run });
});

export const layer = Layer.effect(RepairSandbox, make);
