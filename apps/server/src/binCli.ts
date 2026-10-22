import { Command } from "effect/cli";
import { clientCommands } from "./cli/client.ts";
import { serveCommand } from "./cli/server.ts";
import { serviceCommand } from "./cli/service.ts";
import { claudeHistoryCommand } from "./cli/claudeHistory.ts";
import { sshHelperCommand } from "./cli/sshHelper.ts";
import { runCommand } from "./cli/run.ts";

export const cli = Command.make("ozi").pipe(
  Command.withDescription("Ozi agent runtime."),
  Command.withSubcommands([
    serveCommand,
    serviceCommand,
    ...clientCommands,
    claudeHistoryCommand,
    sshHelperCommand,
  ]),
);

export const runCli = () => runCommand(cli);
