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
const bin = NodePath.join(root, "apps/server/src/bin.ts");

it("p6.pi-config: local and remote changes refresh idle chats without interrupting a turn", async () => {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "ozi-p6-"));
  const home = NodePath.join(directory, "home");
  const client = NodePath.join(directory, "client");
  const held = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const fake = await startAnthropic(async (request) => {
    const system = JSON.stringify(request.system);
    if (system.includes("OZI COMPLETION CHECK"))
      return {
        text: JSON.stringify({
          verdict: { verdict: "done", useful: false },
          verified: ["The requested probe reply is present."],
        }),
      };
    const last = JSON.stringify(request.messages.findLast((message) => message.role !== "system"));
    if (last.includes("P6_HOLD")) {
      held.resolve();
      await release.promise;
      return { text: "P6_HELD_FINISHED" };
    }
    if (last.includes("P6_CALL")) {
      const tool = request.tools.find((tool) => tool.name.endsWith("list_reminders"));
      return tool ? { tool: tool.name, arguments: {} } : { text: "P6_MISSING_TOOL" };
    }
    return { text: "P6_READY" };
  });
  const env = {
    ...process.env,
    HOME: directory,
    OZI_HOME: home,
    OZI_TELEMETRY_ENABLED: "false",
    PI_CODING_AGENT_DIR: NodePath.join(directory, "ambient-pi"),
    CLAUDE_CONFIG_DIR: NodePath.join(directory, "claude"),
    CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-ozi-test-only",
    ANTHROPIC_BASE_URL: fake.url,
  };
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
  const reserve = NodeNet.createServer().listen(0, "127.0.0.1");
  await NodeEvents.once(reserve, "listening");
  const port = (reserve.address() as NodeNet.AddressInfo).port;
  await new Promise<void>((resolve) => reserve.close(() => resolve()));
  const server = NodeChildProcess.spawn(
    process.execPath,
    [bin, "serve", "--home", home, "--port", String(port), "--host", "127.0.0.1", "--no-browser"],
    { cwd: directory, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  const cli = async (clientHome: string, ...args: string[]) => {
    const running = exec(
      process.execPath,
      [
        bin,
        ...(args[0] === "pi"
          ? ["pi", "--home", clientHome, "--json", ...args.slice(1)]
          : [...args, "--home", clientHome, "--json"]),
      ],
      { cwd: directory, env, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
    );
    running.child.stdin?.end();
    return JSON.parse((await running).stdout);
  };
  const run = (...args: string[]) => cli(home, ...args);
  let output = "";
  server.stderr.on("data", (chunk) => {
    output += chunk;
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.stdout.on("data", (chunk) => {
        output += chunk;
        if (output.includes("Ozi server is ready.")) resolve();
      });
      server.once("error", reject);
      server.once("exit", (code) => reject(new Error(`Server exited ${code}: ${output}`)));
    });
    const thread = (await run("thread", "start", "P6_READY", "--wait")).threadId;
    const other = (await run("thread", "start", "P6_OTHER", "--wait")).threadId;
    const before = await run("main", "get_state", "--thread", thread);
    const pending = run("print", "P6_HOLD", "--thread", thread);
    await Promise.race([
      held.promise,
      pending.then(() => {
        throw new Error("The held request completed before the transport barrier.");
      }),
    ]);
    const agentDir = NodePath.join(home, "agents/ozi");
    await NodeFSP.mkdir(NodePath.join(agentDir, "skills/p6-probe"), { recursive: true });
    await NodeFSP.writeFile(
      NodePath.join(agentDir, "skills/p6-probe/SKILL.md"),
      "---\nname: p6-probe\ndescription: P6_SKILL_LOADED\n---\nP6 skill instructions.\n",
    );
    await NodeFSP.writeFile(NodePath.join(agentDir, "APPEND_SYSTEM.md"), "P6_APPEND_LOADED");
    expect(
      await run(
        "pi",
        "--thread",
        thread,
        "mcp",
        "add",
        "p6-probe",
        "--exposure",
        "direct",
        "--",
        "node",
        NodePath.join(root, "e2e/fakes/p6-mcp.mjs"),
      ),
    ).toMatchObject({ exitCode: 0 });
    expect(
      (await run("thread", "list")).find((item: { threadId: string }) => item.threadId === thread)
        .status,
    ).toBe("running");
    expect((await run("main", "get_state", "--thread", thread)).sessionFile).toBe(
      before.sessionFile,
    );
    release.resolve();
    expect(await pending).toMatchObject({ status: "completed", text: "P6_HELD_FINISHED" });
    const first = fake.requests.length;
    expect(await run("print", "P6_CALL", "--thread", thread)).toMatchObject({
      status: "completed",
    });
    const refreshed = fake.requests.slice(first).find((request) => request.tools.length > 0)!;
    expect(refreshed.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/__read$/),
        expect.stringMatching(/list_reminders$/),
        expect.stringMatching(/ticket_list$/),
      ]),
    );
    expect(JSON.stringify(refreshed.system)).toContain("P6_SKILL_LOADED");
    expect(JSON.stringify(refreshed.system)).toContain("P6_APPEND_LOADED");
    expect(JSON.stringify(fake.requests.slice(first))).toContain("P6_REMINDERS_OK");
    expect((await run("main", "get_state", "--thread", thread)).sessionFile).toBe(
      before.sessionFile,
    );
    expect(await run("print", "P6_OTHER_AGAIN", "--thread", other)).toMatchObject({
      status: "completed",
    });
    expect(
      fake.requests
        .findLast((request) =>
          JSON.stringify(
            request.messages.findLast((message) => message.role !== "system"),
          ).includes("P6_OTHER_AGAIN"),
        )
        ?.tools.some((tool) => tool.name.endsWith("list_reminders")),
    ).toBe(true);
    await cli(client, "connect", (await run("pair")).pairingUrl);
    expect(await cli(client, "pi", "--thread", thread, "mcp", "remove", "p6-probe")).toMatchObject({
      exitCode: 0,
    });
    const removed = fake.requests.length;
    await run("print", "P6_REMOVED", "--thread", thread);
    expect(
      fake.requests
        .slice(removed)
        .find((request) => request.tools.length > 0)
        ?.tools.some((tool) => tool.name.endsWith("list_reminders")),
    ).toBe(false);
  } finally {
    release.resolve();
    if (server.exitCode === null && server.signalCode === null) {
      const exited = NodeEvents.once(server, "exit");
      server.kill("SIGTERM");
      await exited;
    }
    await fake.close();
    await NodeFSP.rm(directory, { recursive: true, force: true });
  }
});
