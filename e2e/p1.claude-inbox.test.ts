import * as NodeChildProcess from "node:child_process";
import * as NodeEvents from "node:events";
import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import * as NodeReadline from "node:readline";
import { expect, it } from "vite-plus/test";
import { startAnthropic } from "./fakes/anthropic.ts";

const exec = NodeUtil.promisify(NodeChildProcess.execFile);
const root = NodePath.resolve(import.meta.dirname, "..");
const cli = NodePath.join(root, "apps/server/src/bin.ts");

it("p1.claude-inbox: Stop forks full context, files and closes tickets without changing the chat", async () => {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "ozi-p1-"));
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
      },
    }),
  );
  let releaseCheck!: () => void;
  const heldCheck = new Promise<void>((resolve) => {
    releaseCheck = resolve;
  });
  const requests = new NodeEvents.EventEmitter();
  const fake = await startAnthropic(async (request) => {
    const messages = JSON.stringify(request.messages);
    const checkIndex = request.messages.findLastIndex((message) =>
      JSON.stringify(message.content).includes("Inbox check."),
    );
    if (checkIndex === -1)
      return {
        text:
          messages.includes("p1-acknowledged") || messages.includes("p1-smalltalk")
            ? "p1-thanks"
            : "p1-result: Release needs your approval. Full release details.",
      };
    const current = JSON.stringify(request.messages.slice(checkIndex));
    const tool = (name: string, args: Record<string, unknown>) => ({
      tool: request.tools.find((entry) => entry.name.endsWith(name))!.name,
      arguments: args,
    });
    if (current.includes('"tool_result"')) return { text: "p1-fork-finished" };
    if (messages.includes("p1-acknowledged")) {
      const match = current.match(/\\"id\\":\\"([^"\\]+)\\"/);
      return match ? tool("ticket_close", { id: match[1] }) : { text: "p1-no-ticket" };
    }
    if (messages.includes("p1-smalltalk")) return { text: "p1-no-ticket" };
    requests.emit("check");
    await heldCheck;
    return tool("ticket_create", {
      group: "Decide",
      title: "p1-release",
      need: "Approve the release.",
      summary: "Release is ready.\nChoose whether to publish.",
      choices: [{ label: "Publish", detail: "Release the checked build." }],
      markdown: "# Full release details\nThe complete result and approval request.",
      attachments: [],
      htmlPages: [],
    });
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
          timeout: 25_000,
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
    await exec(process.execPath, [cli, "project", "add", workspace, "--home", home], {
      env: environment,
    });
    const watch = NodeChildProcess.spawn(
      process.execPath,
      [cli, "ticket", "subscribe", "--input", '{"status":"all"}', "--home", home, "--json"],
      { env: environment, stdio: ["ignore", "pipe", "pipe"] },
    );
    const snapshots: {
      tickets: {
        id: string;
        title: string;
        status: string;
        origin: { threadId: string; messageId: string };
        cleared: unknown;
      }[];
    }[] = [];
    const lines = NodeReadline.createInterface({ input: watch.stdout });
    const changes = new NodeEvents.EventEmitter();
    lines.on("line", (line) => {
      snapshots.push(JSON.parse(line));
      changes.emit("snapshot");
    });
    const wait = async (predicate: (snapshot: (typeof snapshots)[number]) => boolean) => {
      for (;;) {
        const value = snapshots.findLast(predicate);
        if (value) return value;
        await NodeEvents.once(changes, "snapshot", { signal: AbortSignal.timeout(20_000) });
      }
    };
    try {
      await wait(() => true);
      const checking = NodeEvents.once(requests, "check", { signal: AbortSignal.timeout(25_000) });
      const result = await run(
        "thread",
        "start",
        workspace,
        "p1-context: present the release for approval.",
        "--provider",
        "claudeAgent",
        "--model",
        "claude-sonnet-5-5",
        "--wait",
      );
      expect(JSON.stringify(result), output).toContain("p1-result");
      await checking;
      const continued = await run(
        "thread",
        "send",
        result.threadId,
        "p1-smalltalk: Thanks, I will read it.",
        "--wait",
      );
      expect(JSON.stringify(continued), output).toContain("p1-thanks");
      releaseCheck();
      const filed = await wait((snapshot) =>
        snapshot.tickets.some((ticket) => ticket.title === "p1-release"),
      );
      expect(filed.tickets).toHaveLength(1);
      const ticket = filed.tickets[0]!;
      expect(ticket.origin.threadId).toBe(result.threadId);
      const after = await run("thread", "show", result.threadId);
      expect(after.messages).toHaveLength(4);
      expect(JSON.stringify(after)).not.toContain("Inbox check.");
      expect(JSON.stringify(after)).not.toContain("p1-fork-finished");
      const acknowledged = await run(
        "thread",
        "send",
        result.threadId,
        `p1-acknowledged: I acknowledge ticket ${ticket.id}. Thank you.`,
        "--wait",
      );
      expect(JSON.stringify(acknowledged), output).toContain("p1-thanks");
      const closed = await wait((snapshot) =>
        snapshot.tickets.some((item) => item.status === "archived"),
      );
      expect(closed.tickets).toHaveLength(1);
      expect(closed.tickets[0]!.cleared).toMatchObject({
        by: { type: "agent", threadId: result.threadId },
      });
      const thread = await run("thread", "show", result.threadId, "--activity");
      expect(thread.messages).toHaveLength(6);
      const steps = thread.activity.filter((item: { title?: string }) =>
        item.title?.startsWith("Inbox check"),
      );
      expect(steps).toHaveLength(3);
      expect(steps.map((item: { status: string }) => item.status)).toEqual([
        "completed",
        "completed",
        "completed",
      ]);
      const userMessages = thread.activity.filter(
        (item: { type: string }) => item.type === "user_message",
      );
      expect(ticket.origin.messageId).toBe(userMessages[0].messageId);
      expect(closed.tickets[0]!.cleared).toMatchObject({
        by: { messageId: userMessages[2].messageId },
      });
      expect(steps.map((item: { title: string }) => item.title).sort()).toEqual([
        "Inbox check · 0 filed",
        "Inbox check · 0 filed",
        "Inbox check · 1 filed",
      ]);
      const checks = fake.requests.filter((request) =>
        JSON.stringify(request.messages).includes("Inbox check."),
      );
      expect(checks.length).toBeGreaterThanOrEqual(4);
      for (const request of checks) {
        expect(request.model).toBe("claude-sonnet-5-5");
        expect(JSON.stringify(request.messages)).toContain("p1-context");
        expect(JSON.stringify(request.messages)).toContain("Full release details");
      }
      expect(JSON.stringify(fake.requests)).not.toContain('"is_error":true');
    } finally {
      const exited = NodeEvents.once(watch, "exit");
      watch.kill("SIGTERM");
      await exited;
      lines.close();
    }
  } catch (error) {
    throw new Error(
      `${String(error)}\n${output}\nRequests: ${JSON.stringify(fake.requests.map((request) => ({ model: request.model, messages: request.messages.filter((message) => message.role !== "system") })))}`,
      { cause: error },
    );
  } finally {
    releaseCheck();
    const exited = NodeEvents.once(server, "exit");
    server.kill("SIGTERM");
    await exited;
    await fake.close();
    await NodeFSP.rm(directory, { recursive: true, force: true });
  }
});
