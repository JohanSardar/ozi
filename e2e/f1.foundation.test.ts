import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeEvents from "node:events";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import { expect, it } from "vite-plus/test";

const exec = NodeUtil.promisify(NodeChildProcess.execFile);
const root = NodePath.resolve(import.meta.dirname, "..");

it("f1.dev-isolation: main checkouts and worktrees ignore ambient live homes", async () => {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "ozi-f1-"));
  try {
    const checkout = NodePath.join(directory, "checkout");
    const worktree = NodePath.join(directory, "worktree");
    const live = NodePath.join(directory, "live");
    await NodeFSP.mkdir(checkout);
    await NodeFSP.mkdir(live);
    await NodeFSP.writeFile(NodePath.join(live, "sentinel"), "untouched");
    await exec("git", ["init", checkout]);
    await exec("git", [
      "-C",
      checkout,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "--allow-empty",
      "-m",
      "test",
    ]);
    await exec("git", ["-C", checkout, "worktree", "add", "-b", "dev", worktree]);
    for (const cwd of [checkout, worktree]) {
      const { stdout } = await exec(
        process.execPath,
        [NodePath.join(root, "scripts/dev-runner.ts"), "dev", "--dry-run"],
        {
          cwd,
          env: { ...process.env, OZI_HOME: live, T3CODE_HOME: live, T3CODE_PORT_OFFSET: "invalid" },
        },
      );
      expect(stdout).toContain(`baseDir=${NodePath.join(cwd, ".ozi")}`);
      expect(stdout).toContain("source=worktree");
    }
    expect(await NodeFSP.readdir(live)).toEqual(["sentinel"]);
    expect(await NodeFSP.readFile(NodePath.join(live, "sentinel"), "utf8")).toBe("untouched");
  } finally {
    await NodeFSP.rm(directory, { recursive: true, force: true });
  }
});

it("f1.cli-identity: the public command is ozi", async () => {
  const { stdout } = await exec(process.execPath, [
    NodePath.join(root, "apps/server/src/bin.ts"),
    "--help",
  ]);
  expect(stdout).toContain("ozi");
  expect(stdout).not.toContain("T3 Code");
});

it("f1.pair: an isolated Ozi server issues JSON pairing links", async () => {
  const home = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "ozi-f1-server-"));
  const stateHome = NodePath.join(home, ".ozi");
  const legacyHome = NodePath.join(home, ".t3");
  await NodeFSP.mkdir(legacyHome);
  await NodeFSP.writeFile(NodePath.join(legacyHome, "sentinel"), "untouched");
  const reserve = NodeNet.createServer();
  reserve.listen(0, "127.0.0.1");
  await NodeEvents.once(reserve, "listening");
  const address = reserve.address();
  if (address === null || typeof address === "string") throw new Error("No TCP address");
  const port = address.port;
  await new Promise<void>((resolve) => reserve.close(() => resolve()));
  const server = NodeChildProcess.spawn(
    process.execPath,
    [
      NodePath.join(root, "apps/server/src/bin.ts"),
      "serve",
      "--port",
      String(port),
      "--host",
      "127.0.0.1",
      "--no-browser",
    ],
    {
      cwd: home,
      env: {
        ...process.env,
        HOME: home,
        OZI_HOME: "",
        OZI_TELEMETRY_ENABLED: "false",
        T3CODE_HOME: legacyHome,
        T3CODE_PORT: "invalid",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  try {
    await new Promise<void>((resolve, reject) => {
      let output = "";
      server.stdout.on("data", (chunk) => {
        output += String(chunk);
        if (output.includes("Ozi server is ready.")) resolve();
      });
      server.once("error", reject);
      server.once("exit", (code) => reject(new Error(`Server exited: ${code}`)));
    });
    const { stdout } = await exec(process.execPath, [
      NodePath.join(root, "apps/server/src/bin.ts"),
      "pair",
      "--home",
      stateHome,
      "--json",
    ]);
    const result = JSON.parse(stdout);
    expect(result.origin).toBe(`http://127.0.0.1:${port}`);
    expect(result.pairingUrl).toContain("/pair#token=");
    expect(await NodeFSP.readdir(legacyHome)).toEqual(["sentinel"]);
    expect(await NodeFSP.readFile(NodePath.join(legacyHome, "sentinel"), "utf8")).toBe("untouched");
  } finally {
    const exited = NodeEvents.once(server, "exit");
    server.kill("SIGTERM");
    await exited;
    await NodeFSP.rm(home, { recursive: true, force: true });
  }
});
