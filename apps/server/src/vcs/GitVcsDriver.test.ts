import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import { ChildProcessSpawner } from "effect/process";
import { assert, it } from "@effect/vitest";

import { GitCommandError } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as GitVcsDriver from "./GitVcsDriver.ts";
import * as VcsProcess from "./VcsProcess.ts";
import { runVcsDriverContractSuite } from "./testing/VcsDriverContractHarness.ts";

const layerServerConfig = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3-git-vcs-contract-",
});
const layerGitContract = Layer.mergeAll(GitVcsDriver.layerVcs, GitVcsDriver.layer).pipe(
  Layer.provide(layerServerConfig),
  Layer.provideMerge(VcsProcess.layer),
  Layer.provideMerge(NodeServices.layer),
);

const runGit = (cwd: string, args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const driver = yield* GitVcsDriver.GitVcsDriver;
    yield* driver.execute({
      operation: "GitVcsDriver.contract.git",
      cwd,
      args,
      timeoutMs: 10_000,
    });
  });

type GitContractError = GitCommandError | PlatformError.PlatformError;

runVcsDriverContractSuite<GitVcsDriver.GitVcsDriver, GitContractError>({
  name: "Git",
  kind: "git",
  layer: layerGitContract,
  fixture: {
    createRepo: (cwd) =>
      Effect.gen(function* () {
        yield* runGit(cwd, ["init"]);
        yield* runGit(cwd, ["config", "user.email", "test@test.com"]);
        yield* runGit(cwd, ["config", "user.name", "Test"]);
      }),
    writeFile: (cwd, relativePath, contents) =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const absolutePath = path.join(cwd, relativePath);
        yield* fileSystem.makeDirectory(path.dirname(absolutePath), { recursive: true });
        yield* fileSystem.writeFileString(absolutePath, contents);
      }),
    trackFile: (cwd, relativePath) => runGit(cwd, ["add", relativePath]),
    commit: (cwd, message) => runGit(cwd, ["commit", "-m", message]),
    ignorePath: (cwd, pattern) =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* fileSystem.writeFileString(path.join(cwd, ".gitignore"), `${pattern}\n`);
      }),
  },
});

it.effect("lists the fetch and push URLs of a partial clone remote", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const cwd = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "t3-partial-clone-remotes-",
    });
    const driver = yield* GitVcsDriver.makeVcsDriverShape();
    yield* runGit(cwd, ["init"]);
    yield* runGit(cwd, ["remote", "add", "origin", "https://github.com/pingdotgg/t3code.git"]);
    yield* runGit(cwd, [
      "remote",
      "set-url",
      "--push",
      "origin",
      "git@github.com:octocat/t3code.git",
    ]);
    yield* runGit(cwd, ["config", "remote.origin.promisor", "true"]);
    yield* runGit(cwd, ["config", "remote.origin.partialclonefilter", "blob:none"]);

    const result = yield* driver.listRemotes(cwd);
    assert.deepEqual(result.remotes, [
      {
        name: "origin",
        url: "https://github.com/pingdotgg/t3code.git",
        pushUrl: Option.some("git@github.com:octocat/t3code.git"),
        isPrimary: true,
      },
    ]);
  }).pipe(Effect.scoped, Effect.provide(layerGitContract)),
);

it.effect("GitVcsDriver forwards execute env to the VCS process", () => {
  let observedEnv: NodeJS.ProcessEnv | undefined;
  let observedAppendTruncationMarker: boolean | undefined;
  let observedOutputMode: VcsProcess.VcsProcessInput["outputMode"];

  return Effect.gen(function* () {
    const driver = yield* GitVcsDriver.makeVcsDriverShape();

    yield* driver.execute({
      operation: "GitVcsDriver.test.env",
      cwd: "/repo",
      args: ["status"],
      env: {
        GIT_INDEX_FILE: "/tmp/t3-index",
      },
      appendTruncationMarker: true,
      outputMode: "error",
    });

    assert.deepStrictEqual(observedEnv, {
      GIT_INDEX_FILE: "/tmp/t3-index",
    });
    assert.strictEqual(observedAppendTruncationMarker, true);
    assert.strictEqual(observedOutputMode, "error");
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        NodeServices.layer,
        Layer.mock(VcsProcess.VcsProcess)({
          run: (input) =>
            Effect.sync(() => {
              observedEnv = input.env;
              observedAppendTruncationMarker = input.appendTruncationMarker;
              observedOutputMode = input.outputMode;
              return {
                exitCode: ChildProcessSpawner.ExitCode(0),
                stdout: "",
                stderr: "",
                stdoutTruncated: false,
                stderrTruncated: false,
              };
            }),
        }),
      ),
    ),
  );
});

// The real VCS process, spawning `command` wherever the driver runs git.
const vcsProcessSpawning = (command: string) =>
  Layer.effect(
    VcsProcess.VcsProcess,
    Effect.map(VcsProcess.make, (vcsProcess) =>
      VcsProcess.VcsProcess.of({ run: (input) => vcsProcess.run({ ...input, command }) }),
    ),
  ).pipe(Layer.provide(ProcessRunner.layer), Layer.provideMerge(NodeServices.layer));

it.effect("GitVcsDriver treats a missing git executable as outside any repository", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-missing-git-" });
    const driver = yield* GitVcsDriver.makeVcsDriverShape().pipe(
      Effect.provide(vcsProcessSpawning(path.join(cwd, "git"))),
    );

    assert.strictEqual(yield* driver.isInsideWorkTree(cwd), false);
    assert.strictEqual(yield* driver.detectRepository(cwd), null);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect.skipIf(HostProcess.Platform.defaultValue() === "win32")(
  "GitVcsDriver still fails detection when git exists but cannot be spawned",
  () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      // A file without the execute bit fails to spawn with a permission error.
      const notExecutable = yield* fileSystem.makeTempFileScoped({ prefix: "t3-git-" });
      const driver = yield* GitVcsDriver.makeVcsDriverShape().pipe(
        Effect.provide(vcsProcessSpawning(notExecutable)),
      );

      const error = yield* driver.isInsideWorkTree(process.cwd()).pipe(Effect.flip);
      assert.strictEqual(error._tag, "VcsProcessSpawnError");
      const detectionError = yield* driver.detectRepository(process.cwd()).pipe(Effect.flip);
      assert.strictEqual(detectionError._tag, "VcsProcessSpawnError");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
