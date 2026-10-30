import * as NodeChildProcess from "node:child_process";
import * as NodeEvents from "node:events";
import * as NodeFSP from "node:fs/promises";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import type * as Playwright from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import type { Ticket } from "../packages/contracts/src/ticket.ts";
import { startAnthropic } from "./fakes/anthropic.ts";

const exec = NodeUtil.promisify(NodeChildProcess.execFile);
const root = NodePath.resolve(import.meta.dirname, "..");
const bin = NodePath.join(root, "apps/server/src/bin.ts");
const { chromium } = NodeModule.createRequire(NodePath.join(root, "apps/web/package.json"))(
  "playwright",
) as typeof Playwright;
const content = (title: string) => ({
  group: "Decide",
  title,
  need: "Pick a slot.",
  summary: "Two slots are free.",
  choices: [
    { label: "Tuesday", detail: "Tue 14:00" },
    { label: "Wednesday", detail: "Wed 09:30" },
  ],
  markdown: "",
  attachments: [],
  htmlPages: [],
});

describe("i7.clearing", () => {
  let home: string;
  let workspace: string;
  let env: NodeJS.ProcessEnv;
  let dev: NodeChildProcess.ChildProcess;
  let browser: Playwright.Browser;
  let page: Playwright.Page;
  let inbox: Playwright.Locator;
  let fake: Awaited<ReturnType<typeof startAnthropic>>;
  let chatId: string;
  let output = "";
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
  const file = (title: string): Promise<Ticket> =>
    ticket("create", { ...content(title), threadId: chatId });
  const userMessage = async (text: string) =>
    (await cli("thread", "show", chatId, "--messages", "100")).messages.find(
      (message: { role: string; text: string }) =>
        message.role === "user" && message.text.endsWith(text),
    ).messageId;
  const cleared = async (item: Ticket, how: string) => {
    await page.getByText(`Closed: ${item.title}`, { exact: true }).waitFor();
    await inbox.getByRole("article", { name: item.title }).waitFor({ state: "detached" });
    await inbox.getByRole("tab", { name: "Archive" }).click();
    await inbox.getByRole("button", { name: `${item.title} ${how}` }).waitFor();
    await inbox.getByRole("tab", { name: "Inbox" }).click();
    const archived: Ticket = await ticket("get", { id: item.id });
    expect(archived.status).toBe("archived");
    return archived.cleared!.by;
  };
  const row = async (item: Ticket) => {
    const article = inbox.getByRole("article", { name: item.title });
    const header = article.getByRole("button", { expanded: false });
    if (await header.count()) await header.click();
    return article;
  };

  beforeAll(async () => {
    home = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "ozi-i7-"));
    workspace = NodePath.join(home, "workspace");
    await NodeFSP.mkdir(workspace);
    await exec("git", ["init", workspace]);
    await NodeFSP.mkdir(NodePath.join(home, "userdata"));
    await NodeFSP.writeFile(
      NodePath.join(home, "userdata/settings.json"),
      JSON.stringify({
        enableProviderUpdateChecks: false,
        defaultRuntimeMode: "full-access",
        providerInstances: { codex: { driver: "codex", enabled: false } },
      }),
    );
    fake = await startAnthropic((request) => {
      const messages = JSON.stringify(request.messages);
      const ack = /i7-ack ([0-9a-f-]{36})/.exec(messages);
      if (!ack) return { text: "i7-ready" };
      if (/status\W+archived/.test(messages)) return { text: "Noted." };
      const close = request.tools.find((tool) => tool.name.endsWith("ticket_close"));
      if (close) return { tool: close.name, arguments: { id: ack[1] } };
      const search = request.tools.find(
        (tool) => tool.name.endsWith("tool_search") || tool.name === "ToolSearch",
      );
      return search
        ? { tool: search.name, arguments: { query: "ticket", limit: 4 } }
        : { text: "i7-no-tools" };
    });
    env = {
      ...process.env,
      HOME: home,
      OZI_HOME: home,
      OZI_TELEMETRY_ENABLED: "false",
      OZI_PORT_OFFSET: String(3000 + (process.pid % 1000)),
      CLAUDE_CONFIG_DIR: NodePath.join(home, "claude"),
      CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-ozi-test-only",
      ANTHROPIC_API_KEY: "",
      ANTHROPIC_BASE_URL: fake.url,
      PATH: `${NodePath.join(root, "node_modules/.bin")}${NodePath.delimiter}${process.env.PATH}`,
    };
    dev = NodeChildProcess.spawn(
      process.execPath,
      [NodePath.join(root, "scripts/dev-runner.ts"), "dev", "--home-dir", home],
      { cwd: root, env, detached: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    await new Promise<void>((resolve, reject) => {
      const read = (chunk: Buffer) => {
        output += String(chunk);
        if (output.includes("Ozi server is ready.") && output.includes("ready in")) resolve();
      };
      dev.stdout!.on("data", read);
      dev.stderr!.on("data", read);
      dev.once("exit", (code) => reject(new Error(`Dev runner exited: ${code}\n${output}`)));
    });
    const [{ pairingUrl }, started] = await Promise.all([
      cli("pair"),
      cli("thread", "start", "--cwd", workspace, "i7-chat", "--wait"),
    ]);
    chatId = started.threadId;
    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    inbox = page.getByRole("complementary", { name: "Inbox" });
    await page.goto(pairingUrl);
    await page.getByRole("treeitem", { name: /i7-chat/ }).click();
  });

  afterAll(async () => {
    await browser?.close();
    if (dev?.pid && dev.exitCode === null) {
      const exited = NodeEvents.once(dev, "exit");
      process.kill(-dev.pid, "SIGTERM");
      await exited;
    }
    await fake?.close();
    await NodeFSP.rm(home, { recursive: true, force: true, maxRetries: 5 });
  });

  it("i7.replied: a reply clears the ticket and the chat shows it closed", async () => {
    const item = await file("i7-replied");
    const box = (await row(item)).getByRole("textbox", { name: "Reply to i7-replied" });
    await box.fill("Wednesday works");
    await box.press("Enter");
    expect(await cleared(item, "Replied")).toEqual({
      type: "replied",
      threadId: chatId,
      messageId: await userMessage("Wednesday works"),
    });
  });

  it("i7.got-it: Got it clears the ticket into the current chat", async () => {
    const item = await file("i7-got-it");
    await (await row(item)).getByRole("button", { name: "Got it" }).click();
    expect(await cleared(item, "Got it")).toEqual({ type: "acknowledged" });
  });

  it("i7.answered: choosing clears the ticket after the answer note", async () => {
    const item = await file("i7-answered");
    await (await row(item)).getByRole("button", { name: /2 Wednesday/ }).click();
    await page.getByText("Answered: i7-answered: Wednesday", { exact: true }).waitFor();
    expect(await cleared(item, "Answered: Wednesday")).toMatchObject({
      type: "answered",
      choiceIndex: 1,
    });
  });

  it("i7.agent: an agent closes a ticket the user acknowledged in chat", async () => {
    const item = await file("i7-agent");
    const text = `i7-ack ${item.id} thanks, that's done`;
    await cli("thread", "send", chatId, text, "--wait");
    expect(await cleared(item, "Closed from chat")).toEqual({
      type: "agent",
      threadId: chatId,
      messageId: await userMessage(text),
    });
  });

  it("i7.once: closing again keeps the first clearance and one line, across reloads", async () => {
    const [item] = (await ticket("list", { status: "archived", search: "i7-got-it" })).tickets;
    expect(await ticket("close", { id: item.id, by: { type: "acknowledged" } })).toEqual(item);
    await page.reload();
    for (const title of ["i7-replied", "i7-got-it", "i7-answered", "i7-agent"]) {
      const line = page.getByText(`Closed: ${title}`, { exact: true });
      await line.waitFor();
      expect(await line.count()).toBe(1);
    }
  });
});
