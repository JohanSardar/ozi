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

it("l3.composer: steer, queue, stop and attachments behave as in T3", async () => {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "ozi-l3-"));
  const home = NodePath.join(directory, ".ozi");
  const project = NodePath.join(directory, "project");
  const files = NodePath.join(directory, "files");
  await NodeFSP.mkdir(NodePath.join(home, "userdata"), { recursive: true });
  await NodeFSP.mkdir(project);
  await NodeFSP.mkdir(files);
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
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  await NodeFSP.writeFile(NodePath.join(files, "receipt.png"), png);
  await NodeFSP.writeFile(NodePath.join(files, "clip.mp4"), Buffer.alloc(64));
  await NodeFSP.writeFile(NodePath.join(files, "notes.txt"), "lunch on Tuesday");
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
      {
        cwd: NodePath.join(root, "apps/web"),
        env,
      },
      /ready in/,
    ),
    await start(
      process.execPath,
      [
        NodePath.join(root, "apps/server/src/bin.ts"),
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
    ),
  ];
  const browser = await chromium.launch();
  try {
    const { stdout } = await exec(process.execPath, [
      NodePath.join(root, "apps/server/src/bin.ts"),
      "pair",
      "--home",
      home,
      "--json",
    ]);
    const page = await browser.newPage();
    await page.addInitScript(() =>
      localStorage.setItem(
        "ozi:client-settings:v1",
        JSON.stringify({ onboardingCompletedAt: "2026-01-01T00:00:00.000Z" }),
      ),
    );
    await page.goto(JSON.parse(stdout).pairingUrl);
    await page.getByRole("button", { name: "Start without a project" }).click();
    const composer = page.getByRole("textbox", { name: /^Message/ });
    const say = async (text: string, modifiers: Array<"Control"> = []) => {
      await composer.click();
      await composer.pressSequentially(text);
      await composer.press(modifiers.length > 0 ? "Control+Enter" : "Enter");
    };

    await say("hold this turn open");
    await page.getByText("Fake reply: hold this turn open", { exact: true }).waitFor();
    await page.getByText("Enter steers · Ctrl+Enter queues", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Stop generation" }).waitFor();

    await say("then send Anna the details", ["Control"]);
    const queued = page
      .getByRole("listitem", { name: "Queued message 1 of 1, not sent" })
      .filter({ hasText: "then send Anna the details" })
      .filter({ hasText: "Queued" });
    await queued.getByRole("button", { name: "Send now" }).waitFor();
    await queued.getByRole("button", { name: "Edit queued message" }).waitFor();
    await queued.getByRole("button", { name: "Remove queued message" }).waitFor();

    await say("steer and hold");
    await page.getByText("Fake reply: steer and hold", { exact: true }).waitFor();
    await queued.waitFor();

    await page.getByRole("button", { name: "Stop generation" }).click();
    await page.getByText("Stopped by user").first().waitFor();
    await queued.getByRole("button", { name: "Send now" }).click();
    await page.getByText("Fake reply: then send Anna the details", { exact: true }).waitFor();
    await queued.waitFor({ state: "hidden" });

    await page
      .locator('input[type="file"]')
      .setInputFiles(
        ["receipt.png", "clip.mp4", "notes.txt"].map((name) => NodePath.join(files, name)),
      );
    await page.getByRole("button", { name: "Remove receipt.png" }).waitFor();
    await say("can you expense this");
    for (const name of ["receipt.png", "clip.mp4", "notes.txt"]) {
      await page
        .getByText(new RegExp(`Attached \\w+ "${name.replace(".", "\\.")}"`))
        .first()
        .waitFor();
    }
    const stored = await NodeFSP.readdir(NodePath.join(home, "userdata/attachments"), {
      recursive: true,
    });
    expect(stored.filter((name) => /\.(png|mp4|txt)$/.test(name))).toHaveLength(3);
  } finally {
    await browser.close();
    for (const stop of stops) await stop();
    await NodeFSP.rm(directory, { recursive: true, force: true });
  }
});
