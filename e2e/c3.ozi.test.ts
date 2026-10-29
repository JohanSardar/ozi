import * as NodeChildProcess from "node:child_process";
import * as NodeEvents from "node:events";
import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import { afterAll, beforeAll, expect, it } from "vite-plus/test";
import { startAnthropic } from "./fakes/anthropic.ts";

const exec = NodeUtil.promisify(NodeChildProcess.execFile);
const bin = NodePath.resolve(import.meta.dirname, "../apps/server/src/bin.ts");
let directory: string;
let home: string;
let workspace: string;
let source: string;
let port: number;
let env: NodeJS.ProcessEnv;
let fake: Awaited<ReturnType<typeof startAnthropic>>;
let server: NodeChildProcess.ChildProcess | undefined;
const run = async (...args: string[]) => {
  const child = exec(process.execPath, [bin, ...args, "--home", home], {
    cwd: workspace,
    env,
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  child.child.stdin?.end();
  return child.catch((error) => {
    throw new Error(JSON.stringify({ stdout: error.stdout, stderr: error.stderr }));
  });
};
const json = async (...args: string[]) => JSON.parse((await run(...args, "--json")).stdout);
const stop = async () => {
  if (server?.exitCode !== null) return;
  const exited = NodeEvents.once(server, "exit");
  server.kill("SIGTERM");
  await exited;
};
const start = async () => {
  server = NodeChildProcess.spawn(
    process.execPath,
    [bin, "serve", "--home", home, "--port", String(port), "--host", "127.0.0.1", "--no-browser"],
    { cwd: workspace, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  const running = server;
  await new Promise<void>((resolve, reject) => {
    let output = "";
    running.stdout!.on("data", (chunk) => {
      output += chunk;
      if (output.includes("Ozi server is ready.")) resolve();
    });
    running.stderr!.on("data", (chunk) => {
      output += chunk;
    });
    running.once("error", reject);
    running.once("exit", (code) => reject(new Error(`Server exited ${code}: ${output}`)));
  });
};

beforeAll(async () => {
  directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "ozi-c3-native-"));
  home = NodePath.join(directory, "home");
  workspace = NodePath.join(directory, "workspace");
  await NodeFSP.mkdir(workspace);
  await exec("git", ["init", workspace]);
  await NodeFSP.mkdir(NodePath.join(home, "userdata"), { recursive: true });
  await NodeFSP.writeFile(
    NodePath.join(home, "userdata/settings.json"),
    JSON.stringify({
      enableProviderUpdateChecks: false,
      providerInstances: {
        ozi: {
          driver: "pi",
          enabled: true,
          config: { harness: "ozi" },
          environment: [
            {
              name: "PATH",
              value: [NodePath.join(NodeOS.homedir(), ".local", "bin"), process.env.PATH].join(
                NodePath.delimiter,
              ),
            },
          ],
        },
        codex: { driver: "codex", enabled: false },
        claudeAgent: { driver: "claudeAgent", enabled: false },
      },
    }),
  );
  fake = await startAnthropic(() => ({ text: "c3-native-ok" }));
  env = {
    ...process.env,
    HOME: directory,
    OZI_HOME: home,
    OZI_TELEMETRY_ENABLED: "false",
    NODE_COMPILE_CACHE: NodePath.join(directory, "compile-cache"),
    PI_CODING_AGENT_DIR: NodePath.join(directory, "ambient-pi"),
    CLAUDE_CONFIG_DIR: NodePath.join(directory, "claude"),
    CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-ozi-test-only",
    ANTHROPIC_BASE_URL: fake.url,
  };
  const reserve = NodeNet.createServer().listen(0, "127.0.0.1");
  await NodeEvents.once(reserve, "listening");
  port = (reserve.address() as NodeNet.AddressInfo).port;
  await new Promise<void>((resolve) => reserve.close(() => resolve()));
  await start();
});

afterAll(async () => {
  await stop();
  await fake?.close();
  if (directory) await NodeFSP.rm(directory, { recursive: true, force: true });
});

it("C3.ozi-native: real Pi clones and forks keep independent native histories and export HTML", async () => {
  source = (await json("session", "new")).threadId;
  await run("print", "C3 seed", "C3 second", "--thread", source, "--json");
  const messages = (await json("session", "show", source)).messages;
  const clone = (await json("session", "clone", source)).threadId;
  const cloneExport = await json("session", "export", clone, "--format", "jsonl");
  expect(cloneExport.content).toContain("C3 second");
  expect((await json("session", "export", clone, "--format", "html")).content).toMatch(/<html/i);
  expect((await json("print", "C3 clone", "--thread", clone)).text).toBe("c3-native-ok");
  expect(JSON.stringify(fake.requests.at(-1)?.messages)).toContain("C3 seed");
  expect(JSON.stringify(fake.requests.at(-1)?.messages)).toContain("C3 second");
  const fork = await json("session", "fork", source, messages[1].id);
  expect((await json("print", "C3 fork", "--thread", fork.threadId)).text).toBe("c3-native-ok");
  expect(JSON.stringify(fake.requests.at(-1)?.messages)).toContain("C3 seed");
  expect(JSON.stringify(fake.requests.at(-1)?.messages)).not.toContain("C3 second");
  expect((await json("session", "export", source, "--format", "jsonl")).content).toBe(
    cloneExport.content,
  );
});

it("C3.ozi-import: native JSONL imports and reloaded sessions continue after restart", async () => {
  const jsonl = await json("session", "export", source, "--format", "jsonl");
  const importedFile = NodePath.join(directory, "import.jsonl");
  await NodeFSP.writeFile(importedFile, jsonl.content);
  const imported = (await json("session", "import", importedFile)).threadId;
  expect((await json("session", "export", imported, "--format", "jsonl")).content).toBe(
    jsonl.content,
  );
  await json("session", "reload", source);
  await stop();
  await start();
  expect((await json("print", "C3 resumed", "--thread", source)).text).toBe("c3-native-ok");
  expect(JSON.stringify(fake.requests.at(-1)?.messages)).toContain("C3 second");
  expect(JSON.stringify(fake.requests.at(-1)?.messages)).not.toContain("C3 clone");
  expect(JSON.stringify(fake.requests.at(-1)?.messages)).not.toContain("C3 fork");
  expect((await json("print", "C3 imported", "--thread", imported)).text).toBe("c3-native-ok");
  expect(JSON.stringify(fake.requests.at(-1)?.messages)).toContain("C3 second");
  expect(JSON.stringify(fake.requests.at(-1)?.messages)).not.toContain("C3 resumed");
  expect(await NodeFSP.readFile(importedFile, "utf8")).toBe(jsonl.content);
});
