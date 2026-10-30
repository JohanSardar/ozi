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

it("l2.topbar-reply: the top bar times a working chat and Reply sends assistant quotes", async () => {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "ozi-l2-"));
  const home = NodePath.join(directory, ".ozi");
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
  const ozi = async (...args: Array<string>) =>
    (await exec(process.execPath, [bin, ...args, "--home", home, "--json"], { env })).stdout;
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
    const page = await browser.newPage();
    await page.addInitScript(() =>
      localStorage.setItem(
        "ozi:client-settings:v1",
        JSON.stringify({ onboardingCompletedAt: "2026-01-01T00:00:00.000Z" }),
      ),
    );
    await page.goto(JSON.parse(await ozi("pair")).pairingUrl);
    const composer = page.getByRole("textbox", { name: /^Message/ });
    await composer.click();
    await composer.pressSequentially("Plan Friday");
    await composer.press("Enter");

    const answer = page.locator("[data-assistant-citation-source]").first();
    await answer.getByText("Fake reply: Plan Friday", { exact: true }).waitFor();
    await answer.hover();
    await page.getByRole("button", { name: "Reply", exact: true }).click();
    const quote = page.getByText("Replying to “Fake reply: Plan Friday”", { exact: true });
    await quote.waitFor();
    await page.getByRole("button", { name: "Remove reply" }).click();
    await quote.waitFor({ state: "detached" });

    await answer.click({ clickCount: 3 });
    await page.getByRole("button", { name: "Reply to selection" }).click();
    await quote.waitFor();
    await composer.pressSequentially("hold the table for four");
    await composer.press("Enter");

    const header = page.locator("header").first();
    await header.getByText(/^Working 0:0\d$/).waitFor();
    expect(await header.locator('[role="status"]').count()).toBe(1);
    await page.getByText("“Fake reply: Plan Friday”", { exact: true }).waitFor();
    expect(await quote.count()).toBe(0);
    await page.getByText("Fake reply: [assistant-quote-1] hold the table for four").waitFor();
    const threadId = decodeURIComponent(new URL(page.url()).pathname.split("/").at(-1)!);
    const shown = JSON.parse(await ozi("thread", "show", threadId, "--messages", "1"));
    expect(shown.messages[0].text).toContain('"text": "Fake reply: Plan Friday"');

    await page.getByRole("button", { name: "Stop generation" }).click();
    await header.getByText(/^Working/).waitFor({ state: "detached" });
  } finally {
    await browser.close();
    for (const stop of stops) await stop();
    await NodeFSP.rm(directory, { recursive: true, force: true });
  }
});
