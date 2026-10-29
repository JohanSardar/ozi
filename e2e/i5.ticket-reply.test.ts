import * as NodeChildProcess from "node:child_process";
import * as NodeEvents from "node:events";
import * as NodeFSP from "node:fs/promises";
import * as NodeModule from "node:module";
import * as NodeNet from "node:net";
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

async function freePort() {
  const server = NodeNet.createServer().listen(0, "127.0.0.1");
  await NodeEvents.once(server, "listening");
  const { port } = server.address() as NodeNet.AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function start(
  command: string,
  args: Array<string>,
  options: NodeChildProcess.SpawnOptions,
  ready: RegExp,
) {
  const child = NodeChildProcess.spawn(command, args, { ...options, stdio: "pipe" });
  const stop = async () => {
    if (child.exitCode !== null) return;
    const exited = NodeEvents.once(child, "exit");
    child.kill("SIGTERM");
    await exited;
  };
  let output = "";
  await new Promise<void>((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      output += String(chunk);
      if (ready.test(output)) resolve();
    };
    child.stdout!.on("data", onData);
    child.stderr!.on("data", onData);
    child.once("exit", (code) => reject(new Error(`${command} exited ${code}: ${output}`)));
  });
  return stop;
}

describe("i5.ticket-reply", () => {
  let directory: string;
  let home: string;
  let env: NodeJS.ProcessEnv;
  let webPort: number;
  let stops: Array<() => Promise<void>> = [];
  let browser: Playwright.Browser;
  let page: Playwright.Page;
  let inbox: Playwright.Locator;
  let ticketId: string;
  let dentist: string;
  let friday: string;
  const run = async (...args: Array<string>) =>
    (await exec(process.execPath, [bin, ...args, "--home", home], { env })).stdout;
  const ozi = async (...args: Array<string>) => JSON.parse(await run(...args, "--json"));
  const threadId = () => decodeURIComponent(new URL(page.url()).pathname.split("/").at(-1)!);
  const lastAnswer = async (thread: string) =>
    (await ozi("thread", "show", thread, "--messages", "1")).messages[0].text as string;
  const quote = "Pick a dentist slot · Choose Tuesday or Wednesday.";
  const replied = async (text: string) => {
    await page
      .locator("[data-user-message-body]")
      .filter({ hasText: quote })
      .filter({ hasText: text })
      .waitFor();
    await page
      .locator("[data-assistant-citation-source]")
      .filter({ hasText: "Fake reply: [Ticket: Pick a dentist slot; ref=" })
      .filter({ hasText: text })
      .waitFor();
  };

  beforeAll(async () => {
    directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "ozi-i5-"));
    home = NodePath.join(directory, ".ozi");
    await NodeFSP.mkdir(NodePath.join(home, "userdata"), { recursive: true });
    await NodeFSP.writeFile(
      NodePath.join(home, "userdata/settings.json"),
      JSON.stringify({
        defaultModelSelection: { instanceId: "pi", model: "fake/fake-model" },
        providerInstances: {
          pi: {
            driver: "pi",
            enabled: true,
            config: { binaryPath: NodePath.join(root, "e2e/fakes/pi.ts") },
          },
        },
      }),
    );
    const serverPort = await freePort();
    webPort = await freePort();
    env = {
      ...process.env,
      HOME: directory,
      OZI_HOME: "",
      OZI_TELEMETRY_ENABLED: "false",
      OZI_PORT: String(serverPort),
      OZI_SINGLE_ORIGIN_DEV: "1",
      PORT: String(webPort),
    };
    delete env.HOST;
    stops = await Promise.all([
      start(
        NodePath.join(root, "node_modules/.bin/vp"),
        ["dev", "--strictPort"],
        { cwd: NodePath.join(root, "apps/web"), env },
        /ready in/,
      ),
      start(
        process.execPath,
        [
          bin,
          "serve",
          "--port",
          String(serverPort),
          "--host",
          "127.0.0.1",
          "--home",
          home,
          "--dev-url",
          `http://localhost:${webPort}`,
        ],
        { cwd: directory, env },
        /Ozi server is ready\./,
      ),
    ]);
    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.addInitScript(() =>
      localStorage.setItem(
        "ozi:client-settings:v1",
        JSON.stringify({ onboardingCompletedAt: "2026-01-01T00:00:00.000Z" }),
      ),
    );
    await page.goto((await ozi("pair")).pairingUrl);
    inbox = page.getByRole("complementary", { name: "Inbox" });
  });

  afterAll(async () => {
    await browser?.close();
    for (const stop of stops) await stop();
    await NodeFSP.rm(directory, { recursive: true, force: true });
  });

  it("i5.row: a reply typed on a row goes into the chat the user is in with the ticket", async () => {
    const project = NodePath.join(directory, "project");
    await NodeFSP.mkdir(project);
    await run("project", "add", project);
    dentist = (await ozi("thread", "start", project, "Book the dentist")).threadId;
    friday = (await ozi("thread", "start", project, "Plan Friday")).threadId;
    ticketId = (
      await ozi(
        "ticket",
        "create",
        "--input",
        JSON.stringify({
          threadId: dentist,
          group: "Decide",
          title: "Pick a dentist slot",
          need: "Choose Tuesday or Wednesday.",
          summary: "Dr Berg has two free slots next week.",
          choices: [
            { label: "Tuesday", detail: "Tue 14:00" },
            { label: "Wednesday", detail: "Wed 09:30" },
          ],
          markdown: "The clinic holds a slot for one day.",
          attachments: [],
          htmlPages: [],
        }),
      )
    ).id;
    await page.getByRole("treeitem", { name: /^Settled/ }).click();
    await page.getByRole("treeitem", { name: /Plan Friday/ }).click();
    await page.getByText("Fake reply: Plan Friday", { exact: true }).waitFor();
    expect(threadId()).toBe(friday);

    const row = inbox.getByRole("textbox", { name: "Reply to Pick a dentist slot" });
    await row.fill("Wednesday works");
    await row.press("Enter");
    await replied("Wednesday works");
    expect(threadId()).toBe(friday);
    const received = await lastAnswer(friday);
    for (const line of [
      "need: Choose Tuesday or Wednesday.",
      "  Dr Berg has two free slots next week.",
      "  2. Wednesday: Wed 09:30",
      "  The clinic holds a slot for one day.",
      `transcript: http://localhost:${webPort}/api/orchestration/threads/${encodeURIComponent(dentist)}/transcript`,
      `ticketId: ${ticketId}`,
      `threadId: ${dentist}`,
      `chatId: ${dentist}`,
      "It is still open in the inbox.",
    ]) {
      expect(received).toContain(line);
    }
    expect(received).toMatch(/origin: Filed by the chat ".+" on \d{4}-/);
    expect(await lastAnswer(dentist)).toBe("Fake reply: Book the dentist");
  });

  it("i5.window: a reply sent from the ticket window closes it and goes into the current chat", async () => {
    await inbox.getByRole("button", { name: "Open details" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByText(/^Your reply goes to .+ with this ticket attached$/).waitFor();
    const box = dialog.getByRole("textbox", { name: "Reply to Pick a dentist slot" });
    await box.fill("Or Tuesday");
    await box.press("Enter");
    await dialog.waitFor({ state: "detached" });
    await replied("Or Tuesday");
    expect(threadId()).toBe(friday);
  });

  it("i5.archive: an archived ticket replies into the current chat too", async () => {
    await inbox.getByRole("button", { name: "Got it" }).click();
    await inbox.getByRole("tab", { name: "Archive" }).click();
    await inbox.getByRole("button", { name: /Pick a dentist slot/ }).click();
    const box = page
      .getByRole("dialog")
      .getByRole("textbox", { name: "Reply to Pick a dentist slot" });
    await box.fill("Thanks");
    await box.press("Enter");
    await replied("Thanks");
    expect(threadId()).toBe(friday);
    expect(await lastAnswer(friday)).toContain("It was archived on ");
  });

  it("i5.new-chat: replying from a new chat starts that chat", async () => {
    await page.getByRole("button", { name: "New thread" }).first().click();
    await page.waitForURL(/\/draft\//);
    await inbox.getByRole("button", { name: /Pick a dentist slot/ }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByText("Your reply goes to New chat with this ticket attached").waitFor();
    const box = dialog.getByRole("textbox", { name: "Reply to Pick a dentist slot" });
    await box.fill("Book it");
    await box.press("Enter");
    await replied("Book it");
    await page.waitForURL((url) => !url.pathname.includes("/draft/"));
    expect([dentist, friday]).not.toContain(threadId());
    expect((await ozi("thread", "show", threadId())).thread.title).toBe("Pick a dentist slot");
  });
});
