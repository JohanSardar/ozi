import type { PiSettings } from "../settings.ts";
import { bundledPiBinary } from "./ozi.ts";
import * as Path from "effect/Path";
import * as Effect from "effect/Effect";

export const piCliLaunch = Effect.fn("Pi.cliLaunch")(function* (
  settings: PiSettings,
  environment: NodeJS.ProcessEnv,
  baseDir: string,
) {
  const path = yield* Path.Path;
  return {
    binary:
      settings.harness === "ozi" && (!settings.binaryPath || settings.binaryPath === "pi")
        ? bundledPiBinary
        : settings.binaryPath || "pi",
    env:
      settings.harness === "ozi"
        ? {
            ...environment,
            PI_CODING_AGENT_DIR: path.join(baseDir, "agents", "ozi"),
            OZI_DATA_ROOT: settings.dataRoot || path.join(baseDir, "harness"),
          }
        : environment,
  };
});
