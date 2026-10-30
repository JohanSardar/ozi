import * as NodeChildProcess from "node:child_process";
import * as NodeEvents from "node:events";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

async function desktopArtifacts() {
  const directory = NodePath.resolve(import.meta.dirname, "../.vite-plus");
  await NodeFSP.mkdir(directory, { recursive: true });
  const lease = NodeChildProcess.spawn(
    "flock",
    [
      "--exclusive",
      NodePath.join(directory, "desktop-e2e.lock"),
      process.execPath,
      "-e",
      "process.stdout.write('ready');process.stdin.resume();",
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  await new Promise<void>((resolve, reject) => {
    lease.stdout.once("data", () => resolve());
    lease.once("error", reject);
    lease.once("exit", (code) => reject(new Error(`Desktop artifact lock exited ${code}`)));
  });
  return async () => {
    if (lease.exitCode !== null || lease.signalCode !== null) return;
    const exited = NodeEvents.once(lease, "exit");
    lease.stdin.end();
    await exited;
  };
}

export async function startDisplay() {
  const release = await desktopArtifacts();
  if (process.env.DISPLAY) return { env: { DISPLAY: process.env.DISPLAY }, close: release };
  const server = NodeChildProcess.spawn(
    "Xvfb",
    ["-displayfd", "1", "-screen", "0", "1440x1000x24", "-nolisten", "tcp"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  const display = await new Promise<string>((resolve, reject) => {
    server.stdout.on("data", (chunk) => {
      output += String(chunk);
      const match = output.match(/^(\d+)\n/);
      if (match) resolve(`:${match[1]}`);
    });
    server.once("error", reject);
    server.once("exit", (code) => reject(new Error(`Xvfb exited ${code}: ${output}`)));
  }).catch(async (cause) => {
    await release();
    throw cause;
  });
  return {
    env: { DISPLAY: display },
    close: async () => {
      try {
        if (server.exitCode === null && server.signalCode === null) {
          const exited = NodeEvents.once(server, "exit");
          server.kill("SIGTERM");
          await exited;
        }
      } finally {
        await release();
      }
    },
  };
}
