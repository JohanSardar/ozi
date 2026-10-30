import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

export const revision = Effect.fn("PiConfig.revision")(function* (baseDir: string) {
  const fs = yield* FileSystem.FileSystem;
  const file = (yield* Path.Path).join(baseDir, "pi-config-revision");
  return yield* fs.readFileString(file).pipe(
    Effect.catchIf(
      (error) => error.reason._tag === "NotFound",
      () => Effect.succeed(""),
    ),
  );
});

export const invalidate = Effect.fn("PiConfig.invalidate")(function* (baseDir: string) {
  const fs = yield* FileSystem.FileSystem;
  const file = (yield* Path.Path).join(baseDir, "pi-config-revision");
  const crypto = yield* Crypto.Crypto;
  yield* fs.makeDirectory(baseDir, { recursive: true });
  yield* fs.writeFileString(file, yield* crypto.randomUUIDv4());
});
