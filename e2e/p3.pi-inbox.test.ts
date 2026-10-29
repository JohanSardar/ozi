import * as NodeChildProcess from "node:child_process";
import * as NodeEvents from "node:events";
import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import { expect, it } from "vite-plus/test";
import type { Ticket } from "../packages/contracts/src/ticket.ts";
import { startAnthropic } from "./fakes/anthropic.ts";

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

const exec = NodeUtil.promisify(NodeChildProcess.execFile);
const root = NodePath.resolve(import.meta.dirname, "..");
const cli = NodePath.join(root, "apps/server/src/bin.ts");

it("p3.pi-inbox: isolated native forks file, acknowledge and skip small talk without delaying the main session", async () => {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "ozi-p3-"));
  const home = NodePath.join(directory, "home");
  const workspace = NodePath.join(directory, "workspace");
  await NodeFSP.mkdir(workspace);
  await exec("git", ["init", workspace]);
  await NodeFSP.mkdir(NodePath.join(home, "userdata"), { recursive: true });
  await NodeFSP.writeFile(
    NodePath.join(home, "userdata/settings.json"),
    JSON.stringify({
      enableProviderUpdateChecks: false,
      defaultRuntimeMode: "full-access",
      providerInstances: {
        codex: { driver: "codex", enabled: false },
        claudeAgent: { driver: "claudeAgent", enabled: false },
      },
    }),
  );
  const extensions = NodePath.join(home, "agents/ozi/extensions");
  await NodeFSP.mkdir(extensions, { recursive: true });
  await NodeFSP.writeFile(
    NodePath.join(extensions, "inbox.ts"),
    `export { default } from ${JSON.stringify(new URL("../packages/pi-inbox/index.ts", import.meta.url).href)};`,
  );
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let firstFork = true;
  let forkRequests = 0;
  const fake = await startAnthropic(async (request) => {
    const text = JSON.stringify(request.messages);
    const fork = text.includes("Check the completed turn's inbox only");
    if (!fork)
      return {
        text: text.includes("p3-smalltalk")
          ? "Hello!"
          : "p3-result: the complete result, with all details.",
      };
    forkRequests++;
    const tools = request.tools.map((tool) => tool.name);
    expect(tools).toHaveLength(4);
    expect(tools.every((tool) => /ticket_(create|update|close|list)$/.test(tool))).toBe(true);
    expect(text).toContain("p3-result");
    const call = (name: string, arguments_: Record<string, unknown>) => ({
      tool: tools.find((tool) => tool.endsWith(name))!,
      arguments: arguments_,
    });
    const promptAt = text.indexOf("Check the completed turn's inbox only");
    const results = text.slice(promptAt);
    if (!results.includes("tool_result")) {
      if (firstFork) {
        firstFork = false;
        await held;
      }
      return call("ticket_list", {});
    }
    if (text.includes("p3-acknowledged")) {
      const ticketId = ticketsIn(request.messages).find((ticket) => ticket.status === "open")?.id;
      if (!results.includes("archived") && ticketId) return call("ticket_close", { id: ticketId });
      return { text: "Inbox complete." };
    }
    if (text.includes("p3-smalltalk")) return { text: "Nothing to file." };
    if (!results.includes("p3-ticket"))
      return call("ticket_create", {
        group: "Review",
        title: "p3-ticket",
        need: "Review the completed result.",
        summary: "The result is ready.\nAll details are included.",
        choices: [],
        markdown: "# Result\np3-result: the complete result, with all details.",
        attachments: [],
        htmlPages: [],
      });
    return { text: "Inbox complete." };
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
  let threadId: string | undefined;
  server.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const run = async (...args: string[]) =>
    JSON.parse(
      (
        await exec(process.execPath, [cli, ...args, "--home", home, "--json"], {
          cwd: workspace,
          env: environment,
          timeout: 120_000,
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
    const result = await run(
      "thread",
      "start",
      workspace,
      "p3-result: finish this report.",
      "--wait",
    );
    threadId = result.threadId;
    expect(JSON.stringify(result), output).toContain("p3-result");
    await expect.poll(() => forkRequests, { timeout: 10_000 }).toBe(1);
    const second = await run("thread", "send", result.threadId, "p3-smalltalk: hello", "--wait");
    expect(JSON.stringify(second)).toContain("Hello!");
    release();
    const list = () => run("ticket", "list", "--input", "{}");
    let tickets: Ticket[] = [];
    await expect
      .poll(
        async () => {
          tickets = (await list()).tickets;
          return tickets.length;
        },
        { timeout: 15_000 },
      )
      .toBe(1);
    const ticket = tickets[0]!;
    expect(ticket.origin.threadId).toBe(result.threadId);
    const show = () => run("thread", "show", result.threadId, "--activity");
    await expect
      .poll(async () => JSON.stringify(await show()), { timeout: 15_000 })
      .toContain("Inbox check · 1 filed");
    await expect
      .poll(async () => JSON.stringify(await show()), { timeout: 15_000 })
      .toContain("Inbox check · 0 filed");
    const sessions = await NodeFSP.readdir(NodePath.join(home, "agents/ozi/sessions"), {
      recursive: true,
    });
    const native = sessions.find((file) => file.endsWith(".jsonl"));
    expect(native).toBeDefined();
    const history = await NodeFSP.readFile(
      NodePath.join(home, "agents/ozi/sessions", native!),
      "utf8",
    );
    expect(history).not.toContain("Check the completed turn's inbox only");
    expect(history).not.toContain("p3-ticket");
    await run(
      "thread",
      "send",
      result.threadId,
      "p3-acknowledged: got it, close that result.",
      "--wait",
    );
    await expect.poll(async () => (await list()).tickets.length, { timeout: 15_000 }).toBe(0);
    const archived = await run("ticket", "get", "--input", JSON.stringify({ id: ticket.id }));
    expect(archived.cleared.by.type).toBe("agent");
    expect(archived.cleared.by.messageId).not.toBe(ticket.origin.messageId);
    expect(archived.origin).toEqual(ticket.origin);
    for (const request of fake.requests) {
      expect(request.model).toBe("claude-opus-5-5");
      expect(request.output_config?.effort).toBe("high");
    }
    const end = await run("thread", "show", result.threadId);
    const users = end.messages.filter((message: { role: string }) => message.role === "user");
    expect(users).toHaveLength(3);
    expect(ticket.origin.messageId).toBe(users[0].messageId);
    expect(archived.cleared.by.messageId).toBe(users[2].messageId);
    expect(
      (await show()).activity.filter((item: { title?: string }) =>
        item.title?.startsWith("Inbox check"),
      ),
    ).toHaveLength(3);
    expect(forkRequests).toBe(8);
    expect(JSON.stringify(fake.requests)).not.toContain('"is_error":true');
  } catch (error) {
    throw new Error(
      `${error}\n${output}\n${JSON.stringify(fake.requests.map((request) => ({ tools: request.tools, messages: request.messages })))}\n${threadId ? JSON.stringify(await run("thread", "show", threadId, "--activity")) : ""}`,
      { cause: error },
    );
  } finally {
    release();
    const exited = NodeEvents.once(server, "exit");
    server.kill("SIGTERM");
    await exited;
    await fake.close();
    await NodeFSP.rm(directory, { recursive: true, force: true });
  }
});
