import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeEvents from "node:events";
import * as NodeNet from "node:net";
import * as NodeModule from "node:module";
import type * as Playwright from "playwright";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import { afterAll, beforeAll, expect, it } from "vite-plus/test";

const exec = NodeUtil.promisify(NodeChildProcess.execFile);
const root = NodePath.resolve(import.meta.dirname, "..");
const bin = NodePath.join(root, "apps/server/src/bin.ts");
const { chromium } = NodeModule.createRequire(NodePath.join(root, "apps/web/package.json"))(
  "playwright",
) as typeof Playwright;
let directory: string;
let home: string;
let server: NodeChildProcess.ChildProcess;
let port: number;
let env: NodeJS.ProcessEnv;

const cliAt = (clientHome: string, ...args: string[]) => {
  const running = exec(
    process.execPath,
    [
      bin,
      ...(args[0] === "pi"
        ? ["pi", "--home", clientHome, ...args.slice(1)]
        : [...args, "--home", clientHome]),
    ],
    {
      env,
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  running.child.stdin?.end();
  return running.catch((error) => {
    throw new Error(
      JSON.stringify({
        code: error.code,
        signal: error.signal,
        stdout: error.stdout,
        stderr: error.stderr,
      }),
    );
  });
};
const cli = (...args: string[]) => cliAt(home, ...args);
const json = async (...args: string[]) => JSON.parse((await cli(...args, "--json")).stdout);
const stop = async () => {
  const exited = NodeEvents.once(server, "exit");
  server.kill("SIGTERM");
  await exited;
};
const start = async () => {
  server = NodeChildProcess.spawn(
    process.execPath,
    [bin, "serve", "--home", home, "--port", String(port), "--host", "127.0.0.1", "--no-browser"],
    { cwd: directory, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  await new Promise<void>((resolve, reject) => {
    let output = "";
    server.stdout!.on("data", (chunk) => {
      output += chunk;
      if (output.includes("Ozi server is ready.")) resolve();
    });
    server.stderr!.on("data", (chunk) => {
      output += chunk;
    });
    server.once("error", reject);
    server.once("exit", (code) => reject(new Error(`Server exited ${code}: ${output}`)));
  });
};

beforeAll(async () => {
  directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "ozi-p4-"));
  home = NodePath.join(directory, "home");
  env = {
    ...process.env,
    HOME: directory,
    OZI_HOME: home,
    OZI_TELEMETRY_ENABLED: "false",
    NODE_COMPILE_CACHE: NodePath.join(directory, "compile-cache"),
    PI_CODING_AGENT_DIR: NodePath.join(directory, "pi-agent"),
    OZI_FAKE_LOG: NodePath.join(directory, "pi.log"),
  };
  const reserve = NodeNet.createServer().listen(0, "127.0.0.1");
  await NodeEvents.once(reserve, "listening");
  port = (reserve.address() as NodeNet.AddressInfo).port;
  await new Promise<void>((resolve) => reserve.close(() => resolve()));
  await NodeFSP.mkdir(NodePath.join(home, "userdata"), { recursive: true });
  await NodeFSP.writeFile(
    NodePath.join(home, "userdata/settings.json"),
    JSON.stringify({
      enableProviderUpdateChecks: false,
      providerInstances: {
        ozi: { driver: "pi", enabled: false, config: { harness: "ozi" } },
        codex: { driver: "codex", enabled: false },
        claudeAgent: { driver: "claudeAgent", enabled: false },
        pi: {
          driver: "pi",
          enabled: true,
          config: { harness: "ozi", binaryPath: NodePath.join(root, "e2e/fakes/pi.mjs") },
          environment: [{ name: "OZI_P4_MARKER", value: "selected-instance" }],
        },
      },
      defaultModelSelection: { instanceId: "pi", model: "default" },
    }),
  );
  await start();
});

afterAll(async () => {
  if (server?.exitCode === null) await stop();
  if (directory) await NodeFSP.rm(directory, { recursive: true, force: true });
});

let thread: string;
const main = async (command: string, payload = {}, clientHome = home) =>
  JSON.parse(
    (
      await cliAt(
        clientHome,
        "main",
        command,
        "--thread",
        thread,
        "--payload",
        JSON.stringify(payload),
        "--json",
      )
    ).stdout,
  );
const requests = async () =>
  (await NodeFSP.readFile(env.OZI_FAKE_LOG!, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line).request);

it("P4.rpc: allowlisted commands use the selected Pi without model turns", async () => {
  thread = (await json("session", "new", "--title", "P4 commands")).threadId;
  expect(await main("get_state")).toMatchObject({ messageCount: 0 });
  expect((await main("get_commands")).commands).toHaveLength(2);
  expect((await main("get_session_stats")).tokens.total).toBe(20);
  expect((await main("get_available_models")).models[0].id).toBe("test");
  expect((await main("get_available_thinking_levels")).levels).toContain("high");
  expect((await main("get_last_assistant_text")).text).toBeNull();
  await main("set_session_name", { name: "P4 native name" });
  expect((await main("get_state")).sessionName).toBe("P4 native name");
  expect(
    (await json("session", "list")).sessions.find(
      (session: { threadId: string }) => session.threadId === thread,
    ).title,
  ).toBe("P4 native name");
  expect(await main("bash", { command: "printf P4", excludeFromContext: true })).toMatchObject({
    output: "printf P4",
    exitCode: 0,
  });
  await main("abort_bash");
  expect(await main("compact", { customInstructions: "Keep P4" })).toMatchObject({
    summary: "Compacted",
  });
  const output = NodePath.join(directory, "p4.html");
  expect(await main("export_html", { outputPath: output })).toEqual({ path: output });
  expect(await NodeFSP.readFile(output, "utf8")).toContain("<!doctype html>");
  expect((await requests()).filter((request) => request.type === "prompt")).toHaveLength(0);
});

it("P4.slash: built-ins execute RPC while extensions and templates pass through", async () => {
  for (const text of [
    "/session",
    "/model",
    "/thinking",
    "/name P4 slash",
    "/copy",
    "/export",
    "/compact Keep P4",
    "/settings",
  ]) {
    const result = await json("print", text, "--thread", thread);
    expect(result.status).toBe("completed");
  }
  const before = await requests();
  expect(before.filter((request) => request.type === "prompt")).toHaveLength(0);
  expect(
    before.some(
      (request) => request.type === "compact" && request.customInstructions === "Keep P4",
    ),
  ).toBe(true);
  for (const text of ["/extension", "/template", "/session-like"]) {
    expect((await json("print", text, "--thread", thread)).status).toBe("completed");
  }
  expect(
    (await requests())
      .filter((request) => request.type === "prompt")
      .map((request) => request.message),
  ).toEqual(["/extension", "/template", "/session-like"]);
  await json("session", "reload", thread);
  await stop();
  await start();
  expect((await main("get_state")).messageCount).toBe(6);
});

it("P4.cli: native arguments, instance environment, stderr and exit status survive", async () => {
  const result = JSON.parse(
    (
      await cli(
        "pi",
        "--json",
        "--thread",
        thread,
        "--p4-probe",
        "--",
        "--json",
        "argument with spaces",
      )
    ).stdout,
  );
  expect(result.stderr).toContain("Pi CLI stderr");
  expect(JSON.parse(result.stdout)).toMatchObject({
    args: expect.arrayContaining([
      "--extension",
      "--ozi-data-root",
      NodePath.join(home, "harness"),
      "--p4-probe",
      "--json",
      "argument with spaces",
    ]),
    agentDir: NodePath.join(home, "agents/ozi"),
    marker: "selected-instance",
    cwd: await NodeFSP.realpath(directory),
  });
  const raw = await cli("pi", "--thread", thread, "--p4-probe");
  expect(JSON.parse(raw.stdout).marker).toBe("selected-instance");
  await expect(cli("pi", "--p4-probe", "--p4-fail", "--json")).rejects.toThrow('"code":7');
  await expect(main("prompt", { message: "must not run" })).rejects.toThrow();
  await expect(main("bash", { type: "prompt", command: "must not run" })).rejects.toThrow();
  await expect(main("set_session_name", {})).rejects.toThrow();
  const other = (await json("session", "new", "--title", "P4 other")).threadId;
  expect((await main("get_state")).sessionFile).not.toBe(
    (await json("main", "get_state", "--thread", other)).sessionFile,
  );
});

it("P4.remote: full-access pairing runs RPC and Pi CLI on the server", async () => {
  const client = NodePath.join(directory, "remote-client");
  await cliAt(client, "connect", (await json("pair")).pairingUrl, "--json");
  expect(await main("get_state", {}, client)).toHaveProperty("sessionFile");
  const result = JSON.parse(
    (await cliAt(client, "pi", "--thread", thread, "--p4-probe", "--json")).stdout,
  );
  expect(JSON.parse(result.stdout)).toMatchObject({
    agentDir: NodePath.join(home, "agents/ozi"),
    marker: "selected-instance",
  });
  await expect(NodeFSP.access(NodePath.join(client, "userdata/statev2.sqlite"))).rejects.toThrow();
  const restricted = NodePath.join(directory, "restricted-client");
  await cliAt(
    restricted,
    "connect",
    (await json("pair")).pairingUrl,
    "--access",
    "read-only",
    "--json",
  );
  await expect(main("get_state", {}, restricted)).rejects.toThrow("ozi connect");
  await expect(cliAt(restricted, "pi", "--p4-probe", "--json")).rejects.toThrow("ozi connect");
  const response = await fetch(`http://127.0.0.1:${port}/mcp/sessions?orchestrationProtocol=2`);
  expect(response.status).toBe(401);
});

it("P4.web: submitting built-ins in the composer shows RPC output without a Pi prompt", async () => {
  const reserve = NodeNet.createServer().listen(0, "127.0.0.1");
  await NodeEvents.once(reserve, "listening");
  const webPort = (reserve.address() as NodeNet.AddressInfo).port;
  await new Promise<void>((resolve) => reserve.close(() => resolve()));
  const vite = NodeChildProcess.spawn(
    NodePath.join(root, "node_modules/.bin/vp"),
    ["dev", "--host", "127.0.0.1", "--port", String(webPort)],
    {
      cwd: NodePath.join(root, "apps/web"),
      env: { ...env, OZI_PORT: String(port), OZI_SINGLE_ORIGIN_DEV: "1" },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let browser: Playwright.Browser | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      let output = "";
      const read = (chunk: Buffer) => {
        output += chunk;
        if (output.includes("Local:")) resolve();
      };
      vite.stdout!.on("data", read);
      vite.stderr!.on("data", read);
      vite.once("exit", (code) => reject(new Error(`Vite exited ${code}: ${output}`)));
      vite.once("error", reject);
    });
    const pairing = new URL((await json("pair")).pairingUrl);
    pairing.host = `127.0.0.1:${webPort}`;
    const client = NodePath.join(directory, "web-client");
    await cliAt(client, "connect", pairing.toString(), "--json");
    expect(await main("get_state", {}, client)).toHaveProperty("sessionFile");
    const remote = JSON.parse(
      (await cliAt(client, "pi", "--thread", thread, "--p4-probe", "--json")).stdout,
    );
    expect(JSON.parse(remote.stdout)).toHaveProperty("marker", "selected-instance");
    browser = await chromium.launch({ executablePath: process.env.OZI_E2E_CHROMIUM });
    const page = await browser.newPage();
    const browserPairing = new URL((await json("pair")).pairingUrl);
    await page.goto(`http://127.0.0.1:${webPort}/pair${browserPairing.hash}`);
    const composer = page.getByRole("textbox", { name: /^Message / });
    const before = (await requests()).filter(
      (request) => request.type === "prompt" && request.message.startsWith("/"),
    ).length;
    await composer.waitFor();
    await composer.fill("/session");
    await page.getByRole("button", { name: "Submit message", exact: true }).click();
    await page
      .getByRole("region", { name: "Conversation", exact: true })
      .getByText(/"tokens"/)
      .waitFor();
    expect(
      (await requests()).filter(
        (request) => request.type === "prompt" && request.message.startsWith("/"),
      ),
    ).toHaveLength(before);
    await composer.fill("/name P4 browser");
    await page.getByRole("button", { name: "Submit message", exact: true }).click();
    await page.getByRole("heading", { name: "P4 browser", exact: true }).waitFor();
    await composer.fill("/thinking off");
    await page.getByRole("button", { name: "Submit message", exact: true }).click();
    await page.getByRole("button", { name: /^Effort: Off/ }).waitFor();
    const webThread = new URL(page.url()).pathname.split("/").at(-1)!;
    expect((await json("main", "get_state", "--thread", webThread)).messageCount).toBe(0);
    expect(
      (await requests()).filter(
        (request) => request.type === "prompt" && request.message.startsWith("/"),
      ),
    ).toHaveLength(before);
  } finally {
    await browser?.close();
    if (vite.pid && vite.exitCode === null) {
      const exited = NodeEvents.once(vite, "exit");
      process.kill(-vite.pid, "SIGTERM");
      await exited;
    }
  }
});

it("P4.offline: native Pi CLI uses isolated local configuration without a server", async () => {
  await stop();
  const result = await json("pi", "--p4-probe");
  expect(JSON.parse(result.stdout)).toMatchObject({
    agentDir: NodePath.join(home, "agents/ozi"),
    marker: "selected-instance",
  });
});
