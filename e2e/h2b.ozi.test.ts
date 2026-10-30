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

it("C6.harness-package: the default chat loads repair, completion and inbox with the subscription harness", async () => {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "ozi-h2b-"));
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
  const fake = await startAnthropic((request) => {
    const tool = request.tools.find((entry) => entry.name.includes("orchestrator_capabilities"));
    return tool && !JSON.stringify(request.messages).includes('"tool_result"')
      ? { tool: tool.name, arguments: {} }
      : { text: "h2b-ozi-ok" };
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
          timeout: 120_000,
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
    const result = await run(
      "thread",
      "start",
      "--cwd",
      workspace,
      "Check the GUI capabilities, then reply h2b-ozi-ok.",
      "--wait",
    );
    expect(JSON.stringify(result), output).toContain("h2b-ozi-ok");
    for (const name of ["log_mistake", "completion_check"]) {
      expect(fake.requests.flatMap((request) => request.tools.map((tool) => tool.name))).toEqual(
        expect.arrayContaining([expect.stringMatching(new RegExp(`(?:^|__)${name}$`))]),
      );
    }
    const thread = await run("thread", "show", result.threadId);
    expect(JSON.stringify(thread)).toContain('"providerInstanceId":"ozi"');
    const promptPath = NodePath.join(home, "harness/system.md");
    const prompt = await NodeFSP.readFile(promptPath, "utf8");
    expect(prompt).toContain("You are Ozi");
    await NodeFSP.writeFile(promptPath, `${prompt}\nh2b-edited`);
    await NodeFSP.writeFile(NodePath.join(home, "harness/adhd.md"), "h2b-adhd");
    const first = fake.requests.length;
    await run("thread", "send", result.threadId, "Reply h2b-ozi-ok again without tools.", "--wait");
    expect(
      fake.requests.slice(first).some((request) => {
        const system = JSON.stringify(request.system);
        return system.includes("h2b-edited") && system.includes("h2b-adhd");
      }),
    ).toBe(true);
    for (const request of fake.requests) {
      expect(request.model).toBe("claude-opus-5-5");
      expect(request.output_config?.effort).toBe("high");
      expect(request.speed).not.toBe("fast");
    }
    expect(
      fake.requests.some((request) =>
        request.tools.some((tool) => tool.name.includes("orchestrator_capabilities")),
      ),
    ).toBe(true);
    expect(
      fake.requests.some((request) => JSON.stringify(request.messages).includes('"tool_result"')),
    ).toBe(true);
    expect(JSON.stringify(fake.requests)).not.toContain('"is_error":true');
    expect(JSON.stringify(fake.headers)).not.toContain("must-not-be-used");
    await expect(NodeFSP.stat(NodePath.join(directory, "ambient-pi"))).rejects.toThrow();
    expect(await NodeFSP.readdir(NodePath.join(home, "agents/ozi"))).toBeDefined();
  } finally {
    if (server.exitCode === null && server.signalCode === null) {
      const exited = NodeEvents.once(server, "exit");
      server.kill("SIGTERM");
      await exited;
    }
    await fake.close();
    await NodeFSP.rm(directory, { recursive: true, force: true });
  }
});
