import * as NodeChildProcess from "node:child_process";
import * as NodeURL from "node:url";

export default async function setup() {
  await new Promise<void>((resolve, reject) => {
    NodeChildProcess.execFile(
      NodeURL.fileURLToPath(new URL("../node_modules/.bin/vp", import.meta.url)),
      ["run", "--filter", "@t3tools/desktop", "build"],
      { cwd: NodeURL.fileURLToPath(new URL("..", import.meta.url)), timeout: 300_000 },
      (error, _stdout, stderr) => (error ? reject(new Error(stderr || error.message)) : resolve()),
    );
  });
  await new Promise<void>((resolve, reject) => {
    NodeChildProcess.execFile(
      process.execPath,
      ["apps/desktop/scripts/ensure-electron-runtime.mjs"],
      { cwd: NodeURL.fileURLToPath(new URL("..", import.meta.url)), timeout: 300_000 },
      (error, _stdout, stderr) => (error ? reject(new Error(stderr || error.message)) : resolve()),
    );
  });
}
