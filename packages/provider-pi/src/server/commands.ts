import {
  PiRpcCommand,
  type ServerProviderSkill,
  type ServerProviderSlashCommand,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Predicate from "effect/Predicate";

const isPiRpcCommand = Schema.is(PiRpcCommand);

const PI_BUILTINS: ReadonlyArray<ServerProviderSlashCommand> = [
  {
    name: "compact",
    description: "Summarize the conversation",
    input: { hint: "Optional instructions" },
  },
  { name: "session", description: "Show Pi session statistics" },
  { name: "copy", description: "Show the last Pi reply" },
  {
    name: "model",
    description: "List models or select provider/model",
    input: { hint: "provider/model" },
  },
  { name: "thinking", description: "List or set thinking levels", input: { hint: "level" } },
  { name: "name", description: "Set the Pi session name", input: { hint: "name" } },
  {
    name: "export",
    description: "Export the Pi session as HTML",
    input: { hint: "Optional server path" },
  },
];

export interface PiCompactCommand {
  readonly customInstructions?: string;
}

export function parsePiCompactCommand(text: string): PiCompactCommand | null {
  const trimmed = text.trim();
  if (trimmed === "/compact") return {};
  if (!trimmed.startsWith("/compact")) return null;
  const rest = trimmed.slice("/compact".length);
  if (rest.length === 0) return {};
  if (!/^\s/.test(rest)) return null;
  const customInstructions = rest.trim();
  return customInstructions.length === 0 ? {} : { customInstructions };
}

export function parsePiBuiltinCommand(text: string): PiRpcCommand | { error: string } | null {
  const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (match === null) return null;
  const argument = match[2]?.trim() ?? "";
  switch (match[1]) {
    case "compact":
      return { type: "compact", ...(argument ? { customInstructions: argument } : {}) };
    case "session":
      return { type: "get_session_stats" };
    case "copy":
      return { type: "get_last_assistant_text" };
    case "model": {
      if (!argument) return { type: "get_available_models" };
      const separator = argument.indexOf("/");
      return separator > 0 && separator < argument.length - 1
        ? {
            type: "set_model",
            provider: argument.slice(0, separator),
            modelId: argument.slice(separator + 1),
          }
        : { error: "Use /model provider/model." };
    }
    case "thinking": {
      if (!argument) return { type: "get_available_thinking_levels" };
      const command = { type: "set_thinking_level", level: argument };
      return isPiRpcCommand(command)
        ? command
        : { error: "Choose off, minimal, low, medium, high, xhigh or max." };
    }
    case "name":
      return argument ? { type: "set_session_name", name: argument } : { type: "get_state" };
    case "export":
      return { type: "export_html", ...(argument ? { outputPath: argument } : {}) };
    case "settings":
    case "scoped-models":
    case "login":
    case "logout":
      return { error: "Use Ozi Settings or ozi pi for Pi configuration." };
    case "new":
    case "fork":
    case "clone":
    case "resume":
    case "reload":
    case "import":
    case "tree":
      return { error: "Use the Sessions menu or ozi session to manage chats." };
    case "share":
    case "bug":
    case "changelog":
    case "hotkeys":
    case "trust":
    case "quit":
      return { error: "This command requires Pi's terminal interface. Use ozi pi." };
    default:
      return null;
  }
}

export function withPiBuiltinSlashCommands(
  commands: ReadonlyArray<ServerProviderSlashCommand>,
): ReadonlyArray<ServerProviderSlashCommand> {
  return [
    ...PI_BUILTINS,
    ...commands.filter((command) => !PI_BUILTINS.some((builtin) => builtin.name === command.name)),
  ];
}

export interface PiDiscoveredCommands {
  readonly slashCommands: ReadonlyArray<ServerProviderSlashCommand>;
  readonly skills: ReadonlyArray<ServerProviderSkill>;
}

function normalizePiSkillScope(scope: string | undefined): string | undefined {
  if (scope === undefined) return undefined;
  const normalized = scope.trim().toLowerCase();
  if (normalized === "global" || normalized === "personal") return "user";
  if (normalized === "workspace" || normalized === "local") return "project";
  return scope;
}

export function parsePiDiscoveredCommands(data: unknown): PiDiscoveredCommands {
  const commands = recordField(data, "commands");
  if (!Array.isArray(commands)) return { slashCommands: [], skills: [] };
  const slashCommands: Array<ServerProviderSlashCommand> = [];
  const skills: Array<ServerProviderSkill> = [];
  for (const command of commands) {
    const commandName = recordString(command, "name");
    if (commandName === undefined || commandName.length === 0) continue;
    const description = recordString(command, "description");
    if (recordString(command, "source") === "skill") {
      const name = commandName.startsWith("skill:")
        ? commandName.slice("skill:".length)
        : commandName;
      if (name.length === 0) continue;
      const sourceInfo = recordField(command, "sourceInfo");
      const commandInterface = recordField(command, "interface");
      const path =
        recordString(sourceInfo, "path") ?? recordString(command, "path") ?? `pi:skill:${name}`;
      const scope = normalizePiSkillScope(
        recordString(sourceInfo, "scope") ?? recordString(command, "location"),
      );
      const displayName =
        recordString(command, "displayName") ??
        recordString(sourceInfo, "displayName") ??
        recordString(commandInterface, "displayName");
      const shortDescription =
        recordString(command, "shortDescription") ??
        recordString(sourceInfo, "shortDescription") ??
        recordString(commandInterface, "shortDescription");
      skills.push({
        name,
        path,
        enabled: true,
        ...(description === undefined ? {} : { description }),
        ...(scope === undefined ? {} : { scope }),
        ...(displayName === undefined ? {} : { displayName }),
        ...(shortDescription === undefined ? {} : { shortDescription }),
      });
      continue;
    }
    slashCommands.push({
      name: commandName,
      ...(description === undefined ? {} : { description }),
    });
  }
  return { slashCommands, skills };
}

function recordField(input: unknown, key: string): unknown {
  return Predicate.isObject(input) ? input[key] : undefined;
}

function recordString(input: unknown, key: string): string | undefined {
  const value = recordField(input, key);
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
