import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeURL from "node:url";

export default async function setup() {
  try {
    await NodeFSP.access(new URL("../apps/web/dist/index.html", import.meta.url));
  } catch {
    await new Promise<void>((resolve, reject) => {
      NodeChildProcess.execFile(
        NodeURL.fileURLToPath(new URL("../node_modules/.bin/vp", import.meta.url)),
        ["run", "--filter", "@t3tools/web", "build"],
        { cwd: NodeURL.fileURLToPath(new URL("..", import.meta.url)), timeout: 180_000 },
        (error, _stdout, stderr) =>
          error ? reject(new Error(stderr || error.message)) : resolve(),
      );
    });
  }
}
