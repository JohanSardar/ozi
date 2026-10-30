import * as NodeChildProcess from "node:child_process";
import * as NodeEvents from "node:events";
import * as NodeFSP from "node:fs/promises";
import * as NodeModule from "node:module";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import { expect, it } from "vite-plus/test";

const exec = NodeUtil.promisify(NodeChildProcess.execFile);
const root = NodePath.resolve(import.meta.dirname, "..");
const bin = NodePath.join(root, "apps/server/src/bin.ts");
const { chromium } = NodeModule.createRequire(NodePath.join(root, "apps/web/package.json"))(
  "playwright",
) as typeof import("playwright");

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

it("g4.settings-sections: settings keeps only Ozi's sections and finds moved settings", async () => {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "ozi-g4-"));
  const home = NodePath.join(directory, ".ozi");
  const serverPort = await freePort();
  const webPort = await freePort();
  const env = {
    ...process.env,
    HOME: directory,
    OZI_HOME: "",
    OZI_TELEMETRY_ENABLED: "false",
    OZI_PORT: String(serverPort),
    OZI_SINGLE_ORIGIN_DEV: "1",
    PORT: String(webPort),
  };
  delete env.HOST;
  const stops = [
    await start(
      NodePath.join(root, "node_modules/.bin/vp"),
      ["dev", "--strictPort"],
      { cwd: NodePath.join(root, "apps/web"), env },
      /ready in/,
    ),
    await start(
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
  ];
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.addInitScript(() =>
      localStorage.setItem(
        "ozi:client-settings:v1",
        JSON.stringify({ onboardingCompletedAt: "2026-01-01T00:00:00.000Z" }),
      ),
    );
    const { pairingUrl } = JSON.parse(
      (await exec(process.execPath, [bin, "pair", "--home", home, "--json"], { env })).stdout,
    );
    await page.goto(pairingUrl);
    await page.getByRole("textbox", { name: /^Message/ }).waitFor();
    const origin = new URL(page.url()).origin;
    await page.goto(`${origin}/settings`);

    const sections = page.getByRole("tree", { name: "Settings sections" });
    await sections.getByRole("treeitem", { name: "General" }).waitFor();
    expect(await sections.getByRole("treeitem").allInnerTexts()).toEqual([
      "General",
      "Appearance",
      "Chat",
      "Keybindings",
      "Providers",
      "Browser",
      "Scheduled tasks",
      "Environments",
      "Sharing & access",
      "Maintenance",
      "About",
    ]);
    expect(
      await sections.getByRole("group", { name: "Agents" }).getByRole("treeitem").allInnerTexts(),
    ).toEqual(["Providers", "Browser", "Scheduled tasks"]);
    expect(
      await sections
        .getByRole("group", { name: "Connections" })
        .getByRole("treeitem")
        .allInnerTexts(),
    ).toEqual(["Environments", "Sharing & access"]);

    await page.getByRole("switch", { name: "Ticket notifications" }).waitFor();
    await page.getByRole("switch", { name: "Dock badge" }).waitFor();

    const search = page.getByRole("combobox", { name: "Search settings" });
    for (const removed of ["SnapShots", "Snooze options", "Archived threads", "Labs"]) {
      await search.fill(removed);
      await page.getByText("No settings found").waitFor();
    }
    await search.fill("Text generation model");
    await page.getByRole("option", { name: /Text generation model\s*Chat/ }).click();
    await page.waitForURL(/\/settings\/chat/);
    await page.getByText("New chats", { exact: true }).first().waitFor();
    await page.getByText("Text generation model", { exact: true }).first().waitFor();

    await page.goto(`${origin}/settings/labs`);
    await sections.waitFor({ state: "detached" });
  } finally {
    await browser.close();
    for (const stop of stops) await stop();
    await NodeFSP.rm(directory, { recursive: true, force: true });
  }
});
