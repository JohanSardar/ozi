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

it("p5.extension-ui: Pi extension UI persists and its dialogs answer from web and CLI", async () => {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "ozi-p5-"));
  const home = NodePath.join(directory, ".ozi");
  const project = NodePath.join(directory, "project");
  await NodeFSP.mkdir(NodePath.join(home, "userdata"), { recursive: true });
  await NodeFSP.mkdir(project);
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
  const serve = () =>
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
      { cwd: project, env },
      /Ozi server is ready\./,
    );
  const ozi = async (...args: Array<string>) =>
    JSON.parse((await exec(process.execPath, [bin, ...args, "--home", home, "--json"])).stdout);
  const stopWeb = await start(
    NodePath.join(root, "node_modules/.bin/vp"),
    ["dev", "--strictPort"],
    { cwd: NodePath.join(root, "apps/web"), env },
    /ready in/,
  );
  let stopServer = await serve();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.addInitScript(() =>
      localStorage.setItem(
        "ozi:client-settings:v1",
        JSON.stringify({ onboardingCompletedAt: "2026-01-01T00:00:00.000Z" }),
      ),
    );
    await page.goto((await ozi("pair")).pairingUrl);
    const composer = page.getByRole("textbox", { name: /^Message/ });
    await composer.click();
    await composer.pressSequentially("extension ui");
    await composer.press("Enter");

    const widgets = page.getByLabel("Extension widgets");
    const status = page.getByLabel("Extension status");
    await page.getByText("Trip planner", { exact: true }).waitFor();
    await widgets.getByText(/^Plan\s+1\. Pack$/).waitFor();
    await status.getByText("Below the editor", { exact: true }).waitFor();
    await status.getByText("Mail 2", { exact: true }).waitFor();
    await page.getByText("Turn notice").first().waitFor();

    await page.getByRole("button", { name: /^Blue/ }).click();
    await page.getByText("Your name", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "Dismiss question without answering", exact: true })
      .click();

    const threadId = (await ozi("thread", "list"))[0].threadId as string;
    const waiting = async (type: string) => {
      for (;;) {
        const { activity } = await ozi("thread", "show", threadId, "--activity");
        const item = activity.find(
          (entry: { type: string; status: string }) =>
            entry.type === type && entry.status === "waiting",
        );
        if (item) return item.requestId as string;
      }
    };
    await ozi(
      "answer",
      "--thread",
      threadId,
      await waiting("approval_request"),
      '{"decision":"accept"}',
    );
    await ozi(
      "answer",
      "--thread",
      threadId,
      await waiting("user_input_request"),
      '{"answers":{"note":"Pack light, bring a hat"}}',
    );
    await page
      .getByText(
        'Fake reply: dialogs [{"value":"Blue"},{"cancelled":true},{"confirmed":true},{"value":"Pack light, bring a hat"}]',
        { exact: true },
      )
      .waitFor();
    await widgets.getByText("Idle notice", { exact: true }).waitFor();
    await expect.poll(() => composer.textContent()).toBe("Draft from extension");

    await stopServer();
    stopServer = await serve();
    await page.reload();
    await page.getByText("Trip planner", { exact: true }).waitFor();
    await widgets.getByText("Idle notice", { exact: true }).waitFor();
    await widgets.getByText(/^Plan\s+1\. Pack$/).waitFor();
    await status.getByText("Mail 2", { exact: true }).waitFor();
    const { thread } = await ozi("thread", "show", threadId);
    expect(thread.extensionUi).toEqual({
      revision: 8,
      statuses: { mail: "Mail 2" },
      widgets: {
        plan: { lines: ["Plan", "1. Pack"], placement: "aboveEditor" },
        foot: { lines: ["Below the editor"], placement: "belowEditor" },
      },
      title: "Trip planner",
      notices: [
        { id: "idle-notice", message: "Idle notice", type: "warning", at: expect.any(String) },
      ],
      editorText: { text: "Draft from extension", at: expect.any(String) },
    });
  } finally {
    await browser.close();
    await stopServer();
    await stopWeb();
    await NodeFSP.rm(directory, { recursive: true, force: true });
  }
});
