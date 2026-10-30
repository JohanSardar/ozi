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
  { provider: "ozi", model: "claude-bridge/claude-opus-5-5", fileTicket: false },
  { provider: "pi", model: "claude-bridge/claude-opus-5-5", fileTicket: false },
  { provider: "claudeAgent", model: "claude-sonnet-5-5", fileTicket: false },
  { provider: "codex", model: "gpt-5.6-sol", fileTicket: false },
  { provider: "ozi", model: "claude-bridge/claude-opus-5-5", fileTicket: true },
])(
  "sub1.workers-plain $provider explicit ticket=$fileTicket",
  async ({ provider, model, fileTicket }) => {
    const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "ozi-sub1-"));
    const home = NodePath.join(directory, "home");
    const workspace = NodePath.join(directory, "workspace");
    await NodeFSP.mkdir(workspace);
    await exec("git", ["init", workspace]);
    const binary = NodePath.join(directory, "codex");
    await NodeFSP.writeFile(
      binary,
      `#!/bin/sh\nexec '${process.execPath}' '${NodePath.join(root, "e2e/fakes/codex.ts")}' "$@"\n`,
      { mode: 0o755 },
    );
    await NodeFSP.mkdir(NodePath.join(home, "userdata"), { recursive: true });
    await NodeFSP.writeFile(
      NodePath.join(home, "userdata/settings.json"),
      JSON.stringify({
        enableProviderUpdateChecks: false,
        defaultRuntimeMode: "full-access",
        providerInstances: {
          pi: {
            driver: "pi",
            enabled: true,
            config: {
              binaryPath: NodePath.join(
                root,
                "apps/server/node_modules/@earendil-works/pi-coding-agent/dist/cli.js",
              ),
              launchArgs: `--extension ${JSON.stringify(NodePath.join(root, "apps/server/node_modules/@ozi/pi/src/bridge.mjs"))}`,
              customModels: ["claude-bridge/claude-opus-5-5"],
            },
          },
          codex: {
            driver: "codex",
            enabled: true,
            config: { binaryPath: binary, homePath: NodePath.join(directory, "codex-home") },
          },
        },
      }),
    );
    let step = 0;
    let childThreadId = "";
    let mainChecks = 0;
    let workerChecks = 0;
    const checks = new NodeEvents.EventEmitter();
    const fake = await startAnthropic((request) => {
      const system = JSON.stringify(request.system);
      const messages = JSON.stringify(request.messages);
      if (system.includes("OZI COMPLETION CHECK"))
        return {
          text: JSON.stringify({ verdict: { verdict: "done", useful: false }, verified: [] }),
        };
      const tool = (name: string, args: Record<string, unknown>) => {
        const found = request.tools.find((entry) => entry.name.split(/__|\./).at(-1) === name);
        if (!found) throw new Error(`Missing ${name}`);
        return { tool: found.name, arguments: args };
      };
      const main = messages.includes("sub1-main: delegate the assigned task.");
      if (
        messages.includes("Check the completed turn's inbox only") ||
        messages.includes("Inbox check.")
      ) {
        if (main) {
          mainChecks++;
          checks.emit("main");
        } else workerChecks++;
        return { text: "Inbox complete. Nothing to file." };
      }
      for (const entry of request.tools.filter((entry) =>
        /(?:^|__)ticket_(?:create|update|close|list)$/.test(entry.name),
      ))
        expect(entry.description).toContain(
          "Delegated workers use this only when their task tells them to",
        );
      if (!main) {
        if (!messages.includes("Return sub1-worker-result")) return { text: "Worker result" };
        if (fileTicket && !messages.includes('"tool_result"'))
          return tool("ticket_create", {
            group: "Read",
            title: "sub1-explicit-ticket",
            need: "Read the requested result.",
            summary: "The worker was explicitly asked to file this ticket.",
            markdown: "sub1-worker-result",
            choices: [],
            attachments: [],
            htmlPages: [],
          });
        return { text: "sub1-worker-result" };
      }
      if (step++ === 0) {
        expect(system).toContain("When a worker should file a ticket itself");
        return tool("orchestrator_capabilities", {});
      }
      if (step === 2)
        return tool("delegate_task", {
          title: "sub1 worker",
          task: fileTicket
            ? "Return sub1-worker-result and explicitly file a Read ticket titled sub1-explicit-ticket."
            : "Return sub1-worker-result.",
          target: { providerInstanceId: provider, model },
          mode: "wait",
        });
      const visit = (value: unknown): void => {
        if (typeof value === "string") {
          try {
            visit(JSON.parse(value));
          } catch {}
        } else if (value && typeof value === "object") {
          if ("childThreadId" in value) childThreadId = String(value.childThreadId);
          else for (const item of Object.values(value)) visit(item);
        }
      };
      visit(request.messages);
      return { text: "sub1-main-result" };
    });
    const reserve = NodeNet.createServer();
    reserve.listen(0, "127.0.0.1");
    await NodeEvents.once(reserve, "listening");
    const address = reserve.address();
    if (address === null || typeof address === "string") throw new Error("No TCP address");
    await new Promise<void>((resolve) => reserve.close(() => resolve()));
    const env = {
      ...process.env,
      HOME: directory,
      OZI_HOME: "",
      OZI_TELEMETRY_ENABLED: "false",
      OZI_CODEX_FAKE: directory,
      PI_CODING_AGENT_DIR: NodePath.join(directory, "ambient-pi"),
      CLAUDE_CONFIG_DIR: NodePath.join(directory, "claude"),
      CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-ozi-test-only",
      ANTHROPIC_API_KEY: "ozi-test-only",
      ANTHROPIC_BASE_URL: fake.url,
      ENABLE_TOOL_SEARCH: "false",
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
      { cwd: workspace, env, stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    const run = async (...args: string[]) =>
      JSON.parse(
        (
          await exec(process.execPath, [cli, ...args, "--home", home, "--json"], {
            cwd: workspace,
            env,
            timeout: 45_000,
            maxBuffer: 2 * 1024 * 1024,
          })
        ).stdout,
      );
    try {
      await new Promise<void>((resolve, reject) => {
        const read = (chunk: Buffer) => {
          output += String(chunk);
          if (output.includes("Ozi server is ready.")) resolve();
        };
        server.stdout.on("data", read);
        server.stderr.on("data", read);
        server.once("error", reject);
        server.once("exit", (code) => reject(new Error(`Server exited ${code}: ${output}`)));
      });
      const checked = NodeEvents.once(checks, "main", { signal: AbortSignal.timeout(45_000) });
      void checked.catch(() => {});
      const result = await run(
        "thread",
        "start",
        "--cwd",
        workspace,
        "sub1-main: delegate the assigned task.",
        "--wait",
      );
      expect(result.status, output).toBe("completed");
      await checked;
      expect(childThreadId, JSON.stringify(fake.requests.at(-1)?.messages)).not.toBe("");
      const worker = await run("thread", "show", childThreadId, "--activity");
      expect(
        worker.messages.filter((message: { role: string }) => message.role === "assistant").at(-1)
          ?.text,
        JSON.stringify(worker),
      ).toContain(provider === "codex" ? "Reply:" : "sub1-worker-result");
      expect(
        worker.activity.filter((item: { title?: string }) => item.title?.startsWith("Inbox check")),
      ).toEqual([]);
      const workerRequests = fake.requests.filter((request) => {
        const messages = JSON.stringify(request.messages);
        return (
          messages.includes("Return sub1-worker-result") &&
          !messages.includes("sub1-main: delegate the assigned task.") &&
          !JSON.stringify(request.system).includes("OZI COMPLETION CHECK")
        );
      });
      if (provider !== "codex") expect(workerRequests.length).toBeGreaterThan(0);
      for (const request of workerRequests) {
        const system = JSON.stringify(request.system);
        expect(system).not.toContain("Use ticket_* directly");
        expect(system).not.toContain("When a worker should file a ticket itself");
        const tickets = request.tools.filter((entry) =>
          /(?:^|__)ticket_(?:create|update|close|list)$/.test(entry.name),
        );
        if (provider !== "claudeAgent") expect(tickets).toHaveLength(4);
        for (const entry of tickets)
          expect(entry.description).toContain(
            "Delegated workers use this only when their task tells them to",
          );
      }
      expect(workerChecks).toBe(0);
      expect(mainChecks).toBe(1);
      const { tickets } = await run("ticket", "list");
      expect(tickets).toHaveLength(fileTicket ? 1 : 0);
      if (fileTicket)
        expect(tickets[0]).toMatchObject({
          title: "sub1-explicit-ticket",
          origin: { threadId: childThreadId, chatId: result.threadId },
        });
      if (provider === "codex") {
        const wire = (await NodeFSP.readFile(NodePath.join(directory, "wire.jsonl"), "utf8"))
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        expect(wire.some((record) => record.event === "launch")).toBe(true);
        expect(wire.some((record) => record.event === "launch" && record.inboxHook)).toBe(false);
        expect(
          wire.some((record) => record.method === "hooks/list" || record.method === "thread/fork"),
        ).toBe(false);
        expect(
          wire.find((record) => record.method === "thread/start").params.config["hooks.state"],
        ).toBeUndefined();
      }
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
