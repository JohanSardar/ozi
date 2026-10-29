import * as NodeChildProcess from "node:child_process";
import * as NodeEvents from "node:events";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { _electron, type ElectronApplication } from "playwright-core";
import { expect, it } from "vite-plus/test";
import { measure } from "./g3.measure.ts";

const root = NodePath.resolve(import.meta.dirname, "..");

it("g3.desktop-dev: Electron starts on Xvfb, clicks, reloads and reserves the window controls inset", async () => {
  const home = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "ozi-g3-"));
  const source = NodePath.join(root, "apps/web/src/components/NoProjectsHero.tsx");
  const original = await NodeFSP.readFile(source, "utf8");
  const env = {
    ...process.env,
    HOME: home,
    PATH: `${NodePath.join(root, "node_modules/.bin")}${NodePath.delimiter}${process.env.PATH ?? ""}`,
    XDG_CONFIG_HOME: NodePath.join(home, "config"),
    XDG_DATA_HOME: NodePath.join(home, "data"),
    XDG_CACHE_HOME: NodePath.join(home, "cache"),
    OZI_DESKTOP_AUTOMATION: "1",
    RAYON_NUM_THREADS: "2",
    OZI_TELEMETRY_ENABLED: "false",
  };
  const started = measure();
  const dev = NodeChildProcess.spawn(
    process.execPath,
    ["scripts/dev-runner.ts", "dev:desktop", "--home-dir", NodePath.join(home, ".ozi")],
    { cwd: root, env, detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  let app: ElectronApplication | undefined;
  let output = "";
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
        if (process.env.OZI_G3_DEBUG) console.log(String(chunk));
        const match = output.match(/\[desktop-dev\] ready (.+)\n/);
        if (match?.[1]) resolve(JSON.parse(match[1]));
      });
      dev.once("error", reject);
      dev.once("exit", (code) => reject(new Error(`Dev exited ${code}: ${output}`)));
    });
    const preparedMs = Math.round(measure() - started);
    expect(launch.env.OZI_HOME).toBe(NodePath.join(home, ".ozi"));
    expect(launch.env).not.toHaveProperty("VITE_HTTP_URL");
    expect(launch.env).not.toHaveProperty("VITE_WS_URL");
    const electronStarted = measure();
    app = await _electron.launch({
      executablePath: launch.electronPath,
      args: [...launch.args, "--ozone-platform=x11"],
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
    page.setDefaultTimeout(15_000);
    await page.getByText("What should we work on?", { exact: true }).waitFor();
    const readyMs = Math.round(measure() - started);
    console.log(
      JSON.stringify({
        preparedMs,
        readyMs,
        electronMs: Math.round(measure() - electronStarted),
      }),
    );
    expect(await app.evaluate(({ app }) => app.getPath("userData"))).toContain(home);
    expect(await page.evaluate(() => typeof window.desktopBridge)).toBe("object");
    const screenshotDir = process.env.OZI_G3_SCREENSHOT_DIR ?? home;
    await NodeFSP.mkdir(screenshotDir, { recursive: true });
    await page.screenshot({ path: NodePath.join(screenshotDir, "g3-desktop.png") });
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Appearance", exact: true }).waitFor();
    await page.screenshot({ path: NodePath.join(screenshotDir, "g3-settings.png") });
    await page.keyboard.press("Escape");
    await page.getByText("What should we work on?", { exact: true }).waitFor();
    const reloadStarted = measure();
    await NodeFSP.writeFile(source, original.replace("What should we work on?", "G3 live reload"));
    await page.getByText("G3 live reload", { exact: true }).waitFor();
    console.log(
      JSON.stringify({ rendererReloadMs: Math.round(measure() - reloadStarted) }),
    );
    await NodeFSP.writeFile(source, original);
    await page.getByText("What should we work on?", { exact: true }).waitFor();
    await page.reload();
    await page.getByText("What should we work on?", { exact: true }).waitFor();
    for (const zoom of [0.8, 1, 1.5]) {
      await app.evaluate(({ BrowserWindow }, factor) => {
        BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(factor);
      }, zoom);
      await page.evaluate((inset) => {
        document
          .querySelectorAll<HTMLElement>("[data-slot='sidebar-wrapper'], [data-app-sidebar]")
          .forEach((element) =>
            element.style.setProperty("--workspace-controls-left", `${inset}px`),
          );
      }, 90 / zoom);
      const brand = await page.getByRole("link", { name: "Go to threads" }).boundingBox();
      expect(brand?.x).toBeGreaterThanOrEqual(90 / zoom);
    }
  } catch (error) {
    throw new Error(`${String(error)}\n${output.slice(-12000)}`, { cause: error });
  } finally {
    await NodeFSP.writeFile(source, original);
    await app?.close();
    if (dev.pid !== undefined && dev.exitCode === null) {
      const exited = NodeEvents.once(dev, "exit");
      process.kill(-dev.pid, "SIGTERM");
      await exited;
    }
    await NodeFSP.rm(home, { recursive: true, force: true });
  }
});
