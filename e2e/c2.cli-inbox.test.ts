import * as NodeChildProcess from "node:child_process";
import * as NodeEvents from "node:events";
import * as NodeFSP from "node:fs/promises";
import * as NodeHttp from "node:http";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeReadline from "node:readline";
import * as NodeUtil from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import type { Ticket } from "../packages/contracts/src/ticket.ts";
import { startAnthropic } from "./fakes/anthropic.ts";

const exec = NodeUtil.promisify(NodeChildProcess.execFile);
const root = NodePath.resolve(import.meta.dirname, "..");
const bin = NodePath.join(root, "apps/server/src/bin.ts");

it("c2.mcp-stream: thread list exits after its response on an open SSE connection", async () => {
  const home = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "ozi-c2-stream-"));
  const server = NodeHttp.createServer(async (request, response) => {
    if (request.method === "DELETE") {
      response.writeHead(204).end();
      return;
    }
    let body = "";
    for await (const chunk of request) body += chunk;
    const message = JSON.parse(body);
    if (message.id === undefined) {
      response.writeHead(202).end();
      return;
    }
    const result =
      message.method === "initialize"
        ? {
            protocolVersion: "2025-06-18",
            capabilities: {},
            serverInfo: { name: "external-mcp", version: "1" },
          }
        : {
            structuredContent: {
              currentThreadId: null,
              threads: [],
              nextCursor: null,
              total: 0,
            },
          };
    response.writeHead(200, { "content-type": "text/event-stream", "mcp-session-id": "c2-stream" });
    response.write(`data: ${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n\n`);
  });
  server.listen(0, "127.0.0.1");
  await NodeEvents.once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No TCP address");
  await NodeFSP.writeFile(
    NodePath.join(home, "remote.json"),
    JSON.stringify({
      origin: `http://127.0.0.1:${address.port}`,
      token: "external-mcp-test",
      expiresAt: 4_102_444_800_000,
    }),
  );
  try {
    const result = await exec(process.execPath, [bin, "thread", "list", "--home", home, "--json"], {
      cwd: home,
      env: { ...process.env, HOME: home, OZI_HOME: home, OZI_TELEMETRY_ENABLED: "false" },
      timeout: 10_000,
    });
    expect(JSON.parse(result.stdout)).toEqual([]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await NodeFSP.rm(home, { recursive: true, force: true });
  }
});

describe("c2.inbox", () => {
  let directory: string;
  let home: string;
  let remote: string;
  let env: NodeJS.ProcessEnv;
  let dev: NodeChildProcess.ChildProcess;
  let fake: Awaited<ReturnType<typeof startAnthropic>>;
  let devOutput = "";
  let originId: string;
  let currentId: string;
  let choice: Ticket;
  let reply: Ticket;
  let read: Ticket;
  const run = async (client: string, ...args: string[]) =>
    JSON.parse(
      (
        await exec(process.execPath, [bin, ...args, "--home", client, "--json"], {
          cwd: directory,
          env,
          timeout: 20_000,
          maxBuffer: 2 * 1024 * 1024,
        })
      ).stdout,
    );
  const cli = (...args: string[]) => run(home, ...args);
  const ticket = (title: string, group = "Decide") =>
    cli(
      "ticket",
      "create",
      "--input",
      JSON.stringify({
        group,
        title,
        need: "Choose a channel.",
        summary: "Ready for your decision.",
        markdown: "Full release context c2-archive-needle.",
        choices: [
          { label: "Stable", detail: "Use the supported channel." },
          { label: "Preview", detail: "Try the next release." },
        ],
        attachments: [],
        htmlPages: [],
        threadId: originId,
      }),
    );
  beforeAll(async () => {
    directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "ozi-c2-"));
    home = NodePath.join(directory, "home");
    remote = NodePath.join(directory, "client");
    await NodeFSP.mkdir(remote);
    await NodeFSP.mkdir(NodePath.join(home, "userdata"), { recursive: true });
    const binaryPath =
      process.env.OZI_TEST_CLAUDE_BINARY ??
      (
        await exec("which", ["claude"], {
          env: {
            ...process.env,
            PATH: `${NodePath.join(NodeOS.homedir(), ".local/bin")}${NodePath.delimiter}${process.env.PATH}`,
          },
        })
      ).stdout.trim();
    await NodeFSP.writeFile(
      NodePath.join(home, "userdata/settings.json"),
      JSON.stringify({
        enableProviderUpdateChecks: false,
        providerInstances: {
          codex: { driver: "codex", enabled: false },
          claudeAgent: {
            driver: "claudeAgent",
            config: {
              binaryPath: await NodeFSP.realpath(binaryPath),
            },
          },
        },
      }),
    );
    fake = await startAnthropic(() => ({ text: "c2-agent-ready" }));
    env = {
      ...process.env,
      HOME: directory,
      OZI_HOME: home,
      OZI_TELEMETRY_ENABLED: "false",
      OZI_PORT_OFFSET: String(4000 + (process.pid % 1000)),
      PATH: `${NodePath.join(root, "node_modules/.bin")}${NodePath.delimiter}${NodePath.join(NodeOS.homedir(), ".local/bin")}${NodePath.delimiter}${process.env.PATH}`,
      CLAUDE_CONFIG_DIR: NodePath.join(directory, "claude"),
      CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-ozi-test-only",
      ANTHROPIC_API_KEY: "",
      ANTHROPIC_BASE_URL: fake.url,
    };
    dev = NodeChildProcess.spawn(
      process.execPath,
      [NodePath.join(root, "scripts/dev-runner.ts"), "dev", "--home-dir", home],
      {
        cwd: root,
        env,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    await new Promise<void>((resolve, reject) => {
      let output = "";
      const receive = (chunk: Buffer) => {
        output += String(chunk);
        devOutput = output;
        if (output.includes("Ozi server is ready.") && output.includes("ready in")) resolve();
      };
      dev.stdout!.on("data", receive);
      dev.stderr!.on("data", receive);
      dev.once("error", reject);
      dev.once("exit", (code) => reject(new Error(`Dev exited ${code}: ${output}`)));
    });
  });
  afterAll(async () => {
    if (dev?.pid && dev.exitCode === null) {
      const exited = NodeEvents.once(dev, "exit");
      process.kill(-dev.pid, "SIGTERM");
      await exited;
    }
    await fake?.close();
    await NodeFSP.rm(directory, { recursive: true, force: true, maxRetries: 5 });
  });
  it("c2.threads: start, list, send and show complete against pnpm dev", async () => {
    const runtime = JSON.parse(
      await NodeFSP.readFile(NodePath.join(home, "userdata/server-runtime.json"), "utf8"),
    );
    await expect
      .poll(async () => (await fetch(`${runtime.origin}/.well-known/ozi/environment`)).status, {
        message: devOutput,
      })
      .toBe(200);
    originId = (
      await cli(
        "thread",
        "start",
        "c2 origin",
        "--provider",
        "claudeAgent",
        "--model",
        "claude-sonnet-5-5",
        "--wait",
      )
    ).threadId;
    currentId = (
      await cli(
        "thread",
        "start",
        "c2 current",
        "--provider",
        "claudeAgent",
        "--model",
        "claude-sonnet-5-5",
        "--wait",
      )
    ).threadId;
    expect(
      (await cli("thread", "list")).map((thread: { threadId: string }) => thread.threadId),
    ).toContain(originId);
    expect(await cli("thread", "send", currentId, "c2 follow up", "--wait")).toMatchObject({
      reply: "c2-agent-ready",
    });
    expect((await cli("thread", "show", currentId)).messages).toContainEqual(
      expect.objectContaining({ role: "user", text: "c2 follow up" }),
    );
  });
  it("c2.inbox-list: list and open expose the persisted ticket and its provenance", async () => {
    choice = await ticket("C2 choose");
    reply = await ticket("C2 reply", "Review");
    read = await ticket("C2 read", "Read");
    expect((await cli("inbox", "list")).tickets.map((item: Ticket) => item.id)).toContain(
      choice.id,
    );
    expect(await cli("inbox", "open", choice.id)).toEqual(choice);
  });
  it("c2.inbox-actions: choices reach the origin and replies reach the selected chat", async () => {
    await expect(cli("inbox", "choose", choice.id, "5")).rejects.toThrow();
    expect((await cli("inbox", "open", choice.id)).status).toBe("open");
    const answered = await cli("inbox", "choose", choice.id, "2");
    expect(answered).toMatchObject({
      status: "archived",
      cleared: { by: { type: "answered", threadId: originId, choiceIndex: 1 } },
    });
    const replied = await cli("inbox", "reply", reply.id, "c2 reply text", "--chat", currentId);
    expect(replied.ticket).toMatchObject({
      status: "archived",
      cleared: { by: { type: "replied", threadId: currentId } },
    });
    expect(
      (await cli("thread", "show", originId)).messages.some((message: { text: string }) =>
        message.text.includes("Preview"),
      ),
    ).toBe(true);
    const current = JSON.stringify(await cli("thread", "show", currentId));
    expect(current).toContain(reply.id);
    expect(current).toContain("c2 reply text");
    await expect.poll(() => JSON.stringify(fake.requests)).toContain(reply.origin.transcriptPath);
    expect(
      fake.requests
        .flatMap((request) => request.tools)
        .some((tool) => tool.name === "inbox" || tool.name.endsWith("__inbox")),
    ).toBe(false);
    expect(
      (await cli("thread", "show", currentId, "--activity")).activity.some(
        (item: { title: string }) => item.title === "Closed: C2 reply",
      ),
    ).toBe(true);
    expect((await cli("inbox", "choose", choice.id, "1")).cleared).toEqual(answered.cleared);
  });
  it("c2.archive: Got it, archive search and archived replies retain the first clearance", async () => {
    const acknowledged = await cli("inbox", "got-it", read.id);
    expect(acknowledged).toMatchObject({
      status: "archived",
      cleared: { by: { type: "acknowledged" } },
    });
    expect((await cli("inbox", "archive", "--search", "C2-ARCHIVE-NEEDLE")).tickets).toHaveLength(
      3,
    );
    const archived = await cli("inbox", "reply", read.id, "c2 archived reply", "--chat", currentId);
    expect(archived.ticket.cleared).toEqual(acknowledged.cleared);
  });
  it("c2.live: remote ticket subscriptions publish committed changes and stop on termination", async () => {
    await run(remote, "connect", (await cli("pair")).pairingUrl);
    const child = NodeChildProcess.spawn(
      process.execPath,
      [bin, "ticket", "subscribe", "--home", remote, "--json"],
      { cwd: directory, env, stdio: "pipe" },
    );
    const lines = NodeReadline.createInterface({ input: child.stdout });
    let errors = "";
    child.stderr.on("data", (chunk) => {
      errors += chunk;
    });
    const iterator = lines[Symbol.asyncIterator]();
    try {
      const first = await iterator.next();
      expect(first.done, errors).toBe(false);
      expect(JSON.parse(first.value!).tickets).toEqual([]);
      const live = await ticket("C2 live", "Read");
      expect(
        JSON.parse((await iterator.next()).value!).tickets.map((item: Ticket) => item.id),
      ).toContain(live.id);
      await cli("inbox", "got-it", live.id);
      expect(JSON.parse((await iterator.next()).value!).tickets).toEqual([]);
    } finally {
      lines.close();
      const exited = NodeEvents.once(child, "exit");
      child.kill("SIGTERM");
      await exited;
    }
  });
  it("c2.remote-terminal: paired CLI and terminal share inbox actions without a local server", async () => {
    await run(remote, "connect", (await cli("pair")).pairingUrl);
    expect(
      (await run(remote, "inbox", "archive", "--search", "C2 choose")).tickets.map(
        (item: Ticket) => item.id,
      ),
    ).toEqual([choice.id]);
    const pending = await ticket("C2 terminal", "Do");
    const terminalChoice = await ticket("C2 terminal choice");
    const terminalReply = await ticket("C2 terminal reply", "Review");
    const child = NodeChildProcess.spawn(
      process.execPath,
      [bin, "terminal", "--chat", currentId, "--home", remote, "--json"],
      { cwd: directory, env, stdio: "pipe" },
    );
    let output = "";
    let errors = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      errors += chunk;
    });
    const exited = NodeEvents.once(child, "exit");
    child.stdin.end(
      `/open ${terminalChoice.id}\n1\n/open ${terminalReply.id}\n/reply terminal reply\n/open ${pending.id}\n/got-it\n/archive C2 terminal\n/quit\n`,
    );
    expect((await exited)[0], errors).toBe(0);
    const events = output
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(JSON.stringify(events)).toContain("C2 terminal");
    expect(events.filter((event) => event.type === "error")).toEqual([]);
    expect(events.filter((event) => event.type === "inbox")).toHaveLength(5);
    expect((await cli("inbox", "open", terminalChoice.id)).cleared.by.type).toBe("answered");
    expect((await cli("inbox", "open", terminalReply.id)).cleared.by).toMatchObject({
      type: "replied",
      threadId: currentId,
    });
    expect((await cli("inbox", "open", pending.id)).status).toBe("archived");
    const readonly = NodePath.join(directory, "readonly");
    await NodeFSP.mkdir(readonly);
    await run(
      readonly,
      "connect",
      (await cli("pair", "--scope", "orchestration:read")).pairingUrl,
      "--access",
      "read-only",
    );
    expect((await run(readonly, "inbox", "archive")).tickets.length).toBeGreaterThan(0);
    await expect(run(readonly, "inbox", "got-it", pending.id)).rejects.toThrow();
  });
});
