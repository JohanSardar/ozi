import * as NodeChildProcess from "node:child_process";
import * as NodeEvents from "node:events";
import * as NodeFSP from "node:fs/promises";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import type * as Playwright from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

const exec = NodeUtil.promisify(NodeChildProcess.execFile);
const root = NodePath.resolve(import.meta.dirname, "..");
const bin = NodePath.join(root, "apps/server/src/bin.ts");
const { chromium } = NodeModule.createRequire(NodePath.join(root, "apps/web/package.json"))(
  "playwright",
) as typeof Playwright;

describe("l5.handoff", () => {
  let home: string;
  let env: NodeJS.ProcessEnv;
  let dev: NodeChildProcess.ChildProcess;
  let browser: Playwright.Browser;
  let page: Playwright.Page;
  let inbox: Playwright.Locator;
  let ws: WebSocket;
  let workerId: string;
  const cli = async (...args: string[]) =>
    (await exec(process.execPath, [bin, ...args, "--home", home], { cwd: home, env })).stdout;
  const rpc = (tag: string, payload: unknown) =>
    new Promise<unknown>((resolve, reject) => {
      const id = crypto.randomUUID();
      const receive = (event: MessageEvent) => {
        const response = JSON.parse(String(event.data));
        if (response.requestId !== id || response._tag !== "Exit") return;
        ws.removeEventListener("message", receive);
        if (response.exit._tag === "Success") resolve(response.exit.value);
        else reject(new Error(JSON.stringify(response.exit)));
      };
      ws.addEventListener("message", receive);
      ws.send(JSON.stringify({ _tag: "Request", id, tag, payload, headers: [] }));
    });
  const ticket = (input: object) => rpc("tickets.create", input);
  const content = (group: string, title: string, threadId: string, choices: string[] = []) => ({
    group,
    title,
    need: `Need for ${title}.`,
    summary: `Summary for ${title}.`,
    choices: choices.map((label) => ({ label, detail: `Detail for ${label}` })),
    markdown: "",
    attachments: [],
    htmlPages: [],
    threadId,
  });

  beforeAll(async () => {
    home = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "ozi-l5-"));
    env = {
      ...process.env,
      HOME: home,
      OZI_HOME: home,
      OZI_TELEMETRY_ENABLED: "false",
      OZI_PORT_OFFSET: String(2000 + (process.pid % 1000)),
      PATH: `${NodePath.join(root, "node_modules/.bin")}${NodePath.delimiter}${process.env.PATH}`,
    };
    dev = NodeChildProcess.spawn(
      process.execPath,
      [NodePath.join(root, "scripts/dev-runner.ts"), "dev", "--home-dir", home],
      { cwd: root, env, detached: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    const ports = await new Promise<{ server: number }>((resolve, reject) => {
      let output = "";
      const read = (chunk: Buffer) => {
        output += String(chunk);
        const match = /serverPort=(\d+)/.exec(output);
        if (match && output.includes("Ozi server is ready.") && output.includes("ready in")) {
          resolve({ server: Number(match[1]) });
        }
      };
      dev.stdout!.on("data", read);
      dev.stderr!.on("data", read);
      dev.once("exit", (code) => reject(new Error(`Dev runner exited: ${code}\n${output}`)));
    });
    const origin = `http://127.0.0.1:${ports.server}`;
    const [{ token }, { pairingUrl }] = (
      await Promise.all([cli("auth", "session", "issue", "--json"), cli("pair", "--json")])
    ).map((output) => JSON.parse(output));
    const issued = await fetch(`${origin}/api/auth/websocket-ticket`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    }).then((response) => response.json());
    ws = new WebSocket(
      `${origin.replace("http:", "ws:")}/ws?orchestrationProtocol=2&wsTicket=${issued.ticket}`,
    );
    await NodeEvents.once(ws, "open");
    await rpc("projects.mutate", {
      type: "project.create",
      commandId: crypto.randomUUID(),
      projectId: "project-l5",
      title: "Handoff",
      workspaceRoot: home,
    });
    await rpc("orchestration.dispatchCommand", {
      type: "thread.create",
      createdBy: "user",
      creationSource: "web",
      commandId: crypto.randomUUID(),
      threadId: "dinner-l5",
      projectId: "project-l5",
      title: "Friday dinner",
      modelSelection: { instanceId: "codex", model: "gpt-5.4" },
      runtimeMode: "full-access",
      interactionMode: "default",
      workingDirectory: null,
    });
    await rpc("orchestration.dispatchCommand", {
      type: "message.dispatch",
      createdBy: "user",
      creationSource: "web",
      commandId: crypto.randomUUID(),
      threadId: "dinner-l5",
      messageId: "message-l5",
      text: "Find a table for Friday",
      attachments: [],
      dispatchMode: { type: "defer_start" },
    });
    const { runs } = (await rpc("orchestration.getThreadProjection", {
      threadId: "dinner-l5",
    })) as { runs: Array<{ id: string; rootNodeId: string }> };
    await rpc("orchestration.dispatchCommand", {
      type: "delegated_task.request",
      createdBy: "agent",
      creationSource: "mcp",
      commandId: crypto.randomUUID(),
      parentThreadId: "dinner-l5",
      parentRunId: runs[0]!.id,
      parentNodeId: runs[0]!.rootNodeId,
      title: "Restaurant for Friday",
      task: "Find a table",
      modelSelection: { instanceId: "codex", model: "gpt-5.4" },
      runtimeMode: "full-access",
      interactionMode: "default",
      workspaceStrategy: { type: "root" },
    });
    const { subagents } = (await rpc("orchestration.getThreadProjection", {
      threadId: "dinner-l5",
    })) as { subagents: Array<{ childThreadId: string }> };
    workerId = subagents[0]!.childThreadId;
    await ticket(content("Read", "Landlord replied", "dinner-l5"));
    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(pairingUrl);
    inbox = page.getByRole("complementary", { name: "Inbox" });
    await page.getByRole("treeitem", { name: /^Working/ }).click();
    await page.getByRole("treeitem", { name: /Friday dinner/ }).click();
  });

  afterAll(async () => {
    ws?.close();
    await browser?.close();
    if (dev?.pid && dev.exitCode === null) {
      const exited = NodeEvents.once(dev, "exit");
      process.kill(-dev.pid, "SIGTERM");
      await exited;
    }
    await NodeFSP.rm(home, { recursive: true, force: true });
  });

  it("l5.handoff: the job's line shows its state and opens its ticket in the inbox", async () => {
    const line = page.getByRole("button", { name: /^Restaurant for Friday · / });
    expect(await line.getAttribute("aria-label")).toMatch(/· (working|failed)$/);
    expect(await line.locator("svg").count()).toBe(2);
    await ticket(content("Decide", "Pick a restaurant", workerId, ["Lupo", "Babette"]));
    await page.getByRole("button", { name: "Restaurant for Friday · waiting on you" }).waitFor();
    await inbox
      .getByRole("article", { name: "Landlord replied" })
      .getByRole("button", { expanded: false })
      .click();
    await inbox
      .getByRole("article", { name: "Landlord replied" })
      .getByRole("button", { expanded: true })
      .waitFor();
    await inbox.getByRole("tab", { name: "Archive" }).click();
    await line.click();
    await inbox
      .getByRole("article", { name: "Pick a restaurant" })
      .getByRole("button", { expanded: true })
      .waitFor();
    await inbox
      .getByRole("article", { name: "Pick a restaurant" })
      .getByRole("button", { name: "Got it" })
      .click();
    await page
      .getByRole("button", { name: /^Restaurant for Friday · (working|failed)$/ })
      .waitFor();
  });
});
