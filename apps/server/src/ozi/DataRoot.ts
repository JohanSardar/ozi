import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";

export const dataRootPermit = Semaphore.makeUnsafe(1);

class DataRootError extends Schema.TaggedError<DataRootError>()("DataRootError", {
  cause: Schema.Defect(),
}) {
  override get message() {
    return "Failed to initialize the Ozi data root.";
  }
}

export class DataRoot extends Context.Service<
  DataRoot,
  { readonly initialize: Effect.Effect<void, DataRootError> }
>()("ozi/ozi/DataRoot") {}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const runner = yield* ProcessRunner.ProcessRunner;
  const initialize = Effect.fn("DataRoot.initialize")(function* () {
    const entries = yield* fs
      .readDirectory(config.dataRoot)
      .pipe(
        Effect.catch((error) =>
          error.reason._tag === "NotFound" ? Effect.succeed([]) : Effect.fail(error),
        ),
      );
    if (entries.length > 0) return;
    const files = [
      "prompt.md",
      "protected/approvals.md",
      "protected/contacts.md",
      "protected/credentials.md",
    ];
    const contents = yield* Effect.forEach(files, (file) =>
      fs.readFileString(path.join(import.meta.dirname, "defaults", file)),
    );
    for (const directory of ["skills", "protected/cases"])
      yield* fs.makeDirectory(path.join(config.dataRoot, directory), { recursive: true });
    for (const [index, file] of files.entries())
      yield* fs.writeFileString(path.join(config.dataRoot, file), contents[index]!, { flag: "wx" });
    for (const args of [
      ["init", "--initial-branch=main", "--template="],
      ["add", "--", ...files],
      [
        "-c",
        "user.name=Ozi",
        "-c",
        "user.email=ozi@localhost",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "core.hooksPath=.git/hooks",
        "commit",
        "-m",
        "Initialize Ozi data root",
      ],
    ]) {
      const result = yield* runner.run({
        command: "git",
        args,
        cwd: config.dataRoot,
        timeout: "15 seconds",
      });
      if (result.code !== 0) return yield* new DataRootError({ cause: result.stderr });
    }
  });
  return DataRoot.of({
    initialize: initialize().pipe(Effect.mapError((cause) => new DataRootError({ cause }))),
  });
});

export const layer = Layer.effect(DataRoot, make);
