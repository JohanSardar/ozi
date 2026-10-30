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
  need: "Choose a release channel.",
  summary: "The build is ready. Choose where it goes.",
  choices: ["Stable", "Preview", "Canary", "Hold"].map((label) => ({
    label,
    detail: `Use ${label}.`,
  })),
  markdown: "Full release context.",
  attachments: [],
  htmlPages: [],
});

describe("i6.choices", () => {
  let home: string;
  let workspace: string;
  let env: NodeJS.ProcessEnv;
  let dev: NodeChildProcess.ChildProcess;
  let browser: Playwright.Browser;
  let page: Playwright.Page;
  let inbox: Playwright.Locator;
  let fake: Awaited<ReturnType<typeof startAnthropic>>;
  let main: Ticket;
  let worker: Ticket;
  let currentId: string;
  let pairingUrl: string;
  let output = "";
  const steps = new Map<string, number>();
  const requests = new NodeEvents.EventEmitter();
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
  const show = (id: string) => cli("thread", "show", id, "--messages", "100");
  const ready = async (item: Ticket, index: number) => {
    await inbox.getByRole("article", { name: item.title }).waitFor({ state: "detached" });
    const archived: Ticket = await ticket("get", { id: item.id });
    expect(archived.cleared?.by).toMatchObject({
      type: "answered",
      threadId: item.origin.threadId,
      choiceIndex: index,
    });
    expect(archived.origin).toEqual(item.origin);
    const source = await show(item.origin.threadId);
    const answer = source.messages.find((message: { text: string }) =>
      message.text.startsWith(`Ticket: ${item.title}\n`),
    );
    expect(answer.text).toContain(`Chosen option ${index + 1}: ${item.choices[index]!.label}`);
    await page
      .getByText(`Answered: ${item.title}: ${item.choices[index]!.label}`, { exact: true })
      .waitFor();
    const current = await show(currentId);
    expect(current.thread.runCount).toBe(1);
    expect(
      current.messages.some((message: { text: string }) => message.text.includes("Chosen option")),
    ).toBe(false);
    await new Promise<void>((resolve) => {
      const check = () => {
        if (
          !fake.requests.some((request) =>
            JSON.stringify(request.messages).includes(JSON.stringify(answer.text).slice(1, -1)),
          )
        )
          return;
        requests.off("request", check);
        resolve();
      };
      requests.on("request", check);
      check();
    });
  };

  beforeAll(async () => {
    home = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "ozi-i6-"));
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
      requests.emit("request");
      const messages = JSON.stringify(request.messages);
      if (messages.includes("i6-current")) return { text: "i6-current-ready" };
      if (messages.includes("Chosen option")) return { text: "i6-answer-received" };
      const create = request.tools.find((tool) => tool.name.endsWith("ticket_create"));
      if (!create) {
        const search = request.tools.find(
          (tool) => tool.name.endsWith("tool_search") || tool.name === "ToolSearch",
        );
        return search
          ? { tool: search.name, arguments: { query: "ticket", limit: 4 } }
          : { text: "i6-ready" };
      }
      const name = request.model.includes("sonnet") ? "i6-worker" : "i6-main";
      const step = steps.get(name) ?? 0;
      steps.set(name, step + 1);
      if (step === 0) return { tool: create.name, arguments: content(name) };
      if (step === 1 && name === "i6-main")
        return {
          tool: request.tools.find((tool) => tool.name.endsWith("delegate_task"))!.name,
          arguments: {
            task: "i6-worker: file a release channel ticket.",
            title: "i6-worker",
            target: { providerInstanceId: "claudeAgent", model: "claude-sonnet-5-5" },
            mode: "wait",
          },
        };
      return { text: `${name}-ready` };
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
    ({ pairingUrl } = await cli("pair"));
    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    inbox = page.getByRole("complementary", { name: "Inbox" });
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

  it("i6.origins: Pi main and Claude worker file their own tickets", async () => {
    const started = await cli(
      "thread",
      "start",
      "--cwd",
      workspace,
      "i6-main: file a ticket and delegate.",
      "--wait",
    );
    expect(JSON.stringify(started), output).toContain("i6-main-ready");
    const listed = await ticket("list");
    main = listed.tickets.find((item: Ticket) => item.title === "i6-main");
    worker = listed.tickets.find((item: Ticket) => item.title === "i6-worker");
    expect(listed.tickets, JSON.stringify(started)).toHaveLength(2);
    expect(main.origin.workerId).toBe(null);
    expect(worker.origin.workerId).toBe(worker.origin.threadId);
  });

  it("i6.main: clicking an option answers its Pi main and notes it in the current chat", async () => {
    ({ threadId: currentId } = await cli(
      "thread",
      "start",
      "--cwd",
      workspace,
      "i6-current",
      "--wait",
    ));
    await page.goto(pairingUrl);
    await page.getByRole("treeitem", { name: /i6-current/ }).click();
    const row = inbox.getByRole("article", { name: main.title });
    const header = row.getByRole("button", { expanded: false });
    if (await header.count()) await header.click();
    await row.getByRole("button", { name: /1 Stable/ }).click();
    await ready(main, 0);
  });

  it("i6.worker: choosing in details answers the Claude worker and closes the window", async () => {
    const row = inbox.getByRole("article", { name: worker.title });
    await row.getByRole("button", { name: "Open details" }).click();
    const window = page.getByRole("dialog", { name: worker.title });
    await window.getByRole("button", { name: /2 Preview/ }).click();
    await window.waitFor({ state: "detached" });
    await ready(worker, 1);
  });

  it.each([0, 1, 2, 3])("i6.keys: option index %i responds outside text fields", async (index) => {
    const item: Ticket = await ticket("create", {
      ...content(`i6-key-${index + 1}`),
      threadId: main.origin.threadId,
    });
    const row = inbox.getByRole("article", { name: item.title });
    const reply = row.getByRole("textbox");
    await reply.fill("3");
    await page.keyboard.press("4");
    expect((await ticket("get", { id: item.id })).status).toBe("open");
    await reply.fill("");
    await row.getByRole("button", { name: "Open details" }).focus();
    await page.keyboard.press(String(index + 1));
    await ready(item, index);
  });

  it("i6.retry: duplicate choices preserve the first answer and note; invalid input stays open", async () => {
    const item: Ticket = await ticket("create", {
      ...content("i6-retry"),
      choices: content("").choices.slice(0, 2),
      threadId: worker.origin.threadId,
    });
    await expect(
      ticket("choose", { id: item.id, choiceIndex: 3, chatId: currentId }),
    ).rejects.toThrow();
    await expect(
      ticket("choose", { id: item.id, choiceIndex: 0, chatId: "missing" }),
    ).rejects.toThrow();
    expect((await ticket("get", { id: item.id })).status).toBe("open");
    const before = await show(worker.origin.threadId);
    const [first, second] = await Promise.all([
      ticket("choose", { id: item.id, choiceIndex: 1, chatId: currentId }),
      ticket("choose", { id: item.id, choiceIndex: 1, chatId: currentId }),
    ]);
    expect(first).toEqual(second);
    expect(await ticket("choose", { id: item.id, choiceIndex: 0, chatId: currentId })).toEqual(
      first,
    );
    await ready(item, 1);
    const after = await show(worker.origin.threadId);
    expect(
      after.messages.filter((message: { role: string }) => message.role === "user").length -
        before.messages.filter((message: { role: string }) => message.role === "user").length,
    ).toBe(1);
    const current = await show(currentId);
    expect(current.thread.runCount).toBe(1);
    expect(await page.getByText("Answered: i6-retry: Preview", { exact: true }).count()).toBe(1);
    await inbox.getByRole("tab", { name: "Archive" }).click();
    await inbox.getByRole("button", { name: /i6-retry Answered: Preview/ }).waitFor();
    await page.reload();
    await page.getByText("Answered: i6-retry: Preview", { exact: true }).waitFor();
  });
});
