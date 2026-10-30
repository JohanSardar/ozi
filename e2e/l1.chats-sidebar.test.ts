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

it("l1.chats-sidebar: chats sit once in Needs you, Working, Pinned or Recent", async () => {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "ozi-l1-"));
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
    JSON.parse(
      (await exec(process.execPath, [bin, ...args, "--home", home, "--json"], { env })).stdout,
    );
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
    const [heating, tax, passport, dinner, { pairingUrl }] = await Promise.all([
      ozi("thread", "start", "Apartment heating", "--wait"),
      ozi("thread", "start", "Tax documents", "--wait"),
      ozi("thread", "start", "Passport renewal", "--wait"),
      ozi("thread", "start", "Friday dinner, hold the table"),
      ozi("pair"),
    ]);
    expect([heating, tax, passport, dinner].every((chat) => chat.threadId)).toBe(true);
    const ticket = await ozi(
      "ticket",
      "create",
      "--input",
      JSON.stringify({
        threadId: passport.threadId,
        group: "Decide",
        title: "Pay the passport fee?",
        need: "Approve the 1 600 kr fee.",
        summary: "The slot is held until 18:00.",
        choices: [],
        markdown: "",
        attachments: [],
        htmlPages: [],
      }),
    );

    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.addInitScript(() =>
      localStorage.setItem(
        "ozi:client-settings:v1",
        JSON.stringify({ onboardingCompletedAt: "2026-01-01T00:00:00.000Z" }),
      ),
    );
    await page.goto(pairingUrl);
    const sidebar = page.getByRole("navigation", { name: "Threads" });
    const sections = () =>
      sidebar.locator("li:has(> h2)").evaluateAll((items) =>
        items.map((item) => [
          item.querySelector("h2")!.textContent,
          [...item.querySelectorAll<HTMLElement>("[data-sidebar-row]")].map((row) =>
            row.innerText
              .replace(row.querySelector(".sr-only")?.textContent ?? "", "")
              .replace(/\s+/g, " ")
              .trim(),
          ),
        ]),
      );
    const row = (title: string) => sidebar.locator("[data-sidebar-row]", { hasText: title });

    await row("Friday dinner").getByRole("status", { name: "Working" }).waitFor();
    for (const title of ["Passport renewal", "Tax documents"]) {
      await row(title).click({ button: "right" });
      await page.getByRole("menuitem", { name: "Pin thread" }).click();
    }
    await expect.poll(sections).toEqual([
      ["Needs you", [expect.stringMatching(/^Passport renewal \S+$/)]],
      ["Working", ["Friday dinner, hold the table"]],
      ["Pinned", [expect.stringMatching(/^Tax documents \S+$/)]],
      ["Recent", [expect.stringMatching(/^Apartment heating \S+$/)]],
    ]);

    await ozi(
      "ticket",
      "close",
      "--input",
      JSON.stringify({ id: ticket.id, by: { type: "acknowledged" } }),
    );
    await expect
      .poll(async () => (await sections()).map(([label]) => label))
      .toEqual(["Working", "Pinned", "Recent"]);
    expect((await sections())[1]![1]).toHaveLength(2);

    await sidebar.getByRole("textbox", { name: "Search chats" }).fill("heat");
    await expect
      .poll(sections)
      .toEqual([["Recent", [expect.stringMatching(/^Apartment heating/)]]]);

    await sidebar.getByRole("button", { name: /^New chat/ }).click();
    await page.waitForURL(/\/draft\//);
    await sidebar.getByText("You", { exact: true }).waitFor();
    await sidebar.getByRole("button", { name: "Settings" }).click();
    await page.waitForURL(/\/settings/);
  } finally {
    await browser.close();
    for (const stop of stops) await stop();
    await NodeFSP.rm(directory, { recursive: true, force: true });
  }
});
