import * as NodeChildProcess from "node:child_process";
import * as NodeEvents from "node:events";

export async function startDisplay() {
  if (process.env.DISPLAY) return { env: { DISPLAY: process.env.DISPLAY }, close: async () => {} };
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
  });
  return {
    env: { DISPLAY: display },
    close: async () => {
      if (server.exitCode !== null || server.signalCode !== null) return;
      const exited = NodeEvents.once(server, "exit");
      server.kill("SIGTERM");
      await exited;
    },
  };
}
