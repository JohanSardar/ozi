import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import sharp from "sharp";
import { encodePngIco, WINDOWS_ICON_SIZES } from "./lib/icon-export.ts";

class StaleIcons extends Schema.TaggedError<StaleIcons>()("StaleIcons", {
  paths: Schema.Array(Schema.String),
}) {}

Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = path.resolve(import.meta.dirname, "..");
  const source = yield* fs.readFile(path.join(root, "assets/icon.svg"));
  const png = (size: number) =>
    Effect.promise(() => sharp(source).resize(size, size).png().toBuffer());
  const outputs = new Map<string, Uint8Array>();
  for (const [name, size] of [
    ["icon.png", 1024],
    ["favicon-16x16.png", 16],
    ["favicon-32x32.png", 32],
    ["apple-touch-icon.png", 180],
  ] as const) {
    outputs.set("assets/" + name, yield* png(size));
  }
  const ico = encodePngIco(
    yield* Effect.forEach(WINDOWS_ICON_SIZES, (size) =>
      png(size).pipe(Effect.map((contents) => ({ size, contents }))),
    ),
  );
  outputs.set("assets/icon.ico", ico);
  outputs.set("apps/web/public/favicon.ico", ico);
  for (const name of ["favicon-16x16.png", "favicon-32x32.png", "apple-touch-icon.png"])
    outputs.set("apps/web/public/" + name, outputs.get("assets/" + name)!);
  const stale: string[] = [];
  for (const [name, contents] of outputs) {
    const target = path.join(root, name);
    if (process.argv.includes("--check")) {
      const current = yield* fs
        .readFile(target)
        .pipe(Effect.catch(() => Effect.succeed(new Uint8Array())));
      if (!Buffer.from(current).equals(Buffer.from(contents))) stale.push(name);
    } else yield* fs.writeFile(target, contents);
  }
  if (stale.length) return yield* new StaleIcons({ paths: stale });
  yield* Console.log(
    process.argv.includes("--check") ? "Ozi icons are current." : "Ozi icons exported.",
  );
}).pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
