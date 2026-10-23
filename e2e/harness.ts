import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeNet from "node:net";
import type * as NodeStream from "node:stream";
import * as NodeURL from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import type {
  OrchestrationV2ThreadProjection,
  OrchestrationV2ShellSnapshot,
  ServerConfig,
} from "@t3tools/contracts";

export type Projection = typeof OrchestrationV2ThreadProjection.Encoded;
export type Status = {
  server: typeof ServerConfig.Encoded;
  snapshot: typeof OrchestrationV2ShellSnapshot.Encoded;
  main: Projection | null;
};
export type Step =
  | { say: string }
  | { tool: { name: string; arguments?: Record<string, unknown> } }
  | { ask: string }
  | { approval: string }
  | { wait: true }
  | { exec: string }
  | { think: string }
  | { inference: true }
  | { history: "partial" }
  | { fail: string };
export type Rule = {
  match: string;
  provider?: "pi" | "codex" | "claude";
  role?: "main" | "worker" | "checker";
  steps: Step[];
  repeat?: boolean;
  stage?: "author" | "baseline" | "candidate" | "observer";
};
export type FakeRecord = {
  provider: string;
  event: string;
  role?: string;
  pid: number;
  prompt?: string;
  instructions?: string;
  argv?: string[];
  frame?: { type: string; provider?: string; modelId?: string; level?: string };
  name?: string;
  result?: { isError?: boolean; structuredContent?: Record<string, unknown> };
  tools?: { name: string }[];
  nativeId?: string;
  file?: string;
  sha256?: string;
};
const repo = NodeURL.fileURLToPath(new URL("..", import.meta.url));
const cli = NodePath.join(repo, "apps/server/src/bin.ts");

async function freePort() {
  const server = NodeNet.createServer();
  server.listen(0, "0.0.0.0");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No TCP port");
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

async function fileReady(path: string, pid: number, signal: AbortSignal) {
  try {
    if (JSON.parse(await NodeFSP.readFile(path, "utf8")).pid === pid) return;
  } catch {}
  for await (const _event of NodeFSP.watch(NodePath.dirname(path), { signal })) {
    try {
      if (JSON.parse(await NodeFSP.readFile(path, "utf8")).pid === pid) return;
    } catch {}
  }
}

export async function startHarness(
  options: {
    fresh?: boolean;
    emptyDataRoot?: boolean;
    testClock?: string;
    publicUrl?: string;
    publicUrlEnv?: string;
    repairPause?: string;
    desktopArgv?: string[];
    bundled?: boolean;
    pi?: { binaryPath: string; env: NodeJS.ProcessEnv };
  } = {},
) {
  const entry = options.bundled ? NodePath.join(repo, "apps/server/dist/bin.mjs") : cli;
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "ozi-e2e-"));
  const home = options.desktopArgv
    ? NodePath.join(root, "account", ".ozi")
    : NodePath.join(root, "home");
  const dataRoot = NodePath.join(root, "data-root");
  const script = NodePath.join(root, "script.json");
  const log = NodePath.join(root, "fake.jsonl");
  const port = await freePort();
  await NodeFSP.mkdir(NodePath.join(home, "userdata"), { recursive: true });
  if (!options.fresh)
    await NodeFSP.cp(NodePath.join(repo, "e2e/fixtures/data-root"), dataRoot, { recursive: true });
  else if (options.emptyDataRoot) await NodeFSP.mkdir(dataRoot);
  await NodeFSP.writeFile(script, "[]");
  await NodeFSP.writeFile(log, "");
  const providerInstances = Object.fromEntries(
    [
      ["codex", "codex"],
      ["claude", "claudeAgent"],
      ["pi", "pi"],
    ].map(([name, driver]) => [
      driver!,
      {
        driver,
        enabled: true,
        config: {
          binaryPath:
            driver === "pi" && options.pi
              ? options.pi.binaryPath
              : NodePath.join(repo, "e2e/fakes", name!),
        },
      },
    ]),
  );
  if (!options.fresh)
    await NodeFSP.writeFile(
      NodePath.join(home, "userdata/settings.json"),
      JSON.stringify({
        providerInstances,
        textGenerationModelSelection: { instanceId: "codex", model: "gpt-6.1-sol" },
        automaticGitFetchEnabled: false,
        continueThreadsAfterServerUpdate: false,
      }),
    );
  const env: NodeJS.ProcessEnv = {
    PATH: `${NodePath.join(repo, "e2e/fakes")}:${NodePath.dirname(process.execPath)}:/usr/bin:/bin`,
    HOME: NodePath.join(root, "account"),
    USERPROFILE: NodePath.join(root, "account"),
    XDG_CONFIG_HOME: NodePath.join(root, "config"),
    XDG_CACHE_HOME: NodePath.join(root, "cache"),
    XDG_DATA_HOME: NodePath.join(root, "data"),
    OZI_HOME: options.desktopArgv ? undefined : home,
    T3CODE_HOME: NodePath.join(root, "account", ".t3"),
    OZI_DATA_ROOT: dataRoot,
    OZI_FAKE_SCRIPT: script,
    OZI_FAKE_LOG: log,
    ...(options.testClock === undefined ? {} : { OZI_TEST_CLOCK: options.testClock }),
    ...(options.repairPause === undefined ? {} : { OZI_TEST_REPAIR_PAUSE: options.repairPause }),
    ...(options.publicUrlEnv === undefined ? {} : { OZI_PUBLIC_URL: options.publicUrlEnv }),
    TZ: "UTC",
    CODEX_HOME: NodePath.join(root, "codex"),
    CLAUDE_CONFIG_DIR: NodePath.join(root, "claude"),
    PI_CODING_AGENT_DIR: NodePath.join(root, "pi"),
    OZI_LOG_LEVEL: "Error",
    OZI_TRACE_TIMING_ENABLED: "false",
    OZI_NO_BROWSER: "true",
    CI: "1",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: NodePath.join(root, "gitconfig"),
    ...options.pi?.env,
  };
  await NodeFSP.mkdir(env.HOME!, { recursive: true });
  if (options.desktopArgv) {
    const legacy = NodePath.join(env.T3CODE_HOME!, "bin");
    await NodeFSP.mkdir(legacy, { recursive: true });
    await NodeFSP.writeFile(NodePath.join(legacy, "t3"), "T3 sentinel");
  }
  await NodeFSP.writeFile(
    env.GIT_CONFIG_GLOBAL!,
    options.fresh
      ? "[init]\ndefaultBranch = main\n[commit]\ngpgsign = true\n"
      : "[user]\nname = Ozi E2E\nemail = e2e@example.invalid\n[init]\ndefaultBranch = main\n",
  );
  if (!options.fresh)
    await new Promise<void>((resolve, reject) =>
      NodeChildProcess.execFile("git", ["init", dataRoot], { env }, (error) =>
        error ? reject(error) : resolve(),
      ),
    );
  let browser: Browser | undefined;
  let page: Page | undefined;
  let server: NodeChildProcess.ChildProcess;
  let output = "";
  let closed = false;
  const spawnServer = () => {
    server = NodeChildProcess.spawn(
      process.execPath,
      [
        ...(options.desktopArgv
          ? [NodePath.join(repo, "apps/server/dist/bin.mjs"), ...options.desktopArgv]
          : [entry, "serve", "--mode", "web", "--bootstrap-fd", "3", "--home", home]),
        "--data-root",
        dataRoot,
        "--host",
        "0.0.0.0",
        "--port",
        String(port),
        ...(options.publicUrl === undefined ? [] : ["--public-url", options.publicUrl]),
        "--json",
      ],
      { cwd: root, env, stdio: ["ignore", "pipe", "pipe", "pipe"] },
    );
    (server.stdio[3] as NodeStream.Writable).on("error", (error) => {
      output += String(error);
    });
    (server.stdio[3] as NodeStream.Writable).end(
      JSON.stringify({
        mode: "desktop",
        noBrowser: true,
        port,
        host: "0.0.0.0",
        ...(options.desktopArgv ? {} : { oziHome: home }),
        desktopBootstrapToken: NodeCrypto.randomBytes(32).toString("hex"),
        shellEnvironmentPrepared: true,
        tailscaleServeEnabled: false,
        tailscaleServePort: 443,
      }),
    );
    server.stdout!.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    server.stderr!.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
  };
  const ozi = <T = unknown>(...args: string[]): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      NodeChildProcess.execFile(
        process.execPath,
        [entry, ...args, ...(args.includes("--home") ? [] : ["--home", home]), "--json"],
        {
          cwd: dataRoot,
          env,
          timeout:
            args[0] === "wait" && args.includes("--timeout")
              ? Math.max(45_000, Number(args[args.indexOf("--timeout") + 1]) * 1000 + 5000)
              : 45_000,
          maxBuffer: 16 * 1024 * 1024,
        },
        (error, stdout, stderr) => {
          if (error) {
            const message = `ozi ${args.join(" ")}: ${[stdout, stderr].filter(Boolean).join("\n") || `${error.message} (code=${error.code}, signal=${error.signal}, killed=${error.killed})`}`;
            if (args[0] === "wait")
              void ozi<import("@t3tools/contracts").OziCheck[]>("checks").then(
                async (checks) => {
                  const pending = await Promise.all(
                    checks
                      .filter((check) => check.state === "checking")
                      .map(async (check) => {
                        const id = check.rounds.at(-1)?.checkerThreadId;
                        if (!id) return null;
                        const projection = await ozi<Projection>("thread", id);
                        return {
                          thread: projection.thread,
                          runs: projection.runs,
                          messages: projection.messages,
                        };
                      }),
                  );
                  const records = (await NodeFSP.readFile(log, "utf8"))
                    .split("\n")
                    .filter(Boolean)
                    .map((line) => JSON.parse(line) as FakeRecord)
                    .filter(
                      (record) => record.result?.isError || record.name === "completion_evidence",
                    );
                  reject(
                    new Error(
                      `${message}\nChecks: ${JSON.stringify(checks)}\nCheckers: ${JSON.stringify(pending)}\nTools: ${JSON.stringify(records)}`,
                    ),
                  );
                },
                () => reject(new Error(message)),
              );
            else reject(new Error(message));
            return;
          }
          try {
            resolve(JSON.parse(stdout) as T);
          } catch {
            reject(new Error(`ozi returned invalid JSON: ${stdout}\n${stderr}`));
          }
        },
      );
    });
  const ready = async () => {
    const controller = new AbortController();
    const deadline = setTimeout(
      () => controller.abort(new Error(`Server readiness timeout: ${output}`)),
      45_000,
    );
    const exited = new Promise<never>((_resolve, reject) => {
      server.once("exit", (code) => reject(new Error(`Server exited ${code}: ${output}`)));
      server.once("error", reject);
    });
    try {
      await Promise.race([
        fileReady(
          NodePath.join(home, "userdata/server-runtime.json"),
          server.pid!,
          controller.signal,
        ),
        exited,
      ]);
      await ozi("status");
    } finally {
      clearTimeout(deadline);
      controller.abort();
    }
  };
  const pipe = (input: string, ...args: string[]) =>
    new Promise<{ code: number; stdout: string; stderr: string }>(
      (resolve) =>
        void NodeChildProcess.execFile(
          process.execPath,
          [cli, ...args, ...(args.includes("--home") ? [] : ["--home", home])],
          { cwd: dataRoot, env, timeout: 45_000 },
          (error, stdout, stderr) =>
            resolve({ code: error ? Number(error.code ?? 1) : 0, stdout, stderr }),
        ).stdin?.end(input),
    );
  const execOutput = (...args: string[]) => pipe("", ...args);
  const stopServer = async () => {
    if (server.exitCode !== null || server.signalCode !== null) return;
    const exited = new Promise<void>((resolve) => server.once("exit", () => resolve()));
    server.kill("SIGTERM");
    const deadline = setTimeout(() => server.kill("SIGKILL"), 10_000);
    try {
      await exited;
    } finally {
      clearTimeout(deadline);
    }
  };
  spawnServer();
  try {
    await ready();
  } catch (error) {
    await stopServer();
    await NodeFSP.rm(root, { recursive: true, force: true });
    throw error;
  }
  return {
    root,
    env,
    home,
    dataRoot,
    port,
    ozi,
    git: (...args: string[]) =>
      new Promise<string>((resolve, reject) => {
        NodeChildProcess.execFile("git", args, { cwd: dataRoot, env }, (error, stdout, stderr) =>
          error ? reject(new Error(stderr || error.message)) : resolve(stdout.trim()),
        );
      }),
    stop: stopServer,
    status: () => ozi<Status>("status"),
    execOutput,
    pipe,
    exec: async (...args: string[]) => (await execOutput(...args)).code,
    thread: (id: string) => ozi<Projection>("thread", id),
    wait: (id: string, state: string, timeout = 15) =>
      ozi<Projection>("wait", "thread", id, state, "--timeout", String(timeout)),
    script: (rules: Rule[], options?: { forkWait: string[] }) =>
      NodeFSP.writeFile(script, JSON.stringify(options ? { rules, ...options } : rules)),
    records: async (): Promise<FakeRecord[]> =>
      (await NodeFSP.readFile(log, "utf8"))
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as FakeRecord),
    async page() {
      if (page) return page;
      browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
      page = await browser.newPage();
      const pairing = await ozi<{ url: string }>("pair");
      const url = new URL(pairing.url);
      const address = Object.values(NodeOS.networkInterfaces())
        .flat()
        .find((entry) => entry?.family === "IPv4" && !entry.internal)?.address;
      if (!address) throw new Error("No network address for remote-client scenario");
      url.hostname = address;
      await page.goto(url.toString());
      return page;
    },
    async crash() {
      const exited = new Promise<void>((resolve) => server.once("exit", () => resolve()));
      server.kill("SIGKILL");
      await exited;
      delete env.OZI_TEST_REPAIR_PAUSE;
      spawnServer();
      await ready();
    },
    async restart(environment: Record<string, string> = {}, prepare?: () => Promise<void>) {
      await stopServer();
      await prepare?.();
      Object.assign(env, environment);
      spawnServer();
      await ready();
    },
    async close() {
      if (closed) return;
      closed = true;
      await browser?.close();
      await stopServer();
      await NodeFSP.writeFile(NodePath.join(root, "server.log"), output);
      if (!process.env.OZI_E2E_KEEP) await NodeFSP.rm(root, { recursive: true, force: true });
    },
  };
}
export type Harness = Awaited<ReturnType<typeof startHarness>>;
