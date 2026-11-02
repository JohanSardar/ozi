import * as NodeChildProcess from "node:child_process";
import * as NodeEvents from "node:events";
import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import { expect, it } from "vite-plus/test";
import { startAnthropic } from "./fakes/anthropic.ts";

const exec = NodeUtil.promisify(NodeChildProcess.execFile);
const root = NodePath.resolve(import.meta.dirname, "..");
const cli = NodePath.join(root, "apps/server/src/bin.ts");

it.each([
  { selection: "explicit", name: "w1.explicit-ozi-model: a delegated Pi worker writes a file" },
  { selection: "inherited", name: "w1.inherited-ozi-model: a delegated Pi worker writes a file" },
  {
    selection: "cli",
    name: "C6.pi-cli-harness: local and remote Pi load the selected Ozi harness",
  },
])(
  "$name",
  async ({
    selection,
  }: {
    selection: "explicit" | "inherited" | "cli";
    name: string;
  }) => {
    const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "ozi-w1-"));
    const home = NodePath.join(directory, "home");
    const workspace = NodePath.join(directory, "workspace");
    await NodeFSP.mkdir(workspace);
    await exec("git", ["init", workspace]);
    await NodeFSP.mkdir(NodePath.join(home, "userdata"), { recursive: true });
    await NodeFSP.writeFile(
      NodePath.join(home, "userdata/settings.json"),
      JSON.stringify({
        enableProviderUpdateChecks: false,
        providerInstances: {
          codex: { driver: "codex", enabled: false },
          claudeAgent: { driver: "claudeAgent", enabled: false },
        },
      }),
    );
    const model = "claude-bridge/claude-opus-5-5";
    let step = 0;
    let results = "";
    const fake = await startAnthropic((request) => {
      const messages = JSON.stringify(request.messages);
      if (JSON.stringify(request.system).includes("OZI COMPLETION CHECK")) {
        return {
          text: JSON.stringify({
            verdict: { verdict: "done", useful: false },
            verified: ["The requested test reply is present."],
          }),
        };
      }
      const tool = (suffix: string) => {
        const found = request.tools.find((entry) => entry.name.split(/__|\./).at(-1) === suffix);
        if (!found) throw new Error(`Missing ${suffix}`);
        return found.name;
      };
      if (!messages.includes("Check capabilities and delegate the W1 file task.")) {
        return messages.includes('"tool_result"')
          ? { text: "w1-worker-done" }
          : {
              tool: tool("write"),
              arguments: { path: "w1-worker.txt", content: "w1-worker-ok" },
            };
      }
      if (step++ === 0) return { tool: tool("orchestrator_capabilities"), arguments: {} };
      if (step === 2) {
        expect(messages).toContain(model);
        return {
          tool: tool("delegate_task"),
          arguments: {
            title: `W1 ${selection} model worker`,
            task: "w1-worker: write w1-worker.txt containing w1-worker-ok.",
            target: { providerInstanceId: "ozi", ...(selection === "explicit" ? { model } : {}) },
            mode: "wait",
          },
        };
      }
      results = messages;
      return { text: "w1-main-done" };
    });
    const reserve = NodeNet.createServer();
    reserve.listen(0, "127.0.0.1");
    await NodeEvents.once(reserve, "listening");
    const address = reserve.address();
    if (address === null || typeof address === "string") throw new Error("No TCP address");
    await new Promise<void>((resolve) => reserve.close(() => resolve()));
    const environment = {
      ...process.env,
      HOME: directory,
      OZI_HOME: "",
      OZI_TELEMETRY_ENABLED: "false",
      PI_CODING_AGENT_DIR: NodePath.join(directory, "ambient-pi"),
      CLAUDE_CONFIG_DIR: NodePath.join(directory, "claude"),
      CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-ozi-test-only",
      ANTHROPIC_API_KEY: "must-not-be-used",
      ANTHROPIC_BASE_URL: fake.url,
    };
    const server = NodeChildProcess.spawn(
      process.execPath,
      [
        cli,
        "serve",
        "--home",
        home,
        "--port",
        String(address.port),
        "--host",
        "127.0.0.1",
        "--no-browser",
      ],
      {
        cwd: workspace,
        env: environment,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    server.stderr.on("data", (chunk) => {
      output += chunk;
    });
    const run = async (...args: string[]) =>
      JSON.parse(
        (
          await exec(process.execPath, [cli, ...args, "--home", home, "--json"], {
            cwd: workspace,
            env: environment,
            timeout: 45_000,
            maxBuffer: 1024 * 1024,
          })
        ).stdout,
      );
    try {
      await new Promise<void>((resolve, reject) => {
        server.stdout.on("data", (chunk) => {
          output += chunk;
          if (output.includes("Ozi server is ready.")) resolve();
        });
        server.once("error", reject);
        server.once("exit", (code) => reject(new Error(`Server exited ${code}: ${output}`)));
      });
      if (selection === "cli") {
        const session = await run(
          "session",
          "new",
          "--provider",
          "ozi",
          "--model",
          model,
          "--title",
          "C6 native Pi",
        );
        const pi = async (clientHome: string, args: string[]) => {
          const running = exec(
            process.execPath,
            [
              cli,
              "pi",
              "--home",
              clientHome,
              "--thread",
              session.threadId,
              "--json",
              "--",
              ...args,
            ],
            { cwd: workspace, env: environment, timeout: 30_000 },
          );
          running.child.stdin?.end();
          return JSON.parse((await running).stdout);
        };
        const args = [
          "--print",
          "--provider",
          "claude-bridge",
          "--model",
          "claude-opus-5-5",
          "C6 native harness: write w1-worker.txt and report.",
        ];
        expect((await pi(home, args)).stdout).toContain("w1-worker-done");
        const clientHome = NodePath.join(directory, "client");
        await exec(
          process.execPath,
          [cli, "connect", (await run("pair")).pairingUrl, "--home", clientHome, "--json"],
          { env: environment },
        );
        expect((await pi(clientHome, args)).stdout).toContain("w1-worker-done");
        expect((await pi(clientHome, ["mcp", "list"])).exitCode).toBe(0);
        expect(await NodeFSP.readFile(NodePath.join(workspace, "w1-worker.txt"), "utf8")).toBe(
          "w1-worker-ok",
        );
        expect(
          fake.requests.some((request) => JSON.stringify(request.system).includes("You are Ozi")),
        ).toBe(true);
        return;
      }
      const result = await run(
        "thread",
        "start",
        "--provider",
        "ozi",
        "--model",
        "default",
        "--cwd",
        workspace,
        "Check capabilities and delegate the W1 file task.",
        "--wait",
      );
      expect(result.status).toBe("completed");
      expect(results, output).toContain("w1-worker-done");
      expect(await NodeFSP.readFile(NodePath.join(workspace, "w1-worker.txt"), "utf8")).toBe(
        "w1-worker-ok",
      );
      for (const request of fake.requests) expect(request.model).toBe("claude-opus-5-5");
    } finally {
      if (server.exitCode === null && server.signalCode === null) {
        const exited = NodeEvents.once(server, "exit");
        server.kill("SIGTERM");
        await exited;
      }
      await fake.close();
      await NodeFSP.rm(directory, { recursive: true, force: true });
    }
  },
);
