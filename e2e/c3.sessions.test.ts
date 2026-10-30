import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeEvents from "node:events";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import { afterAll, beforeAll, expect, it } from "vite-plus/test";

const exec = NodeUtil.promisify(NodeChildProcess.execFile);
const root = NodePath.resolve(import.meta.dirname, "..");
const bin = NodePath.join(root, "apps/server/src/bin.ts");
let directory: string;
let home: string;
let server: NodeChildProcess.ChildProcess;
let port: number;
let env: NodeJS.ProcessEnv;

const cliAt = (clientHome: string, ...args: string[]) => {
  const running = exec(process.execPath, [bin, ...args, "--home", clientHome], {
    env,
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
  });
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
  directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "ozi-c3-"));
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
          config: { binaryPath: NodePath.join(root, "e2e/fakes/pi.mjs") },
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

const seed = async () => {
  const source = (await json("session", "new", "--title", "C3 source")).threadId;
  const printed = (await cli("print", "first", "second", "--thread", source, "--json")).stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(JSON.parse(printed[0].text)).toEqual({ history: [], prompt: "first" });
  expect(JSON.parse(printed[1].text).history).toEqual(["first"]);
  return source;
};

it("C3.sessions: new, clone and fork preserve independent Pi histories and lineage", async () => {
  const source = await seed();
  const messages = (await json("session", "show", source)).messages;
  const clone = (await json("session", "clone", source)).threadId;
  const fork = await json("session", "fork", source, messages[1].id);
  expect(fork.editorText).toBe("second");
  expect(
    JSON.parse((await json("print", "forked", "--thread", fork.threadId)).text).history,
  ).toEqual(["first"]);
  expect(JSON.parse((await json("print", "cloned", "--thread", clone)).text).history).toEqual([
    "first",
    "second",
  ]);
  const sessions = (await json("session", "list")).sessions;
  expect(
    sessions.find((session: { threadId: string }) => session.threadId === clone).parentThreadId,
  ).toBe(source);
});

it("C3.nested: fresh clones retain inherited messages when cloned and forked again", async () => {
  const source = await seed();
  const messages = (await json("session", "show", source)).messages;
  const clone = (await json("session", "clone", source)).threadId;
  expect((await json("session", "show", clone)).messages).toEqual(messages);
  const nested = (await json("session", "clone", clone)).threadId;
  expect(JSON.parse((await json("print", "nested", "--thread", nested)).text).history).toEqual([
    "first",
    "second",
  ]);
  const inheritedFork = await json("session", "fork", clone, messages[1].id);
  expect(inheritedFork.editorText).toBe("second");
  expect(
    JSON.parse((await json("print", "inherited fork", "--thread", inheritedFork.threadId)).text)
      .history,
  ).toEqual(["first"]);
});

it("C3.boundaries: fork before the first message or a clone's first new message", async () => {
  const source = await seed();
  const clone = (await json("session", "clone", source)).threadId;
  expect(JSON.parse((await json("print", "cloned", "--thread", clone)).text).history).toEqual([
    "first",
    "second",
  ]);
  const cloneMessages = (await json("session", "show", clone)).messages;
  const firstOwnFork = await json("session", "fork", clone, cloneMessages[2].id);
  expect(firstOwnFork.editorText).toBe("cloned");
  expect(
    JSON.parse((await json("print", "first own fork", "--thread", firstOwnFork.threadId)).text)
      .history,
  ).toEqual(["first", "second"]);
  const empty = await json("session", "fork", source, cloneMessages[0].id);
  expect(empty.editorText).toBe("first");
  expect(
    JSON.parse((await json("print", "empty", "--thread", empty.threadId)).text).history,
  ).toEqual([]);
});

it("C3.reload: resume and reload retain native history across server restart", async () => {
  const source = await seed();
  expect((await json("session", "resume", source)).threadId).toBe(source);
  await json("session", "reload", source);
  await stop();
  await start();
  expect(JSON.parse((await json("print", "resumed", "--thread", source)).text).history).toEqual([
    "first",
    "second",
  ]);
});

it("C3.import-export: JSONL is copied verbatim, branches fork correctly, and imports resume after restart", async () => {
  const file = NodePath.join(directory, "input.jsonl");
  const timestamp = "2026-01-01T00:00:00.000Z";
  const entries = [
    { type: "session", version: 3, id: "imported", timestamp, cwd: directory },
    {
      type: "message",
      id: "u1",
      parentId: null,
      timestamp,
      message: { role: "user", content: "imported first" },
    },
    {
      type: "message",
      id: "a1",
      parentId: "u1",
      timestamp,
      message: { role: "assistant", content: [{ type: "text", text: "old reply" }] },
    },
    {
      type: "message",
      id: "discarded",
      parentId: "a1",
      timestamp,
      message: { role: "user", content: "abandoned branch" },
    },
    {
      type: "message",
      id: "u2",
      parentId: "a1",
      timestamp,
      message: { role: "user", content: [{ type: "text", text: "imported second" }] },
    },
  ];
  const content = entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
  await NodeFSP.writeFile(file, content);
  const imported = (await json("session", "import", file)).threadId;
  const output = NodePath.join(directory, "output.jsonl");
  await json("session", "export", imported, "--format", "jsonl", "--output", output);
  expect(await NodeFSP.readFile(output, "utf8")).toBe(content);
  expect((await json("session", "export", imported, "--format", "html")).content).toContain(
    "<!doctype html>",
  );
  const messages = (await json("session", "show", imported)).messages;
  expect(messages.map((message: { text: string }) => message.text)).toEqual([
    "imported first",
    "imported second",
  ]);
  const fork = await json("session", "fork", imported, messages[1].id);
  await stop();
  await start();
  expect(
    JSON.parse((await json("print", "after import", "--thread", imported)).text).history,
  ).toEqual(["imported first", "imported second"]);
  expect(
    JSON.parse((await json("print", "after fork", "--thread", fork.threadId)).text).history,
  ).toEqual(["imported first"]);
  expect(await NodeFSP.readFile(file, "utf8")).toBe(content);
  await NodeFSP.writeFile(file, "invalid");
  await expect(json("session", "import", file)).rejects.toThrow();
});

it("C3.print: aliases, stdin, sequential prompts, files, JSON events and failures", async () => {
  const source = (await json("session", "new")).threadId;
  const file = NodePath.join(directory, "brief.txt");
  await NodeFSP.writeFile(file, "attached evidence");
  const printed = await cli("-p", "one", "two", `@${file}`, "--thread", source, "--json");
  const results = printed.stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(results).toHaveLength(2);
  const prompt = JSON.parse(results[0].text).prompt;
  expect(prompt).toContain('Attached file "brief.txt"');
  const attachmentPath = prompt.match(/saved at: (.+)\]/)?.[1];
  expect(await NodeFSP.readFile(attachmentPath, "utf8")).toBe("attached evidence");
  expect(JSON.parse(results[1].text).prompt).toBe("two");
  const streamed = (await cli("--print", "streamed", "--thread", source, "--mode", "json")).stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(streamed.slice(0, -1).some((event) => event.event?.type === "message.updated")).toBe(true);
  expect(streamed.at(-1)).toMatchObject({ threadId: source, status: "completed" });
  const child = NodeChildProcess.spawn(
    process.execPath,
    [bin, "-p", "stdin prompt", "--thread", source, "--home", home],
    { env, stdio: ["pipe", "pipe", "pipe"] },
  );
  let text = "";
  child.stdout.on("data", (chunk) => {
    text += chunk;
  });
  child.stdin.end("piped evidence\n");
  const [code] = await NodeEvents.once(child, "exit");
  expect(code).toBe(0);
  expect(JSON.parse(text).prompt).toBe("piped evidence\n\nstdin prompt");
  await expect(cli("print", "fail", "--thread", source)).rejects.toThrow();
  const question = await cli("print", "ask", "--thread", source, "--json").then(
    () => undefined,
    (error) => JSON.parse(error.message),
  );
  expect(question.code).toBe(1);
  expect(question.stderr.trim().split("\n")).toHaveLength(1);
  expect(JSON.parse(question.stdout).status).toBe("waiting");
  const requestId = question.stderr.match(/ozi answer ([^ ]+)/)?.[1];
  expect(requestId).toBeDefined();
  await expect(json("session", "reload", source)).rejects.toThrow("finish");
  await json("answer", requestId, '{"decision":"accept"}', "--thread", source);
  expect((await json("print", "answered", "--thread", source)).status).toBe("completed");
});

it("C3.remote: paired clients import, export, print and answer without local server state", async () => {
  const source = await seed();
  const client = NodePath.join(directory, "remote-client");
  const remote = async (...args: string[]) =>
    JSON.parse((await cliAt(client, ...args, "--json")).stdout);
  const pairing = await json("pair");
  await remote("connect", pairing.pairingUrl);
  const output = NodePath.join(client, "export.jsonl");
  await remote("session", "export", source, "--format", "jsonl", "--output", output);
  const imported = (await remote("session", "import", output)).threadId;
  expect(JSON.parse((await remote("print", "remote", "--thread", imported)).text).history).toEqual([
    "first",
    "second",
  ]);
  const streamed = (
    await cliAt(client, "-p", "events", "--thread", imported, "--mode", "json")
  ).stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(streamed.some((event) => event.event?.type === "message.updated")).toBe(true);
  expect(streamed.at(-1)).toMatchObject({ status: "completed" });
  const question = await remote("print", "ask", "--thread", imported).then(
    () => undefined,
    (error) => JSON.parse(error.message),
  );
  const requestId = question.stderr.match(/ozi answer ([^ ]+)/)?.[1];
  expect(requestId).toBeDefined();
  await remote("answer", requestId, '{"decision":"accept"}', "--thread", imported);
  expect((await remote("print", "answered", "--thread", imported)).status).toBe("completed");
  await expect(NodeFSP.access(NodePath.join(client, "userdata/statev2.sqlite"))).rejects.toThrow();
  expect(await NodeFSP.readFile(output, "utf8")).not.toContain("remote");
});

it("C3.remote-access: restricted and revoked sessions fail and live local state takes precedence", async () => {
  const client = NodePath.join(directory, "restricted-client");
  const pairing = await json("pair");
  await cliAt(client, "connect", pairing.pairingUrl, "--access", "read-only", "--json");
  await expect(cliAt(client, "session", "list", "--json")).rejects.toThrow("ozi connect");
  const sessions = await json("auth", "session", "list");
  const previous = new Set(sessions.map((session: { sessionId: string }) => session.sessionId));
  await cliAt(client, "connect", (await json("pair")).pairingUrl, "--json");
  const issued = (await json("auth", "session", "list")).find(
    (session: { sessionId: string }) => !previous.has(session.sessionId),
  );
  expect(issued).toBeDefined();
  await cli("auth", "session", "revoke", issued.sessionId);
  await expect(cliAt(client, "session", "list", "--json")).rejects.toThrow("ozi connect");
  await NodeFSP.writeFile(NodePath.join(home, "remote.json"), "invalid");
  try {
    expect(Array.isArray((await json("session", "list")).sessions)).toBe(true);
  } finally {
    await NodeFSP.rm(NodePath.join(home, "remote.json"));
  }
});
