import * as NodeChildProcess from "node:child_process";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";
import type { Harness } from "./harness.ts";

const cli = NodeURL.fileURLToPath(new URL("../apps/server/src/bin.ts", import.meta.url));

export function openTui(h: Harness) {
  const child = NodeChildProcess.spawn(
    "script",
    [
      "-qfec",
      `stty cols 120 rows 40; exec "${process.execPath}" "${cli}" --home "${h.home}"`,
      "/dev/null",
    ],
    { cwd: h.dataRoot, env: { ...h.env, TERM: "xterm-256color" }, stdio: ["pipe", "pipe", "pipe"] },
  );
  let output = "";
  const listeners = new Set<() => void>();
  const exited = new Promise<number | null>((resolve) => child.once("exit", resolve));
  child.stdout.on("data", (chunk: Buffer) => {
    output += NodeUtil.stripVTControlCharacters(chunk.toString()).replaceAll("\r", "");
    for (const listener of listeners) listener();
  });
  return {
    get output() {
      return output;
    },
    mark: () => output.length,
    keys: (data: string) => void child.stdin.write(data),
    exited,
    waitFor: (text: string, from = 0, timeout = 30_000) =>
      new Promise<void>((resolve, reject) => {
        const check = () => {
          if (!output.includes(text, from)) return;
          cleanup();
          resolve();
        };
        const timer = setTimeout(() => {
          cleanup();
          reject(
            new Error(`terminal never showed ${JSON.stringify(text)}:\n${output.slice(-3000)}`),
          );
        }, timeout);
        const cleanup = () => {
          clearTimeout(timer);
          listeners.delete(check);
        };
        listeners.add(check);
        check();
      }),
    close: () => {
      if (child.exitCode === null) child.kill();
    },
  };
}
