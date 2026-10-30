import { startDisplay } from "./display.ts";
import * as NodeChildProcess from "node:child_process";
import * as NodeEvents from "node:events";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { _electron, type ElectronApplication } from "playwright-core";
import { expect, it, onTestFinished } from "vite-plus/test";

const root = NodePath.resolve(import.meta.dirname, "..");
const now = () => (process.env.OZI_G3_MEASURE === "1" ? performance.now() : 0);

it.skipIf(process.platform !== "linux")(
  "G3.desktop-dev: Electron starts, clicks, reloads and reserves native window controls",
  async () => {
    const home = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "ozi-g3-"));
    const source = NodePath.join(root, "apps/web/src/components/chat/DraftHeroHeadline.tsx");
    const original = await NodeFSP.readFile(source, "utf8");
    const display = await startDisplay();
    const env = {
      ...process.env,
      ...display.env,
      PATH: `${NodePath.join(root, "node_modules/.bin")}${NodePath.delimiter}${process.env.PATH ?? ""}`,
      XDG_CONFIG_HOME: NodePath.join(home, "config"),
      XDG_DATA_HOME: NodePath.join(home, "data"),
      XDG_CACHE_HOME: NodePath.join(home, "cache"),
      OZI_DESKTOP_AUTOMATION: "1",
      OZI_DESKTOP_TEST: "1",
      OZI_DESKTOP_TEST_PLATFORM: "darwin",
      RAYON_NUM_THREADS: "2",
      OZI_TELEMETRY_ENABLED: "false",
    };
    const started = now();
    const dev = NodeChildProcess.spawn(
      process.execPath,
      ["scripts/dev-runner.ts", "dev:desktop", "--home-dir", NodePath.join(home, ".ozi")],
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
        await NodeFSP.writeFile(source, original);
        await NodeFSP.rm(home, { recursive: true, force: true });
        await display.close();
      }
    });
    dev.stderr.on("data", (chunk) => {
      output += String(chunk);
    });
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
      const preparedMs = Math.round(now() - started);

      expect(launch.env.OZI_HOME).toBe(NodePath.join(home, ".ozi"));
      expect(launch.env).not.toHaveProperty("VITE_HTTP_URL");
      expect(launch.env).not.toHaveProperty("VITE_WS_URL");
      const electronStarted = now();
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
      expect(launch.args).toContain("--password-store=basic");
      expect(launch.env).not.toHaveProperty("HOME");
      expect(await app.evaluate(() => process.env.HOME)).toBe(process.env.HOME);
      expect(
        await app.evaluate(({ app }) => app.commandLine.getSwitchValue("password-store")),
      ).toBe("basic");
      const page = await app.firstWindow();
      page.on("pageerror", (error) => {
        output += `\n${error.stack}`;
      });
      page.setDefaultTimeout(60_000);
      await page.getByRole("button", { name: "Continue", exact: true }).waitFor();
      const readyMs = Math.round(now() - started);
      const timings = {
        preparedMs,
        readyMs,
        electronMs: Math.round(now() - electronStarted),
        rendererReloadMs: 0,
      };
      expect(await app.evaluate(({ app }) => app.getPath("userData"))).toBe(
        NodePath.join(home, ".ozi", "userdata", "electron"),
      );
      expect(await page.evaluate(() => typeof window.desktopBridge)).toBe("object");
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 1000);
      });
      const screenshotDir = process.env.OZI_G3_SCREENSHOT_DIR ?? home;
      await NodeFSP.mkdir(screenshotDir, { recursive: true });
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await page.screenshot({ path: NodePath.join(screenshotDir, "g3-desktop.png") });
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.getByText("Appearance", { exact: true }).waitFor();
      await page.screenshot({ path: NodePath.join(screenshotDir, "g3-settings.png") });
      await page.keyboard.press("Escape");
      await page.getByText("How can I help?", { exact: true }).waitFor();
      const reloadStarted = now();
      await NodeFSP.writeFile(source, original.replace("How can I help?", "G3 live reload"));
      await page.getByText("G3 live reload", { exact: true }).waitFor();
      timings.rendererReloadMs = Math.round(now() - reloadStarted);
      if (process.env.OZI_G3_MEASURE === "1") {
        console.log(JSON.stringify(timings));
        await NodeFSP.writeFile(
          NodePath.join(screenshotDir, "g3-timings.json"),
          JSON.stringify(timings),
        );
      }
      await page.screenshot({ path: NodePath.join(screenshotDir, "g3-live-reload.png") });
      await NodeFSP.writeFile(source, original);
      await page.getByText("How can I help?", { exact: true }).waitFor();
      await page.reload();
      await page.getByText("How can I help?", { exact: true }).waitFor();
      await page.context().addInitScript(() => {
        Object.defineProperty(navigator, "platform", { value: "MacIntel" });
      });
      await page.reload();
      await page.getByText("How can I help?", { exact: true }).waitFor();
      for (const zoom of [0.8, 1, 1.5]) {
        await app.evaluate(({ BrowserWindow }, factor) => {
          BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(factor);
        }, zoom);
        for (const reloaded of [false, true]) {
          if (reloaded) {
            await page.reload();
            await page.getByText("How can I help?", { exact: true }).waitFor();
          }
          for (const control of [
            page.getByRole("link", { name: "Go to threads" }),
            page
              .getByRole("button", { name: "Toggle main sidebar", exact: true })
              .filter({ visible: true }),
          ]) {
            await expect
              .poll(async () => (await control.boundingBox())?.x)
              .toBeGreaterThanOrEqual(90 / zoom);
          }
          console.log(
            JSON.stringify({
              zoom,
              reloaded,
              brandX: (await page.getByRole("link", { name: "Go to threads" }).boundingBox())?.x,
            }),
          );
        }
        await page.screenshot({
          path: NodePath.join(screenshotDir, `g3-macos-layout-${zoom}.png`),
        });
      }
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]!.setContentSize(1100, 780);
      });
      await page.reload();
      await page.getByText("How can I help?", { exact: true }).waitFor();
      const compactToggle = page
        .getByRole("button", { name: "Toggle main sidebar", exact: true })
        .filter({ visible: true });
      await expect
        .poll(async () => (await compactToggle.boundingBox())?.x)
        .toBeGreaterThanOrEqual(90 / 1.5);
      await compactToggle.click();
      await page.getByRole("button", { name: "Settings", exact: true }).waitFor();
      await page.screenshot({ path: NodePath.join(screenshotDir, "g3-macos-layout-compact.png") });
    } catch (error) {
      for (const page of app?.windows() ?? []) {
        output += `\n${page.url()}\n${await page.locator("body").innerText({ timeout: 1000 }).catch(String)}`;
        if (process.env.OZI_G3_SCREENSHOT_DIR) {
          await page
            .screenshot({
              path: NodePath.join(process.env.OZI_G3_SCREENSHOT_DIR, "g3-failure.png"),
              timeout: 1000,
            })
            .catch(() => undefined);
        }
      }
      throw new Error(`${String(error)}\n${output.slice(-12000)}`, { cause: error });
    }
  },
);
