import { Command, Flag } from "effect/cli";
import { baseDirFlag } from "./cli/config.ts";
import { runCommand } from "./cli/run.ts";
import { runTui } from "./cli/tui/app.ts";

export const runTuiCli = () =>
  runCommand(
    Command.make("ozi", {
      baseDir: baseDirFlag,
      resume: Flag.Boolean("resume").pipe(Flag.withAlias("r"), Flag.withDefault(false)),
      latest: Flag.Boolean("continue").pipe(Flag.withAlias("c"), Flag.withDefault(false)),
      session: Flag.String("session").pipe(Flag.optional),
    }).pipe(Command.withHandler(({ baseDir, ...launch }) => runTui(baseDir, launch))),
  );
