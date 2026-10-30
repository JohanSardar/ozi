import { startDisplay } from "./display.ts";
import * as NodeChildProcess from "node:child_process";
import * as NodeEvents from "node:events";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import { _electron, type ElectronApplication, type Page } from "playwright-core";
import { expect, it, onTestFinished } from "vite-plus/test";

const exec = NodeUtil.promisify(NodeChildProcess.execFile);
const root = NodePath.resolve(import.meta.dirname, "..");
const bin = NodePath.join(root, "apps/server/src/bin.ts");

it.skipIf(process.platform !== "linux")(
  "i8.notify: new tickets notify, open on click, badge the open count and obey both toggles",
  async () => {
    const home = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "ozi-i8-"));
    const ozi = NodePath.join(home, ".ozi");
    const display = await startDisplay();
    const env = {
      ...process.env,
      ...display.env,
      PATH: `${NodePath.join(root, "node_modules/.bin")}${NodePath.delimiter}${process.env.PATH ?? ""}`,
      XDG_CONFIG_HOME: NodePath.join(home, "config"),
      XDG_DATA_HOME: NodePath.join(home, "data"),
      XDG_CACHE_HOME: NodePath.join(home, "cache"),
      XDG_CURRENT_DESKTOP: "Unity",
      OZI_DESKTOP_AUTOMATION: "1",
      OZI_DESKTOP_TEST: "1",
      OZI_TELEMETRY_ENABLED: "false",
    };
    const cli = async (...args: string[]) =>
      JSON.parse(
        (await exec(process.execPath, [bin, ...args, "--home", ozi, "--json"], { cwd: home, env }))
          .stdout,
      );
    const dev = NodeChildProcess.spawn(
      process.execPath,
      ["scripts/dev-runner.ts", "dev:desktop", "--home-dir", ozi],
      { cwd: root, env, detached: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    let app: ElectronApplication | undefined;
    let output = "";
    onTestFinished(async () => {
      const forceStop = setTimeout(() => app?.process().kill("SIGKILL"), 5000).unref();
      try {
        await app?.close();
      } finally {
        clearTimeout(forceStop);
        if (dev.pid !== undefined && dev.exitCode === null) {
          const exited = NodeEvents.once(dev, "exit", { signal: AbortSignal.timeout(5000) });
          process.kill(-dev.pid, "SIGTERM");
          await exited.catch(() => dev.kill("SIGKILL"));
        }
        await NodeFSP.rm(home, { recursive: true, force: true });
        await display.close();
      }
    });
    dev.stderr.on("data", (chunk) => {
      output += String(chunk);
    });
    const notes = (page: Page) =>
      page.evaluate(() =>
        (window as unknown as { notes: Array<{ title: string; body: string }> }).notes.map(
          ({ title, body }) => `${title}: ${body}`,
        ),
      );
    const badge = () => app!.evaluate(({ app }) => app.getBadgeCount());
    try {
      const launch = await new Promise<{
        cwd: string;
        electronPath: string;
        args: string[];
        env: Record<string, string>;
      }>((resolve, reject) => {
        dev.stdout.on("data", (chunk) => {
          output += String(chunk);
          const match = output.match(/\[desktop-dev\] ready (.+)\n/);
          if (match?.[1]) resolve(JSON.parse(match[1]));
        });
        dev.once("error", reject);
        dev.once("exit", (code) => reject(new Error(`Dev exited ${code}: ${output}`)));
      });
      app = await _electron.launch({
        executablePath: launch.electronPath,
        args: launch.args,
        cwd: launch.cwd,
        env: Object.fromEntries(
          Object.entries({ ...env, ...launch.env }).filter(
            (entry): entry is [string, string] =>
              entry[1] !== undefined && entry[0] !== "ELECTRON_RUN_AS_NODE",
          ),
        ),
        timeout: 30_000,
      });
      app.process().stderr?.on("data", (chunk) => {
        output += String(chunk);
      });
      const page = await app.firstWindow();
      page.setDefaultTimeout(60_000);
      await page.getByRole("button", { name: "Continue", exact: true }).waitFor();
      for (const name of ["Continue", "Continue"]) {
        const button = page.getByRole("button", { name, exact: true });
        if (await button.isVisible()) await button.click();
      }
      const inbox = page.getByRole("complementary", { name: "Inbox" });
      await inbox.waitFor();
      await page.evaluate(() => {
        const notes: Array<EventTarget & { title: string; body: string }> = [];
        class Recorded extends EventTarget {
          static permission = "granted";
          constructor(
            readonly title: string,
            readonly options: NotificationOptions,
          ) {
            super();
            notes.push(Object.assign(this, { body: options.body ?? "" }));
          }
          close() {}
        }
        Object.assign(window, { Notification: Recorded, notes });
        document.hasFocus = () => false;
      });
      const { threadId } = await cli(
        "session",
        "new",
        "--title",
        "i8 chat",
        "--provider",
        "codex",
        "--model",
        "gpt-5.4",
      );
      const file = (group: string, title: string, need: string) =>
        cli(
          "ticket",
          "create",
          "--input",
          JSON.stringify({
            group,
            title,
            need,
            summary: `Summary for ${title}.`,
            choices: [],
            markdown: "",
            attachments: [],
            htmlPages: [],
            threadId,
          }),
        );
      await file("Decide", "Pick a restaurant", "Choose where to eat on Friday.");
      await file("Read", "Landlord replied", "Read the landlord's reply.");
      await expect
        .poll(() => notes(page))
        .toEqual([
          "Pick a restaurant: Choose where to eat on Friday.",
          "Landlord replied: Read the landlord's reply.",
        ]);
      await expect.poll(badge).toBe(2);
      await inbox
        .getByRole("article", { name: "Landlord replied" })
        .getByRole("button", { expanded: false })
        .waitFor();
      await page.evaluate(() =>
        (window as unknown as { notes: EventTarget[] }).notes[1]!.dispatchEvent(new Event("click")),
      );
      await inbox
        .getByRole("article", { name: "Landlord replied" })
        .getByRole("button", { expanded: true })
        .waitFor();
      const shots = process.env.OZI_I8_SCREENSHOT_DIR;
      if (shots) await page.screenshot({ path: NodePath.join(shots, "i8-opened.png") });

      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.getByRole("switch", { name: "Ticket notifications" }).click();
      await page.getByRole("switch", { name: "Dock badge" }).click();
      await expect.poll(badge).toBe(0);
      await file("Do", "BankID needed", "Log in with BankID.");
      await page.getByRole("switch", { name: "Dock badge" }).click();
      await expect.poll(badge).toBe(3);
      expect(await notes(page)).toHaveLength(2);
      if (shots) await page.screenshot({ path: NodePath.join(shots, "i8-settings.png") });
    } catch (error) {
      throw new Error(`${String(error)}\n${output.slice(-12000)}`, { cause: error });
    }
  },
);
