/**
 * `starts[i]` and `ends[i]` are the span of the original command that spells
 * `text[i]`, so a quoted `\"` maps back to both of its characters.
 */
export interface EmbeddedScript {
  readonly language: string;
  readonly text: string;
  readonly starts: ReadonlyArray<number>;
  readonly ends: ReadonlyArray<number>;
}

interface Interpreter {
  readonly language: string;
  readonly inline: (flag: string) => boolean;
  readonly valueOptions?: ReadonlySet<string>;
  readonly scriptFileOptions?: ReadonlySet<string>;
  readonly stdin: "always" | "without-script-file" | "never";
  readonly positionalScript?: number;
  readonly repeatable?: boolean;
  readonly subcommand?: string;
  /** PowerShell matches parameters case-insensitively; the lists above are lowercase. */
  readonly ignoreCase?: boolean;
}

const flagIn =
  (...flags: string[]) =>
  (flag: string) =>
    flags.includes(flag);

const SHELL: Interpreter = {
  language: "shellscript",
  inline: (flag) => /^-[a-z]*c[a-z]*$/u.test(flag),
  valueOptions: new Set(["-o", "-O", "--rcfile", "--init-file"]),
  stdin: "without-script-file",
};

const SQL_SHELL = {
  language: "sql",
  valueOptions: new Set([
    "-d",
    "-h",
    "-u",
    "-U",
    "--dbname",
    "--host",
    "--user",
    "--username",
    "-separator",
    "-nullvalue",
    "-init",
  ]),
  stdin: "always",
  repeatable: true,
} satisfies Omit<Interpreter, "inline">;

const INTERPRETERS: Record<string, Interpreter> = {
  sh: SHELL,
  bash: SHELL,
  zsh: SHELL,
  dash: SHELL,
  ash: SHELL,
  ksh: SHELL,
  fish: { language: "fish", inline: flagIn("-c", "--command"), stdin: "without-script-file" },
  node: {
    language: "javascript",
    inline: flagIn("-e", "--eval", "-p", "--print"),
    valueOptions: new Set(["-r", "--require", "--import", "--loader", "-C", "--conditions"]),
    stdin: "without-script-file",
  },
  bun: { language: "typescript", inline: flagIn("-e", "--eval", "-p", "--print"), stdin: "never" },
  deno: {
    language: "typescript",
    inline: () => false,
    // `--env-file` takes its optional path only as `--env-file=path`.
    valueOptions: new Set(["-c", "--config", "--import-map", "--ext"]),
    stdin: "never",
    subcommand: "eval",
  },
  ruby: {
    language: "ruby",
    inline: flagIn("-e"),
    valueOptions: new Set(["-r", "-I", "-C"]),
    stdin: "without-script-file",
  },
  perl: { language: "perl", inline: flagIn("-e", "-E"), stdin: "without-script-file" },
  osascript: {
    language: "applescript",
    inline: flagIn("-e"),
    valueOptions: new Set(["-l", "-s"]),
    stdin: "without-script-file",
  },
  pwsh: {
    language: "powershell",
    inline: flagIn("-c", "-command"),
    valueOptions: new Set(["-executionpolicy", "-workingdirectory", "-windowstyle"]),
    scriptFileOptions: new Set(["-f", "-file", "-encodedcommand"]),
    stdin: "never",
    ignoreCase: true,
  },
  psql: {
    ...SQL_SHELL,
    inline: flagIn("-c", "--command"),
    scriptFileOptions: new Set(["-f", "--file"]),
  },
  mysql: { ...SQL_SHELL, inline: flagIn("-e", "--execute") },
  sqlite3: { ...SQL_SHELL, inline: flagIn("-cmd"), positionalScript: 1 },
  duckdb: {
    ...SQL_SHELL,
    inline: flagIn("-c", "-cmd"),
    scriptFileOptions: new Set(["-f"]),
    positionalScript: 1,
  },
};
INTERPRETERS.powershell = INTERPRETERS.pwsh!;
INTERPRETERS.mariadb = INTERPRETERS.mysql!;
