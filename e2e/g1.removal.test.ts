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

it("g1.devices-removed: ACP bridge retains orchestration without device tools", async () => {
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
      "auth",
      "session",
      "issue",
      "--home",
      stateHome,
      "--subject",
      "mcp-client",
      "--json",
    ]);
    const issued = JSON.parse(stdout);
    const bridge = NodeChildProcess.spawn(
      process.execPath,
      [NodePath.join(root, "apps/server/src/bin.ts"), "acp-mcp-bridge"],
      {
        env: {
          ...process.env,
          OZI_ACP_MCP_ENDPOINT: `http://127.0.0.1:${port}/mcp`,
          OZI_ACP_MCP_AUTHORIZATION: `Bearer ${issued.token}`,
        },
        timeout: 10_000,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let output = "";
    let errors = "";
    bridge.stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    bridge.stderr.on("data", (chunk) => {
      errors += String(chunk);
    });
    const exited = NodeEvents.once(bridge, "exit");
    bridge.stdin.end(
      [
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "g1", version: "1" },
          },
        },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      ]
        .map((request) => JSON.stringify(request))
        .join("\n") + "\n",
    );
    expect((await exited)[0], errors).toBe(0);
    const response = output
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .find((reply) => reply.id === 2);
    expect(response?.error, output).toBeUndefined();
    const names = response.result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toContain("orchestrator_capabilities");
    expect(names).toContain("t3_thread_read");
    expect(names.some((name: string) => name.startsWith("device_"))).toBe(false);
    expect(await NodeFSP.readdir(legacyHome)).toEqual(["sentinel"]);
    expect(await NodeFSP.readFile(NodePath.join(legacyHome, "sentinel"), "utf8")).toBe("untouched");
  } finally {
    const exited = NodeEvents.once(server, "exit");
    server.kill("SIGTERM");
    await exited;
    await NodeFSP.rm(home, { recursive: true, force: true });
  }
});
