import * as NodeCrypto from "node:crypto";
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import * as NodeEvents from "node:events";
import * as NodeNet from "node:net";
import { afterAll, beforeAll, expect, it } from "vite-plus/test";
import { startAnthropic } from "./fakes/anthropic.ts";

const exec = NodeUtil.promisify(NodeChildProcess.execFile);
const root = NodePath.resolve(import.meta.dirname, "..");
const bin = NodePath.join(root, "apps/server/src/bin.ts");
let directory: string;
beforeAll(async () => {
  directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "ozi-c5-"));
});
afterAll(async () => {
  await NodeFSP.rm(directory, { recursive: true, force: true });
});

it("C5.validation: migration requires explicit source paths", async () => {
  const result = await exec(process.execPath, [bin, "migrate", "--help"], {
    env: { ...process.env, HOME: directory },
  });
  expect(result.stdout).toContain("--from-home");
  expect(result.stdout).toContain("--from-data-root");
  expect(result.stdout).toContain("--dry-run");
});

const legacyRepo = process.env.OZI_C5_LEGACY_REPO;
type Legacy = {
  home: string;
  dataRoot: string;
  root: string;
  env: NodeJS.ProcessEnv;
  ozi: <T = unknown>(...args: string[]) => Promise<T>;
  script: (rules: unknown[]) => Promise<void>;
  wait: (
    id: string,
    state: string,
    timeout?: number,
  ) => Promise<{ messages: { role: string; text: string }[] }>;
  stop: () => Promise<void>;
  close: () => Promise<void>;
  git: (...args: string[]) => Promise<string>;
};
let old: Legacy;
let target: string;
let webhook: { id: string; webhook: { path: string } };
let secret: string;
let sourceHead: string;
let sourceFiles: string;
const digest = async (directory: string): Promise<string> => {
  const values: string[] = [];
  for (const name of (await NodeFSP.readdir(directory)).sort()) {
    const file = NodePath.join(directory, name);
    const stat = await NodeFSP.lstat(file);
    values.push(
      name,
      stat.isDirectory()
        ? await digest(file)
        : NodeCrypto.createHash("sha256")
            .update(await NodeFSP.readFile(file))
            .digest("hex"),
    );
  }
  return NodeCrypto.createHash("sha256").update(values.join("\n")).digest("hex");
};
const cli = async (...args: string[]) => {
  const running = exec(process.execPath, [bin, ...args], {
    env: {
      ...process.env,
      HOME: directory,
      NODE_COMPILE_CACHE: NodePath.join(directory, "compile-cache"),
      OZI_TELEMETRY_ENABLED: "false",
    },
    maxBuffer: 8 * 1024 * 1024,
    timeout: 30_000,
  });
  running.child.stdin?.end();
  const result = await running.catch((error) => {
    throw new Error(`${error.stdout}\n${error.stderr}`);
  });
  return JSON.parse(result.stdout);
};
const migrate = (...args: string[]) =>
  cli("migrate", "--from-home", old.home, "--from-data-root", old.dataRoot, "--json", ...args);

beforeAll(async () => {
  if (!legacyRepo) return;
  const legacy = await import(NodePath.join(legacyRepo, "e2e/harness.ts"));
  old = await legacy.startHarness({ testClock: "2030-01-01T00:00:00.000Z" });
  target = `${old.home}-gui`;
  if (process.env.OZI_E2E_KEEP) console.log(`C5 synthetic source: ${old.home}`);
  secret = NodeCrypto.randomBytes(32).toString("hex");
  await old.script([
    {
      match: "^C5 prepare$",
      role: "main",
      steps: [
        {
          tool: {
            name: "delegate_task",
            arguments: {
              task: "C5 signing",
              title: "Signing",
              target: { providerInstanceId: "pi", model: "claude-bridge/claude-opus-5-5" },
            },
          },
        },
        { say: "C5 main history" },
      ],
    },
    {
      match: "^C5 signing$",
      role: "worker",
      steps: [
        {
          tool: {
            name: "request_secret",
            arguments: { label: "Webhook signing key", reason: "C5 migration" },
          },
        },
        { say: "signing-ref:$result.secretRef" },
      ],
    },
    {
      match: ".*",
      role: "checker",
      repeat: true,
      steps: [{ say: '{"verdict":"done","useful":false}' }],
    },
    { match: "^C5 session message$", steps: [{ say: "C5 session reply" }] },
    { match: ".*", role: "main", repeat: true, steps: [{ say: "C5 main history" }] },
  ]);
  await old.ozi("say", "C5 prepare");
  await old.wait("ozi-main", "text:C5 main history");
  const [job] = await old.ozi<{ jobId: string }[]>("jobs");
  const requested = await old.ozi<{ requests: { id: string }[] }>(
    "wait",
    "job",
    job!.jobId,
    "needs_you",
    "--timeout",
    "30",
  );
  await old.ozi("answer", requested.requests[0]!.id, secret);
  const worker = await old.wait(job!.jobId, "text:signing-ref:");
  const ref = worker.messages
    .find((message) => message.text.startsWith("signing-ref:"))!
    .text.slice("signing-ref:".length);
  webhook = await old.ozi(
    "schedule",
    "add",
    "--webhook",
    "--secret-ref",
    ref,
    "--replay-key",
    "{{body.id}}",
    "--prompt",
    "C5 webhook:{{body.text}}",
  );
  await old.ozi("schedule", "add", "--every", "1h", "--prompt", "C5 interval");
  await old.ozi("schedule", "add", "--at", "09:30", "--days", "1,3", "--prompt", "C5 weekdays");
  const session = await old.ozi<{ threadId: string }>(
    "session",
    "new",
    "--title",
    "C5 saved session",
  );
  await old.ozi("thread", session.threadId, "--message", "C5 session message");
  await old.wait(session.threadId, "completed", 20);
  await NodeFSP.writeFile(NodePath.join(old.dataRoot, "adhd.md"), "C5 remembered rule\n");
  await NodeFSP.mkdir(NodePath.join(old.dataRoot, "skills/c5"), { recursive: true });
  await NodeFSP.writeFile(NodePath.join(old.dataRoot, "skills/c5/SKILL.md"), "C5 skill\n");
  await NodeFSP.mkdir(NodePath.join(old.dataRoot, "protected"), { recursive: true });
  await NodeFSP.writeFile(NodePath.join(old.dataRoot, "protected/rule.md"), "C5 protected rule\n");
  await old.git("add", ".");
  await old.git("commit", "-m", "C5 data history");
  sourceHead = await old.git("rev-parse", "HEAD");
  await expect(migrate("--dry-run")).rejects.toThrow("Stop the old server");
  await old.stop();
  const settingsPath = NodePath.join(old.home, "userdata/settings.json");
  const settings = JSON.parse(await NodeFSP.readFile(settingsPath, "utf8"));
  settings.providerInstances.pi.environment = [
    { name: "C5_PROVIDER_SECRET", value: "", valueRedacted: true, sensitive: true },
  ];
  await NodeFSP.writeFile(settingsPath, JSON.stringify(settings));
  await NodeFSP.writeFile(
    NodePath.join(
      old.home,
      "userdata/secrets",
      `provider-env-${Buffer.from("pi").toString("base64url")}-${Buffer.from("C5_PROVIDER_SECRET").toString("base64url")}.bin`,
    ),
    secret,
    { mode: 0o600 },
  );
  sourceFiles = await digest(old.home);
});

afterAll(async () => {
  await old?.close();
});

it.skipIf(!legacyRepo)(
  "C5.dry-run: inventories a real stopped old install without changing either home",
  async () => {
    const result = await migrate("--dry-run");
    expect(result.status).toBe("dry-run");
    expect(result.chats).toBe(3);
    expect(result.piSessions).toBe(3);
    expect(result.schedules).toBe(3);
    expect(result.webhooks).toBe(1);
    expect(result.secretFiles).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(
      result.files.some((file: { to: string }) => file.to.endsWith("harness/protected/rule.md")),
    ).toBe(true);
    await expect(NodeFSP.access(target)).rejects.toThrow();
    expect(await digest(old.home)).toBe(sourceFiles);
  },
);

it.skipIf(!legacyRepo)(
  "C5.migrate: publishes once, retains git history and owner-only secrets, and refuses overlap",
  async () => {
    await expect(migrate("--home", old.home)).rejects.toThrow();
    const result = await migrate();
    expect(result.status).toBe("migrated");
    for (const file of result.files.filter((file: { from: string }) =>
      file.from.endsWith(".jsonl"),
    ))
      if (file.cwd === undefined)
        expect(await NodeFSP.readFile(file.to)).toEqual(await NodeFSP.readFile(file.from));
      else {
        const original = await NodeFSP.readFile(file.from, "utf8");
        const imported = await NodeFSP.readFile(file.to, "utf8");
        expect(imported.slice(imported.indexOf("\n"))).toBe(original.slice(original.indexOf("\n")));
        expect(JSON.parse(imported.split("\n", 1)[0]!).cwd).toBe(file.cwd);
      }
    expect(await digest(NodePath.join(target, "harness"))).toBe(await digest(old.dataRoot));
    expect((await migrate()).status).toBe("already-migrated");
    const settings = JSON.parse(
      await NodeFSP.readFile(NodePath.join(target, "userdata/settings.json"), "utf8"),
    );
    expect(settings.providerInstances.ozi.displayName).toBe("Ozi");
    expect(settings.providerInstances.ozi.environment[0].name).toBe("C5_PROVIDER_SECRET");
    expect(
      await NodeFSP.readFile(
        NodePath.join(
          target,
          "userdata/secrets",
          `provider-env-${Buffer.from("ozi").toString("base64url")}-${Buffer.from("C5_PROVIDER_SECRET").toString("base64url")}.bin`,
        ),
        "utf8",
      ),
    ).toBe(secret);
    expect(await digest(old.home)).toBe(sourceFiles);
    const head = await exec("git", ["-C", NodePath.join(target, "harness"), "rev-parse", "HEAD"]);
    expect(head.stdout.trim()).toBe(sourceHead);
    expect((await NodeFSP.stat(NodePath.join(target, "userdata/secrets"))).mode & 0o077).toBe(0);
    for (const name of await NodeFSP.readdir(NodePath.join(old.home, "userdata/secrets"))) {
      expect(await NodeFSP.readFile(NodePath.join(target, "userdata/secrets", name))).toEqual(
        await NodeFSP.readFile(NodePath.join(old.home, "userdata/secrets", name)),
      );
      expect(
        (await NodeFSP.stat(NodePath.join(target, "userdata/secrets", name))).mode & 0o077,
      ).toBe(0);
    }
    expect(await NodeFSP.readFile(NodePath.join(target, "harness/system.md"))).toEqual(
      await NodeFSP.readFile(NodePath.join(old.dataRoot, "system.md")),
    );
  },
);

it.skipIf(!legacyRepo)(
  "C5.reopen: the GUI server reads history, resumes native context and accepts the original signed webhook",
  async () => {
    const reserve = NodeNet.createServer().listen(0, "127.0.0.1");
    await NodeEvents.once(reserve, "listening");
    const port = (reserve.address() as import("node:net").AddressInfo).port;
    await new Promise<void>((resolve) => reserve.close(() => resolve()));
    const settingsFile = NodePath.join(target, "userdata/settings.json");
    const settings = JSON.parse(await NodeFSP.readFile(settingsFile, "utf8"));
    for (const provider of Object.values(settings.providerInstances) as { enabled: boolean }[])
      provider.enabled = false;
    settings.providerInstances.ozi.enabled = true;
    settings.providerInstances.ozi.config.binaryPath = "";
    const transport = await startAnthropic(() => ({ text: "C5 native context resumed" }));
    settings.enableProviderUpdateChecks = false;
    await NodeFSP.writeFile(settingsFile, JSON.stringify(settings));
    const server = NodeChildProcess.spawn(
      process.execPath,
      [
        bin,
        "serve",
        "--home",
        target,
        "--port",
        String(port),
        "--host",
        "127.0.0.1",
        "--no-browser",
      ],
      {
        cwd: directory,
        env: {
          ...process.env,
          HOME: directory,
          OZI_LOG_LEVEL: "Info",
          OZI_HOME: target,
          OZI_TEST_CLOCK: "2030-01-01T00:00:00.000Z",
          PI_CODING_AGENT_DIR: NodePath.join(directory, "ambient-pi"),
          CLAUDE_CONFIG_DIR: NodePath.join(directory, "claude"),
          CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-ozi-test-only",
          ANTHROPIC_BASE_URL: transport.url,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    try {
      await new Promise<void>((resolve, reject) => {
        server.stdout.on("data", (chunk) => {
          output += chunk;
          if (output.includes("Ozi server is ready.")) resolve();
        });
        server.stderr.on("data", (chunk) => {
          output += chunk;
        });
        server.once("error", reject);
        server.once("exit", (code) => reject(new Error(`GUI server exited ${code}: ${output}`)));
      });
      const run = (...args: string[]) => cli(...args, "--home", target, "--json");
      const sessions = (await run("session", "list")).sessions;
      expect(
        sessions.some((session: { threadId: string }) => session.threadId === "ozi-main"),
      ).toBe(true);
      const history = await run("thread", "show", "ozi-main");
      expect(
        history.messages.some((message: { text: string }) => message.text === "C5 main history"),
      ).toBe(true);
      const session = sessions.find(
        (entry: { title: string }) => entry.title === "C5 saved session",
      );
      const resumed = await run("print", "C5 resumed", "--thread", session.threadId);
      expect(resumed.text).toBe("C5 native context resumed");
      expect(
        transport.requests.some((request) =>
          JSON.stringify(request.messages).includes("C5 session message"),
        ),
      ).toBe(true);
      expect((await run("print", "C5 main resumed", "--thread", "ozi-main")).text).toBe(
        "C5 native context resumed",
      );
      expect(
        transport.requests.some((request) => {
          const context = JSON.stringify(request.messages);
          return (
            context.includes("C5 main resumed") &&
            context.includes("C5 prepare") &&
            context.includes("C5 main history")
          );
        }),
      ).toBe(true);
      const schedules = await run("schedules");
      expect(schedules.tasks).toHaveLength(3);
      const task = schedules.tasks.find(
        (item: { scheduledTaskId: string }) => item.scheduledTaskId === webhook.id,
      );
      expect(task.webhookSignature).toBe("set");
      const body = JSON.stringify({ id: "C5-delivery", text: "migrated" });
      const send = (signature: string) =>
        fetch(`http://127.0.0.1:${port}${webhook.webhook.path}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-hub-signature-256": `sha256=${signature}`,
          },
          body,
        });
      expect((await send("bad")).status).toBe(401);
      const signature = NodeCrypto.createHmac("sha256", secret).update(body).digest("hex");
      expect((await send(signature)).status).toBe(202);
      expect((await send(signature)).status).toBe(202);
      expect(JSON.stringify(schedules)).not.toContain(secret);
      expect(await digest(old.home)).toBe(sourceFiles);
      expect((await migrate()).status).toBe("already-migrated");
    } finally {
      await transport.close();
      if (server.exitCode === null) {
        const exited = NodeEvents.once(server, "exit");
        server.kill("SIGTERM");
        await exited;
      }
    }
  },
);

it.skipIf(!legacyRepo)(
  "C5.fail-closed: existing destinations and symbolic links leave the source and destination intact",
  async () => {
    const blocked = NodePath.join(directory, "occupied");
    await NodeFSP.mkdir(blocked);
    await NodeFSP.writeFile(NodePath.join(blocked, "sentinel"), "C5 keep");
    await expect(migrate("--home", blocked)).rejects.toThrow("already exists");
    expect(await NodeFSP.readFile(NodePath.join(blocked, "sentinel"), "utf8")).toBe("C5 keep");
    const link = NodePath.join(old.dataRoot, "skills/c5/link");
    await NodeFSP.symlink(NodePath.join(blocked, "sentinel"), link);
    const bad = NodePath.join(directory, "bad-target");
    try {
      await expect(migrate("--home", bad, "--dry-run")).rejects.toThrow("symbolic link");
    } finally {
      await NodeFSP.unlink(link);
    }
    await expect(NodeFSP.access(bad)).rejects.toThrow();
    expect(await digest(old.home)).toBe(sourceFiles);
  },
);

it.skipIf(!legacyRepo)(
  "C5.interrupted: killing staging leaves a retryable import and concurrent imports publish once",
  async () => {
    const destination = NodePath.join(old.root, "interrupted-gui");
    const watcher = NodeFSP.watch(old.root);
    const command = NodeChildProcess.spawn(
      process.execPath,
      [
        bin,
        "migrate",
        "--from-home",
        old.home,
        "--from-data-root",
        old.dataRoot,
        "--home",
        destination,
        "--json",
      ],
      { env: { ...process.env, HOME: directory }, stdio: "ignore" },
    );
    const exited = NodeEvents.once(command, "exit");
    try {
      for await (const event of watcher) {
        if (event.filename?.startsWith(".ozi-migration-")) {
          command.kill("SIGKILL");
          break;
        }
      }
      await exited;
    } finally {
      await watcher.return();
      if (command.exitCode === null && command.signalCode === null) command.kill("SIGKILL");
    }
    await expect(NodeFSP.access(destination)).rejects.toThrow();
    expect((await migrate("--home", destination)).status).toBe("migrated");
    const concurrent = NodePath.join(old.root, "concurrent-gui");
    const results = await Promise.allSettled([
      migrate("--home", concurrent),
      migrate("--home", concurrent),
    ]);
    expect(results.some((result) => result.status === "fulfilled")).toBe(true);
    expect((await migrate("--home", concurrent)).status).toBe("already-migrated");
    expect(await digest(old.home)).toBe(sourceFiles);
  },
);
