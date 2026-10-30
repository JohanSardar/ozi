import type { PiSettings } from "../settings.ts";
import { prepareOzi } from "./ozi.ts";
import { tokenizeCliArgs } from "@t3tools/shared/cliArgs";
import * as Effect from "effect/Effect";

export const piCliLaunch = Effect.fn("Pi.cliLaunch")(function* (
  settings: PiSettings,
  environment: NodeJS.ProcessEnv,
  baseDir: string,
  args: readonly string[],
) {
  const prepared = yield* prepareOzi({ ...settings, enabled: true }, environment, baseDir);
  const nativeCommand = new Set([
    "auth",
    "config",
    "install",
    "remove",
    "uninstall",
    "update",
    "list",
    "mcp",
  ]).has(args[0] ?? "");
  return {
    binary: prepared.settings.binaryPath || "pi",
    args: nativeCommand ? args : [...tokenizeCliArgs(prepared.settings.launchArgs), ...args],
    env: prepared.environment,
  };
});
