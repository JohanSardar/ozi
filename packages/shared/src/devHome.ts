import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

export const resolveGitWorktreePath = Effect.fn("devHome.resolveGitWorktreePath")(function* (
  cwd: string,
): Effect.fn.Return<string | undefined, never, FileSystem.FileSystem | Path.Path> {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  let directory = path.resolve(cwd);
  for (;;) {
    if (yield* fs.exists(path.join(directory, ".git")).pipe(Effect.orElseSucceed(() => false))) {
      return directory;
    }
    const parent = path.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
});

export const resolveCheckoutOziHome = Effect.fn("devHome.resolveCheckoutOziHome")(function* (
  cwd: string,
): Effect.fn.Return<string | undefined, never, FileSystem.FileSystem | Path.Path> {
  const checkout = yield* resolveGitWorktreePath(cwd);
  const path = yield* Path.Path;
  return checkout === undefined ? undefined : path.join(checkout, ".ozi");
});
