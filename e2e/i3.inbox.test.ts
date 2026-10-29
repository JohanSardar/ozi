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

describe("i3.inbox", () => {
  let home: string;
  let env: NodeJS.ProcessEnv;
  let dev: NodeChildProcess.ChildProcess;
  let browser: Playwright.Browser;
  let page: Playwright.Page;
  let inbox: Playwright.Locator;
  let ws: WebSocket;
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
    home = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "ozi-i3-"));
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
      projectId: "project-i3",
      title: "Inbox",
      workspaceRoot: home,
    });
    for (const [threadId, title] of [
      ["dinner-i3", "Friday dinner"],
      ["gym-i3", "Cancel gym"],
    ]) {
      await rpc("orchestration.dispatchCommand", {
        type: "thread.create",
        createdBy: "user",
        creationSource: "web",
        commandId: crypto.randomUUID(),
        threadId,
        projectId: "project-i3",
        title,
        modelSelection: { instanceId: "codex", model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
      });
    }
    await ticket(content("Read", "Landlord replied", "dinner-i3"));
    await ticket(content("Do", "BankID needed", "gym-i3"));
    await ticket(content("Decide", "Pick a restaurant", "dinner-i3", ["Lupo", "Babette"]));
    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(pairingUrl);
    inbox = page.getByRole("complementary", { name: "Inbox" });
    await inbox.getByRole("region", { name: "Decide" }).waitFor();
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

  const text = async (locator: Playwright.Locator) =>
    (await locator.innerText()).replace(/\s+/g, " ").trim();

  it("i3.groups: tickets sit under Decide, Do, Review and Read with counts", async () => {
    await inbox.getByRole("tab", { name: "Inbox 3" }).waitFor();
    const headings = await inbox.getByRole("heading").allInnerTexts();
    expect(headings.map((heading) => heading.replace(/\s+/g, " "))).toEqual([
      "Decide 1 questions and approvals",
      "Do 1 only you can do these",
      "Read 1 nothing to do",
    ]);
    await ticket(content("Review", "Flights booked", "gym-i3"));
    await inbox.getByRole("tab", { name: "Inbox 4" }).waitFor();
    expect(await text(inbox.getByRole("heading", { name: /^Review/ }))).toBe(
      "Review 1 finished work",
    );
    expect(await inbox.locator("article > button svg").count()).toBe(0);
  });

  it("i3.row: the first ticket starts open with need, context, numbered choices and actions", async () => {
    const first = inbox.getByRole("article", { name: "Pick a restaurant" });
    expect(await text(first.getByRole("button", { expanded: true }))).toMatch(
      /^Pick a restaurant Friday dinner · /,
    );
    expect(await first.locator("p.font-semibold").innerText()).toBe("Need for Pick a restaurant.");
    expect(await text(first)).toContain("Summary for Pick a restaurant.");
    const choices = first.getByRole("group", { name: "Choices" }).getByRole("button");
    expect(await choices.allInnerTexts()).toEqual([
      "1\nLupo\nDetail for Lupo",
      "2\nBabette\nDetail for Babette",
    ]);
    await first.getByRole("textbox", { name: "Reply to Pick a restaurant" }).waitFor();
    await first.getByRole("button", { name: "Open details" }).waitFor();
    await inbox
      .getByRole("article", { name: "BankID needed" })
      .getByRole("button", { expanded: false })
      .waitFor();
  });

  it("i3.got-it: Got it archives the ticket and opens the next", async () => {
    await inbox
      .getByRole("article", { name: "Pick a restaurant" })
      .getByRole("button", { name: "Got it" })
      .click();
    await inbox.getByRole("article", { name: "Pick a restaurant" }).waitFor({ state: "detached" });
    await inbox
      .getByRole("article", { name: "BankID needed" })
      .getByRole("button", { expanded: true })
      .waitFor();
    const archived = (await rpc("tickets.list", { status: "archived" })) as {
      tickets: Array<{ cleared: { by: unknown } }>;
    };
    expect(archived.tickets.map((t) => t.cleared.by)).toEqual([{ type: "acknowledged" }]);
  });

  it("i3.archive: the archive lists cleared tickets and searches them", async () => {
    await inbox.getByRole("tab", { name: "Archive" }).click();
    const row = inbox.getByRole("button", { name: /Pick a restaurant/ });
    expect(await text(row)).toMatch(/^Pick a restaurant Got it · Friday dinner/);
    const search = inbox.getByRole("searchbox", { name: "Search archive" });
    await search.fill("nothing like this");
    await inbox.getByText("Nothing matches “nothing like this”").waitFor();
    await search.fill("summary for pick");
    await row.waitFor();
  });

  it("i4.window: Open details shows the whole ticket over the app and clicking outside closes it", async () => {
    await inbox.getByRole("tab", { name: "Inbox" }).click();
    await ticket({
      ...content("Decide", "Pay the passport fee?", "gym-i3", ["Allow", "Deny"]),
      markdown: "Held until **18:00** today.",
    });
    const row = inbox.getByRole("article", { name: "Pay the passport fee?" });
    const header = row.getByRole("button", { name: /^Pay the passport fee\? Cancel gym/ });
    if ((await header.getAttribute("aria-expanded")) === "false") await header.click();
    await row.getByRole("button", { name: "Open details" }).click();
    const window = page.getByRole("dialog", { name: "Pay the passport fee?" });
    expect(await text(window.locator("header"))).toMatch(/^Decide · Cancel gym · /);
    expect(await text(window)).toContain("Need for Pay the passport fee?");
    expect(await text(window.getByRole("region", { name: "What happened" }))).toBe(
      "What happened Summary for Pay the passport fee?.",
    );
    expect(
      await window.getByRole("region", { name: "Details" }).locator("strong").innerText(),
    ).toBe("18:00");
    expect(
      await window.getByRole("region", { name: "Pick one" }).getByRole("button").allInnerTexts(),
    ).toEqual(["1\nAllow\nDetail for Allow", "2\nDeny\nDetail for Deny"]);
    await window.getByRole("button", { name: /^Session transcript Cancel gym/ }).waitFor();
    expect(await text(window.locator("footer"))).toMatch(
      /^Your reply goes to New chat with this ticket attached/,
    );
    await window.getByRole("textbox", { name: "Reply to Pay the passport fee?" }).waitFor();
    await window.getByRole("button", { name: "Got it" }).waitFor();
    await page.mouse.click(8, 450);
    await window.waitFor({ state: "detached" });
  });

  it("i4.send: sending a reply from the window closes it", async () => {
    const row = inbox.getByRole("article", { name: "Pay the passport fee?" });
    await row.getByRole("button", { name: "Open details" }).click();
    const window = page.getByRole("dialog", { name: "Pay the passport fee?" });
    await window.getByRole("textbox", { name: "Reply to Pay the passport fee?" }).fill("Pay it");
    await page.keyboard.press("Enter");
    await window.waitFor({ state: "detached" });
  });

  it("i4.transcript: the session transcript link opens the ticket's chat", async () => {
    await inbox.getByRole("tab", { name: "Archive" }).click();
    await inbox.getByRole("searchbox", { name: "Search archive" }).fill("");
    await inbox.getByRole("button", { name: /^Pay the passport fee\? Replied/ }).click();
    const window = page.getByRole("dialog", { name: "Pay the passport fee?" });
    await window.getByRole("button", { name: /^Session transcript/ }).click();
    await window.waitFor({ state: "detached" });
    await page.waitForURL(/\/gym-i3$/);
  });

  it("i4.archived: archived tickets open in the window with how they cleared", async () => {
    await inbox.getByRole("button", { name: /Pick a restaurant/ }).click();
    const window = page.getByRole("dialog", { name: "Pick a restaurant" });
    expect(await text(window.locator("header"))).toMatch(
      /^Archived · Friday dinner · .* · Got it$/,
    );
    expect(await window.getByRole("region", { name: "Pick one" }).count()).toBe(0);
    expect(await window.getByRole("button", { name: "Got it" }).count()).toBe(0);
    await window.getByRole("textbox", { name: "Reply to Pick a restaurant" }).waitFor();
    await page.keyboard.press("Escape");
    await window.waitFor({ state: "detached" });
  });
});
