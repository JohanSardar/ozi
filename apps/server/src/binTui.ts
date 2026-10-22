import { Command } from "effect/cli";
import { baseDirFlag } from "./cli/config.ts";
import { runCommand } from "./cli/run.ts";
import { runTui } from "./cli/tui/app.ts";

export const runTuiCli = () =>
  runCommand(
    Command.make("ozi", { baseDir: baseDirFlag }).pipe(
      Command.withHandler((flags) => runTui(flags.baseDir)),
    ),
  );
