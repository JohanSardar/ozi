import * as NodeChildProcess from "node:child_process";
import * as NodeEvents from "node:events";
import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import type { Ticket } from "../packages/contracts/src/ticket.ts";
import { startAnthropic, type AnthropicRequest } from "./fakes/anthropic.ts";

const exec = NodeUtil.promisify(NodeChildProcess.execFile);
const root = NodePath.resolve(import.meta.dirname, "..");
const bin = NodePath.join(root, "apps/server/src/bin.ts");
const toolNames = ["ticket_create", "ticket_update", "ticket_close", "ticket_list"];
const content = (title: string) => ({
  group: "Decide",
  title,
  need: "Choose the release channel.",
  summary: "The release is ready.\nChoose a channel to continue.",
  choices: [{ label: "Stable", detail: "Use the supported release." }],
  markdown: "# Release\nFull **context**.",
  attachments: [],
  htmlPages: [],
});
const ticketsIn = (value: unknown): Ticket[] => {
  if (typeof value === "string") {
    try {
      return ticketsIn(JSON.parse(value));
    } catch {
      return [];
    }
  }
  if (typeof value !== "object" || value === null) return [];
  if ("origin" in value && "id" in value && "status" in value) return [value as Ticket];
  return Object.values(value).flatMap(ticketsIn);
};

describe("i2.ticket-tools", () => {
  let directory: string;
  let home: string;
  let workspace: string;
  let env: NodeJS.ProcessEnv;
  let server: NodeChildProcess.ChildProcess;
  let fake: Awaited<ReturnType<typeof startAnthropic>>;
  let mainId = "unrelated";
  let origin: string;
  let token: string;
  let main: Ticket;
  let worker: Ticket;
  let output = "";
  const calls = new Map<string, number>();
  const received: AnthropicRequest[] = [];
  const cli = async (...args: string[]) =>
    JSON.parse(
      (
        await exec(process.execPath, [bin, ...args, "--home", home, "--json"], {
          cwd: workspace,
          env,
          timeout: 55_000,
          maxBuffer: 2 * 1024 * 1024,
        })
      ).stdout,
    );
  const ticket = (command: string, input = {}) =>
    cli("ticket", command, "--input", JSON.stringify(input));

  beforeAll(async () => {
    directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "ozi-i2-"));
    home = NodePath.join(directory, "home");
    workspace = NodePath.join(directory, "workspace");
    await NodeFSP.mkdir(workspace);
    await exec("git", ["init", workspace]);
    await NodeFSP.mkdir(NodePath.join(home, "userdata"), { recursive: true });
    await NodeFSP.writeFile(
      NodePath.join(home, "userdata/settings.json"),
      JSON.stringify({
        enableProviderUpdateChecks: false,
        defaultRuntimeMode: "full-access",
        providerInstances: { codex: { driver: "codex", enabled: false } },
      }),
    );
    fake = await startAnthropic((request) => {
      const create = request.tools.find((tool) => tool.name.endsWith("ticket_create"));
      if (!create) {
        const search = request.tools.find(
          (tool) => tool.name.endsWith("tool_search") || tool.name === "ToolSearch",
        );
        return search
          ? { tool: search.name, arguments: { query: "ticket", limit: 4 } }
          : { text: "i2" };
      }
      received.push(request);
      const isWorker = request.model.includes("sonnet");
      const name = isWorker ? "i2-worker" : "i2-main";
      const id = ticketsIn(request.messages).find((ticket) => ticket.title.startsWith(name))?.id;
      const call = (tool: string, args: Record<string, unknown>) => ({
        tool: request.tools.find((entry) => entry.name.endsWith(tool))!.name,
        arguments: args,
      });
      if (JSON.stringify(request.messages).includes("i2-acknowledged")) {
        const closed = ticketsIn(request.messages).some((ticket) => ticket.status === "archived");
        return closed
          ? { text: "i2-closed" }
          : call("ticket_close", { id, by: { type: "acknowledged" }, threadId: "spoof" });
      }
      const step = calls.get(name) ?? 0;
      calls.set(name, step + 1);
      switch (step) {
        case 0:
          return call("ticket_list", {});
        case 1:
          return call("ticket_create", {
            ...content(name),
            threadId: "spoof",
            sessionId: "spoof",
            messageId: "spoof",
            origin: {
              chatId: "spoof",
              workerId: "spoof",
              jobId: "spoof",
              transcriptPath: "/spoof",
            },
          });
        case 2:
          return call("ticket_update", {
            id,
            changes: { title: `${name} updated`, origin: { threadId: "spoof" } },
          });
        case 3:
          return call("ticket_list", { search: name });
        case 4:
          return isWorker
            ? { text: "i2-worker-ready" }
            : call("delegate_task", {
                task: "i2-worker: exercise ticket tools then report.",
                target: { providerInstanceId: "claudeAgent", model: "claude-sonnet-5-5" },
                mode: "wait",
              });
        default:
          return { text: "i2-main-ready" };
      }
    });
    const reserve = NodeNet.createServer();
    reserve.listen(0, "127.0.0.1");
    await NodeEvents.once(reserve, "listening");
    const address = reserve.address();
    if (address === null || typeof address === "string") throw new Error("No TCP address");
    await new Promise<void>((resolve) => reserve.close(() => resolve()));
    env = {
      ...process.env,
      HOME: directory,
      OZI_HOME: home,
      OZI_TELEMETRY_ENABLED: "false",
      CLAUDE_CONFIG_DIR: NodePath.join(directory, "claude"),
      CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-ozi-test-only",
      ANTHROPIC_API_KEY: "",
      ANTHROPIC_BASE_URL: fake.url,
    };
    server = NodeChildProcess.spawn(
      process.execPath,
      [
        bin,
        "serve",
        "--home",
        home,
        "--port",
        String(address.port),
        "--host",
        "127.0.0.1",
        "--no-browser",
      ],
      { cwd: workspace, env, stdio: ["ignore", "pipe", "pipe"] },
    );
    server.stderr!.on("data", (chunk) => {
      output += chunk;
    });
    await new Promise<void>((resolve, reject) => {
      server.stdout!.on("data", (chunk) => {
        output += chunk;
        if (output.includes("Ozi server is ready.")) resolve();
      });
      server.once("error", reject);
      server.once("exit", (code) => reject(new Error(`Server exited ${code}: ${output}`)));
    });
    await exec(process.execPath, [bin, "project", "add", workspace, "--home", home], { env });
  });

  afterAll(async () => {
    if (server?.exitCode === null) {
      const exited = NodeEvents.once(server, "exit");
      server.kill("SIGTERM");
      await exited;
    }
    await fake?.close();
    await NodeFSP.rm(directory, { recursive: true, force: true });
  });

  it("i2.authentication: schemas expose content only and outside clients cannot impersonate a session", async () => {
    ({ token } = await cli("auth", "session", "issue", "--subject", "mcp-client"));
    const runtime = JSON.parse(
      await NodeFSP.readFile(NodePath.join(home, "userdata/server-runtime.json"), "utf8"),
    );
    origin = `http://127.0.0.1:${runtime.port}`;
    const bridge = NodeChildProcess.spawn(process.execPath, [bin, "acp-mcp-bridge"], {
      env: {
        ...env,
        OZI_ACP_MCP_ENDPOINT: `http://127.0.0.1:${runtime.port}/mcp`,
        OZI_ACP_MCP_AUTHORIZATION: `Bearer ${token}`,
      },
      timeout: 10_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let responseText = "";
    bridge.stdout.on("data", (chunk) => {
      responseText += chunk;
    });
    const exited = NodeEvents.once(bridge, "exit");
    bridge.stdin.end(
      [
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "i2", version: "1" },
          },
        },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
        ...toolNames.map((name, index) => ({
          jsonrpc: "2.0",
          id: index + 3,
          method: "tools/call",
          params: {
            name,
            arguments:
              name === "ticket_create"
                ? { ...content("spoof"), threadId: mainId }
                : name === "ticket_update"
                  ? { id: "missing", changes: { title: "spoof" } }
                  : name === "ticket_close"
                    ? { id: "missing" }
                    : {},
          },
        })),
      ]
        .map((request) => JSON.stringify(request))
        .join("\n") + "\n",
    );
    expect((await exited)[0], responseText).toBe(0);
    const replies = responseText
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(replies.find((reply) => reply.id === 2)?.error, responseText).toBeUndefined();
    const tools = replies.find((reply) => reply.id === 2).result.tools;
    expect(tools.some((tool: { name: string }) => tool.name === "t3_thread_read")).toBe(true);
    for (const name of toolNames) {
      const tool = tools.find((tool: { name: string }) => tool.name === name);
      expect(tool.description.length).toBeGreaterThan(10);
      const properties = Object.keys(tool.inputSchema.properties);
      if (name === "ticket_create")
        expect(properties.sort()).toEqual(Object.keys(content("")).sort());
      if (name === "ticket_update") expect(properties.sort()).toEqual(["changes", "id"]);
      if (name === "ticket_close") expect(properties).toEqual(["id"]);
    }
    for (let id = 3; id <= 6; id++) {
      expect(JSON.stringify(replies.find((reply) => reply.id === id))).toContain(
        "thread_credential_required",
      );
    }
  });

  it("i2.sessions: Pi main and Claude worker file and update tickets with authenticated provenance", async () => {
    const result = await cli(
      "thread",
      "start",
      workspace,
      "i2-main: exercise ticket tools and delegate.",
      "--wait",
    );
    expect(JSON.stringify(result), output).toContain("i2-main-ready");
    mainId = result.threadId;
    ({ token } = await cli("auth", "session", "issue"));
    const { tickets } = await ticket("list");
    expect(tickets).toHaveLength(2);
    main = tickets.find((ticket: Ticket) => ticket.title === "i2-main updated");
    worker = tickets.find((ticket: Ticket) => ticket.title === "i2-worker updated");
    expect(main.origin).toMatchObject({
      threadId: mainId,
      chatId: mainId,
      jobId: null,
      workerId: null,
    });
    expect(worker.origin).toMatchObject({ chatId: mainId, workerId: worker.origin.threadId });
    expect(worker.origin.jobId).toBeTypeOf("string");
    for (const item of [main, worker]) {
      expect(item.origin.sessionId).toBeTypeOf("string");
      expect(item.origin.messageId).toBeTypeOf("string");
      expect(item.origin.transcriptPath).toBe(
        `/api/orchestration/threads/${encodeURIComponent(item.origin.threadId)}/transcript`,
      );
      const source = await cli("thread", "show", item.origin.threadId);
      expect(source.thread.providerInstanceId).toBe(item === main ? "ozi" : "claudeAgent");
      const transcript = await fetch(`${origin}${item.origin.transcriptPath}`, {
        headers: { authorization: `Bearer ${token}`, "x-ozi-orchestration-protocol": "2" },
      });
      expect(transcript.status).toBe(200);
      expect(await transcript.text()).toContain(item.origin.messageId);
    }
    expect(JSON.stringify(tickets)).not.toContain("spoof");
    expect(received.some((request) => request.model.includes("sonnet"))).toBe(true);
    for (const request of received) {
      for (const name of toolNames)
        expect(request.tools.some((tool) => tool.name.endsWith(name))).toBe(true);
    }
  });

  it("i2.clearance: agent close uses the caller's acknowledgement and preserves the archive", async () => {
    for (const item of [main, worker]) {
      await cli(
        "thread",
        "send",
        item.origin.threadId,
        "i2-acknowledged: close the ticket.",
        "--wait",
      );
      const archived: Ticket = await ticket("get", { id: item.id });
      expect(archived.status).toBe("archived");
      expect(archived.origin).toEqual(item.origin);
      expect(archived.cleared?.by).toMatchObject({ type: "agent", threadId: item.origin.threadId });
      if (archived.cleared?.by.type !== "agent") throw new Error("Missing agent clearance");
      expect(archived.cleared.by.messageId).not.toBe(item.origin.messageId);
    }
    expect(await ticket("list")).toEqual({ tickets: [] });
    expect(
      (await ticket("list", { status: "archived", search: "UPDATED", chatId: mainId })).tickets,
    ).toHaveLength(2);
  });
});
