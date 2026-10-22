import * as Effect from "effect/Effect";
import { Command, GlobalFlag } from "effect/cli";

import * as ServerConfig from "../config.ts";
import { awaitLauncherLoss } from "../launcherWatch.ts";
import { runServer } from "../server.ts";
import { type CliServerFlags, resolveServerConfig, sharedServerCommandFlags } from "./config.ts";

const runServerCommand = Effect.fn("server.runServerCommand")(function* (
  flags: CliServerFlags,
  options?: {
    readonly startupPresentation?: ServerConfig.StartupPresentation;
    readonly forceAutoBootstrapProjectFromCwd?: boolean;
    readonly rejectRunningServer?: boolean;
  },
) {
  const logLevel = yield* GlobalFlag.LogLevel;
  const config = yield* resolveServerConfig(flags, logLevel, options);
  const run = runServer.pipe(Effect.provideService(ServerConfig.ServerConfig, config));
  if (config.mode !== "desktop" || config.desktopBootstrapToken === undefined) return yield* run;
  return yield* Effect.raceFirst(
    run,
    awaitLauncherLoss().pipe(
      // End like SIGTERM does (interrupt-only exit, so the runtime forces process exit).
      Effect.andThen(Effect.interrupt),
    ),
  );
});

export const serveCommand = Command.make("serve", { ...sharedServerCommandFlags }).pipe(
  Command.withDescription("Run the Ozi server."),
  Command.withHandler((flags) =>
    runServerCommand(flags, {
      startupPresentation: "headless",
      rejectRunningServer: true,
    }),
  ),
);
