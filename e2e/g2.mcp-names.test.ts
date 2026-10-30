import * as NodeChildProcess from "node:child_process";
import * as NodeEvents from "node:events";
import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import { expect, it } from "vite-plus/test";
import { startAnthropic } from "./fakes/anthropic.ts";

const exec = NodeUtil.promisify(NodeChildProcess.execFile);
const root = NodePath.resolve(import.meta.dirname, "..");
const cli = NodePath.join(root, "apps/server/src/bin.ts");

it("g2.mcp-names: discovery, Pi and CLI use Ozi names", async () => {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "ozi-g2-"));
  const home = NodePath.join(directory, "home");
  const workspace = NodePath.join(directory, "workspace");
  await NodeFSP.mkdir(workspace);
  await exec("git", ["init", workspace]);
  await NodeFSP.mkdir(NodePath.join(home, "userdata"), { recursive: true });
  await NodeFSP.writeFile(
    NodePath.join(home, "userdata/settings.json"),
    JSON.stringify({
      enableProviderUpdateChecks: false,
      providerInstances: {
        codex: { driver: "codex", enabled: false },
        claudeAgent: { driver: "claudeAgent", enabled: false },
      },
    }),
  );
  let called = false;
  const fake = await startAnthropic((request) => {
    if (called) return { text: "g2-ozi-ok" };
    const tool = request.tools.find((entry) => entry.name.endsWith("ozi_thread_list"));
    if (tool) {
      called = true;
      return { tool: tool.name, arguments: {} };
    }
    const search = request.tools.find((entry) => /tool_search$|^ToolSearch$/.test(entry.name));
    if (!search) throw new Error(JSON.stringify(request.tools));
    return { tool: search.name, arguments: { query: "ozi_thread_list", limit: 1 } };
  });
  const reserve = NodeNet.createServer();
  reserve.listen(0, "127.0.0.1");
  await NodeEvents.once(reserve, "listening");
  const address = reserve.address();
  if (address === null || typeof address === "string") throw new Error("No TCP address");
  await new Promise<void>((resolve) => reserve.close(() => resolve()));
  const environment = {
    ...process.env,
    HOME: directory,
    OZI_HOME: "",
    OZI_TELEMETRY_ENABLED: "false",
    PI_CODING_AGENT_DIR: NodePath.join(directory, "ambient-pi"),
    CLAUDE_CONFIG_DIR: NodePath.join(directory, "claude"),
    CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-ozi-test-only",
    ANTHROPIC_API_KEY: "must-not-be-used",
    ANTHROPIC_BASE_URL: fake.url,
  };
  const server = NodeChildProcess.spawn(
    process.execPath,
    [
      cli,
      "serve",
      "--home",
      home,
      "--port",
      String(address.port),
      "--host",
      "127.0.0.1",
      "--no-browser",
    ],
    {
      cwd: workspace,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  server.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const run = async (...args: string[]) =>
    JSON.parse(
      (
        await exec(process.execPath, [cli, ...args, "--home", home, "--json"], {
          cwd: workspace,
          env: environment,
          timeout: 45_000,
          maxBuffer: 1024 * 1024,
        })
      ).stdout,
    );
  try {
    await new Promise<void>((resolve, reject) => {
      server.stdout.on("data", (chunk) => {
        output += chunk;
        if (output.includes("Ozi server is ready.")) resolve();
      });
      server.once("error", reject);
      server.once("exit", (code) => reject(new Error(`Server exited ${code}: ${output}`)));
    });
    const issued = await run("auth", "session", "issue", "--subject", "mcp-client");
    const bridge = NodeChildProcess.spawn(process.execPath, [cli, "acp-mcp-bridge"], {
      env: {
        ...environment,
        OZI_ACP_MCP_ENDPOINT: `http://127.0.0.1:${address.port}/mcp`,
        OZI_ACP_MCP_AUTHORIZATION: `Bearer ${issued.token}`,
      },
      timeout: 20_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let wire = "";
    let errors = "";
    bridge.stdout.on("data", (chunk) => {
      wire += chunk;
    });
    bridge.stderr.on("data", (chunk) => {
      errors += chunk;
    });
    const bridgeExited = NodeEvents.once(bridge, "exit");
    bridge.stdin.end(
      [
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "g2", version: "1" },
          },
        },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
        {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "ozi_environment_read", arguments: {} },
        },
        {
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: { name: "t3_thread_list", arguments: {} },
        },
      ]
        .map((request) => JSON.stringify(request))
        .join("\n") + "\n",
    );
    expect((await bridgeExited)[0], errors).toBe(0);
    const replies = wire
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(replies.find((reply) => reply.id === 1).result.serverInfo.name.toLowerCase()).toBe(
      "ozi",
    );
    const tools = replies.find((reply) => reply.id === 2).result.tools;
    const names = tools.map((tool: { name: string }) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "ozi_thread_read",
        "ozi_thread_launch",
        "ozi_queue",
        "ozi_pending_request",
        "ozi_environment_read",
        "ozi_attachment_prepare_upload",
        "ozi_preview_list",
        "ozi_background_wait",
        "ozi_workflow_stop",
        "ticket_create",
        "ticket_update",
        "ticket_close",
        "ticket_list",
        "inbox",
      ]),
    );
    expect(JSON.stringify(tools)).not.toMatch(/\bT3\b|\bt3[_-]|\bproject(?:s|Id)?\b/i);
    expect(replies.find((reply) => reply.id === 3).result.isError).not.toBe(true);
    expect(replies.find((reply) => reply.id === 4).error).toBeDefined();
    const result = await run(
      "thread",
      "start",
      "--cwd",
      workspace,
      "List the chats with ozi_thread_list, then reply g2-ozi-ok.",
      "--wait",
    );
    expect(JSON.stringify(result), output).toContain("g2-ozi-ok");
    const thread = await run("thread", "show", result.threadId, "--activity");
    expect(JSON.stringify(thread)).toContain('"providerInstanceId":"ozi"');
    const listed = await run("thread", "list");
    expect(listed).toContainEqual(expect.objectContaining({ threadId: result.threadId }));
    expect(JSON.stringify(thread)).toContain("ozi_thread_list");
    expect(JSON.stringify(fake.requests)).toContain("mcp__ozi__ozi_thread_list");
    expect(JSON.stringify(fake.requests)).not.toMatch(/mcp__t3|t3_thread_/);
    expect(JSON.stringify(fake.requests)).not.toContain('"is_error":true');
  } finally {
    const exited = NodeEvents.once(server, "exit");
    server.kill("SIGTERM");
    await exited;
    await fake.close();
    await NodeFSP.rm(directory, { recursive: true, force: true });
  }
});
