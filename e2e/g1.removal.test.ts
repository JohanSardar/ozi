import { createProjectFreeUpgrade } from "./fixtures/projectFreeUpgrade.ts";
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeEvents from "node:events";
import * as NodeNet from "node:net";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import { expect, it } from "vite-plus/test";
import { startAnthropic } from "./fakes/anthropic.ts";

const exec = NodeUtil.promisify(NodeChildProcess.execFile);
const root = NodePath.resolve(import.meta.dirname, "..");
const webRequire = NodeModule.createRequire(NodePath.join(root, "apps/web/package.json"));
const { chromium } = webRequire("playwright") as typeof import("playwright");
const viteBin = NodePath.join(
  NodePath.dirname(
    NodeModule.createRequire(webRequire.resolve("vite-plus")).resolve("vite/package.json"),
  ),
  "dist/vite/bin/vite.js",
);

async function freePort() {
  const socket = NodeNet.createServer().listen(0, "127.0.0.1");
  await NodeEvents.once(socket, "listening");
  const { port } = socket.address() as NodeNet.AddressInfo;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  return port;
}

it.each(["tools", "chat", "upgrade"] as const)("g1.project-free: %s", async (scenario) => {
  const home = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "ozi-g1-server-"));
  const stateHome = NodePath.join(home, ".ozi");
  const transport = await startAnthropic(() => ({ text: "g1-chat-ok" }));
  const legacyHome = NodePath.join(home, ".t3");
  await NodeFSP.mkdir(legacyHome);
  await NodeFSP.writeFile(NodePath.join(legacyHome, "sentinel"), "untouched");
  const reserve = NodeNet.createServer();
  reserve.listen(0, "127.0.0.1");
  await NodeEvents.once(reserve, "listening");
  const address = reserve.address();
  if (address === null || typeof address === "string") throw new Error("No TCP address");
  const port = address.port;
  const webPort = await freePort();
  await new Promise<void>((resolve) => reserve.close(() => resolve()));
  const legacyWorkingDirectory = NodePath.join(home, "legacy-folder");
  if (scenario === "upgrade") {
    const directory = NodePath.join(stateHome, "userdata");
    await NodeFSP.mkdir(directory, { recursive: true });
    await NodeFSP.mkdir(legacyWorkingDirectory);
    await createProjectFreeUpgrade(stateHome, legacyWorkingDirectory);
  }
  const server = NodeChildProcess.spawn(
    process.execPath,
    [
      NodePath.join(root, "apps/server/src/bin.ts"),
      "serve",
      "--port",
      String(port),
      "--host",
      "127.0.0.1",
      "--no-browser",
      "--home",
      stateHome,
      "--dev-url",
      `http://localhost:${webPort}`,
    ],
    {
      cwd: home,
      env: {
        ...process.env,
        HOME: home,
        OZI_HOME: "",
        OZI_TELEMETRY_ENABLED: "false",
        CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-ozi-test-only",
        ANTHROPIC_BASE_URL: transport.url,
        CLAUDE_CONFIG_DIR: NodePath.join(home, "claude"),
        PI_CODING_AGENT_DIR: NodePath.join(home, "ambient-pi"),
        T3CODE_HOME: legacyHome,
        T3CODE_PORT: "invalid",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let web: NodeChildProcess.ChildProcess | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      let output = "";
      server.stdout.on("data", (chunk) => {
        output += String(chunk);
        if (output.includes("Ozi server is ready.")) resolve();
      });
      server.stderr.on("data", (chunk) => {
        output += String(chunk);
      });
      AbortSignal.timeout(10_000).addEventListener("abort", () => reject(new Error(output)));
      server.once("error", reject);
      server.once("exit", (code) => reject(new Error(`Server exited: ${code}\n${output}`)));
    });
    const cli = NodePath.join(root, "apps/server/src/bin.ts");
    const run = async (...args: string[]) =>
      JSON.parse(
        (
          await exec(process.execPath, [cli, ...args, "--home", stateHome, "--json"], {
            cwd: home,
            timeout: 30_000,
          })
        ).stdout,
      );
    if (scenario === "upgrade") {
      const chat = await run("thread", "show", "legacy-g1");
      expect(chat.thread.workingDirectory).toBe(legacyWorkingDirectory);
      expect(chat.thread).not.toHaveProperty("projectId");
      expect(await run("thread", "list")).toContainEqual(
        expect.objectContaining({ threadId: "legacy-g1" }),
      );
    } else if (scenario === "tools") {
      const { stdout } = await exec(process.execPath, [
        NodePath.join(root, "apps/server/src/bin.ts"),
        "auth",
        "session",
        "issue",
        "--home",
        stateHome,
        "--subject",
        "mcp-client",
        "--json",
      ]);
      const issued = JSON.parse(stdout);
      const bridge = NodeChildProcess.spawn(
        process.execPath,
        [NodePath.join(root, "apps/server/src/bin.ts"), "acp-mcp-bridge"],
        {
          env: {
            ...process.env,
            OZI_ACP_MCP_ENDPOINT: `http://127.0.0.1:${port}/mcp`,
            OZI_ACP_MCP_AUTHORIZATION: `Bearer ${issued.token}`,
          },
          timeout: 10_000,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      let output = "";
      let errors = "";
      bridge.stdout.on("data", (chunk) => {
        output += String(chunk);
      });
      bridge.stderr.on("data", (chunk) => {
        errors += String(chunk);
      });
      const exited = NodeEvents.once(bridge, "exit");
      bridge.stdin.end(
        [
          {
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: "2025-03-26",
              capabilities: {},
              clientInfo: { name: "g1", version: "1" },
            },
          },
          { jsonrpc: "2.0", method: "notifications/initialized" },
          { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
        ]
          .map((request) => JSON.stringify(request))
          .join("\n") + "\n",
      );
      expect((await exited)[0], errors).toBe(0);
      const response = output
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
        .find((reply) => reply.id === 2);
      expect(response?.error, output).toBeUndefined();
      const names = response.result.tools.map((tool: { name: string }) => tool.name);
      expect(names).toContain("orchestrator_capabilities");
      expect(names).toContain("t3_thread_read");
      expect(
        names.some((name: string) => /device_|worktree|pull_request|project_/.test(name)),
      ).toBe(false);
      const workspace = NodePath.join(home, "workspace");
      await NodeFSP.mkdir(workspace);
      const completed = await run("thread", "start", "Reply g1-chat-ok without tools.", "--wait");
      expect(JSON.stringify(completed)).toContain("g1-chat-ok");
      const chat = await run("thread", "show", completed.threadId);
      expect(chat.thread).not.toHaveProperty("projectId");
      expect(chat.thread).not.toHaveProperty("branch");
      expect(chat.thread).not.toHaveProperty("worktreePath");
      await expect(NodeFSP.stat(NodePath.join(workspace, ".git"))).rejects.toThrow();
    } else {
      web = NodeChildProcess.spawn(process.execPath, [viteBin, "dev", "--strictPort"], {
        cwd: NodePath.join(root, "apps/web"),
        env: {
          ...process.env,
          OZI_PORT: String(port),
          OZI_SINGLE_ORIGIN_DEV: "1",
          PORT: String(webPort),
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      await new Promise<void>((resolve, reject) => {
        let output = "";
        const receive = (chunk: Buffer) => {
          output += String(chunk);
          if (output.includes("ready in")) resolve();
        };
        web!.stdout!.on("data", receive);
        web!.stderr!.on("data", receive);
        web!.once("error", reject);
        web!.once("exit", (code) => reject(new Error(`Web exited ${code}: ${output}`)));
      });
      browser = await chromium.launch();
      const page = await browser.newPage();
      page.setDefaultTimeout(10_000);
      await page.addInitScript(() =>
        localStorage.setItem(
          "ozi:client-settings:v1",
          JSON.stringify({ onboardingCompletedAt: "2026-01-01T00:00:00.000Z" }),
        ),
      );
      const paired = await run("pair");
      const token = new URL(paired.pairingUrl).hash;
      await page.goto(`http://localhost:${webPort}/pair${token}`);
      try {
        const composer = page.getByRole("textbox", { name: /^Message/ });
        const prompt = "Reply g1-chat-ok without tools.";
        await composer.pressSequentially(prompt);
        expect(await composer.innerText()).toBe(prompt);
        await page.waitForFunction(
          (text) => localStorage.getItem("ozi:composer-drafts:v1")?.includes(text),
          prompt,
        );
        await page.reload();
        await composer.waitFor();
        expect(await composer.innerText()).toBe(prompt);
        await composer.press("Enter");
        await page.waitForURL((url) => !url.pathname.startsWith("/draft/"));
        const uiThreadId = new URL(page.url()).pathname.split("/").at(-1)!;
        const reply = await run("thread", "wait", uiThreadId);
        expect(reply.reply).toContain("g1-chat-ok");
        await page.getByText("g1-chat-ok", { exact: true }).waitFor();
        await page.screenshot({ path: "/tmp/g1-project-free-e2e.png", fullPage: true });
        expect(await page.getByText("Something went wrong.", { exact: true }).count()).toBe(0);
        expect(
          await page
            .getByRole("button", { name: /pull request|worktree|git controls|open diff/i })
            .count(),
        ).toBe(0);
      } catch (cause) {
        throw new Error(await page.locator("body").innerText(), { cause });
      }
    }
    expect(await NodeFSP.readdir(legacyHome)).toEqual(["sentinel"]);
    expect(await NodeFSP.readFile(NodePath.join(legacyHome, "sentinel"), "utf8")).toBe("untouched");
  } finally {
    await browser?.close();
    if (web && web.exitCode === null && web.signalCode === null) {
      const exited = NodeEvents.once(web, "exit");
      web.kill("SIGTERM");
      await exited;
    }
    if (server.exitCode === null && server.signalCode === null) {
      const exited = NodeEvents.once(server, "exit");
      server.kill("SIGTERM");
      await exited;
    }
    await transport.close();
    await NodeFSP.rm(home, { recursive: true, force: true });
  }
});
