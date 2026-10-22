import { Command } from "effect/cli";
import { clientCommands } from "./cli/client.ts";
import { runCommand } from "./cli/run.ts";

export const runClientCli = () =>
  runCommand(Command.make("ozi").pipe(Command.withSubcommands(clientCommands)));
