import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeEvents from "node:events";
import * as NodeFSP from "node:fs/promises";
import * as NodeModule from "node:module";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import { afterAll, beforeAll, expect, it } from "vite-plus/test";

const exec = NodeUtil.promisify(NodeChildProcess.execFile);
const root = NodePath.resolve(import.meta.dirname, "..");
const require = NodeModule.createRequire(NodePath.join(root, "apps/server/package.json"));
const WebSocket = require("ws") as typeof import("../apps/server/node_modules/ws").WebSocket;
let directory: string;
let home: string;
let origin: string;
let server: NodeChildProcess.NodeChildProcess;
let chat: { threadId: string; projectId: string };
let socket: InstanceType<typeof WebSocket>;
let serial = 0;

const cli = async (...args: string[]) => {
  const { stdout } = await exec(
    process.execPath,
    [NodePath.join(root, "apps/server/src/bin.ts"), ...args, "--home", home],
    {
      cwd: directory,
      env: {
        ...process.env,
        HOME: directory,
        OZI_HOME: home,
        OZI_TELEMETRY_ENABLED: "false",
        NODE_COMPILE_CACHE: NodePath.join(directory, "compile-cache"),
      },
      timeout: 60_000,
    },
  );
  return JSON.parse(stdout);
};

const rpc = async (tag: string, payload: unknown) => {
  const id = String(++serial);
  return new Promise<any>((resolve, reject) => {
    const receive = (raw: unknown) => {
      const frame = JSON.parse(String(raw));
      if (frame.requestId !== id || frame._tag !== "Exit") return;
      socket.off("message", receive);
      if (frame.exit._tag === "Success") resolve(frame.exit.value);
      else reject(new Error(JSON.stringify(frame.exit)));
    };
    socket.on("message", receive);
    socket.send(JSON.stringify({ _tag: "Request", id, tag, payload, headers: [] }));
  });
};

const start = async (publicUrl?: string | null) => {
  const reserve = NodeNet.createServer();
  reserve.listen(0, "127.0.0.1");
  await NodeEvents.once(reserve, "listening");
  const address = reserve.address();
  if (address === null || typeof address === "string") throw new Error("Missing port");
  origin = `http://127.0.0.1:${address.port}`;
  await new Promise<void>((resolve) => reserve.close(() => resolve()));
  server = NodeChildProcess.spawn(
    process.execPath,
    [
      NodePath.join(root, "apps/server/src/bin.ts"),
      "serve",
      "--home",
      home,
      "--host",
      "127.0.0.1",
      "--port",
      String(address.port),
      ...(publicUrl == null ? [] : ["--public-url", publicUrl]),
    ],
    {
      cwd: directory,
      env: {
        ...process.env,
        HOME: directory,
        OZI_HOME: home,
        OZI_TELEMETRY_ENABLED: "false",
        OZI_TEST_CLOCK: "2026-10-25T08:59:00Z",
        TZ: "UTC",
        NODE_COMPILE_CACHE: NodePath.join(directory, "compile-cache"),
        ...(publicUrl === null ? {} : { OZI_PUBLIC_URL: "https://environment.example.invalid" }),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  await new Promise<void>((resolve, reject) => {
    let output = "";
    const receive = (chunk: unknown) => {
      output += String(chunk);
      if (output.includes("Ozi server is ready.")) resolve();
    };
    server.stdout!.on("data", receive);
    server.stderr!.on("data", receive);
    server.once("exit", (code) => reject(new Error(`Server exited ${code}: ${output}`)));
    server.once("error", reject);
  });
  const pair = await cli("pair", "--json");
  const credential = new URL(pair.pairingUrl).hash.split("token=")[1];
  const response = await fetch(`${origin}/api/auth/browser-session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ credential }),
  });
  expect(response.status).toBe(200);
  socket = new WebSocket(`${origin.replace("http:", "ws:")}/ws?orchestrationProtocol=2`, {
    headers: {
      cookie: response.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; "),
    },
  });
  await NodeEvents.once(socket, "open");
};

const stop = async () => {
  socket?.terminate();
  if (server?.exitCode === null) {
    const exited = NodeEvents.once(server, "exit");
    server.kill("SIGTERM");
    await exited;
  }
};

const advance = (value: string) => cli("test-clock", "--advance", value, "--json");
const messages = async () =>
  (await cli("thread", "show", chat.threadId, "--messages", "100", "--json")).messages as Array<{
    role: string;
    text: string;
  }>;
const delivered = async (text: string) => {
  try {
    await expect
      .poll(
        async () =>
          (await messages())
            .filter((message) => message.role === "user")
            .map((message) => message.text),
        { timeout: 15_000 },
      )
      .toContain(text);
  } catch (cause) {
    throw new Error(
      JSON.stringify({
        schedules: await cli("schedules", "--json"),
        chat: await cli("thread", "show", chat.threadId, "--json"),
      }),
      { cause },
    );
  }
};
const add = (...args: string[]) =>
  cli("schedule", "add", "--chat", chat.threadId, "--json", ...args);

beforeAll(async () => {
  directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "ozi-c1-"));
  home = NodePath.join(directory, ".ozi");
  await NodeFSP.mkdir(NodePath.join(home, "userdata"), { recursive: true });
  await NodeFSP.writeFile(
    NodePath.join(home, "userdata/settings.json"),
    JSON.stringify({
      providerInstances: {
        pi: {
          driver: "pi",
          enabled: true,
          config: { enabled: true, binaryPath: NodePath.join(root, "e2e/fakes/pi.mjs") },
        },
      },
      defaultModelSelection: { instanceId: "pi", model: "test/c1-model" },
    }),
  );
  await exec("git", ["init", directory]);
  await start("https://hooks.example.invalid/base/");
}, 180_000);

it("c1.target: create a real chat through the CLI", async () => {
  await exec(
    process.execPath,
    [NodePath.join(root, "apps/server/src/bin.ts"), "project", "add", directory, "--home", home],
    { cwd: directory },
  );
  chat = await cli(
    "thread",
    "start",
    directory,
    "C1 target",
    "--provider",
    "pi",
    "--model",
    "test/c1-model",
    "--wait",
    "--json",
  );
  const shown = await cli("thread", "show", chat.threadId, "--json");
  chat.projectId = shown.thread.projectId;
});

afterAll(async () => {
  await stop();
  if (directory) await NodeFSP.rm(directory, { recursive: true, force: true });
});

it("c1.timed: intervals, local weekdays, pause, manual runs and deletion target the same chat", async () => {
  for (const args of [
    ["--every", "59s"],
    ["--every", "1m", "--at", "09:00"],
    ["--at", "24:00"],
    ["--at", "09:00", "--days", "7"],
  ])
    await expect(add("--prompt", "invalid", ...args)).rejects.toThrow();
  const interval = await add("--every", "1m", "--prompt", "C1 interval");
  const daily = await add("--at", "09:00", "--days", "0", "--prompt", "C1 Sunday");
  expect(interval.boundThreadId).toBe(chat.threadId);
  await advance("1m");
  await delivered("C1 interval");
  await delivered("C1 Sunday");
  await cli("schedule", "pause", interval.scheduledTaskId, "--json");
  const manual = await cli("schedule", "run", interval.scheduledTaskId, "--json");
  expect(manual.threadId).toBe(chat.threadId);
  await cli("schedule", "resume", interval.scheduledTaskId, "--json");
  await cli("schedule", "rm", interval.scheduledTaskId, "--json");
  await cli("schedule", "rm", daily.scheduledTaskId, "--json");
  expect(
    (await cli("thread", "list", "--project", directory, "--json")).map(
      (thread: any) => thread.threadId,
    ),
  ).toEqual([chat.threadId]);
}, 240_000);

it("c1.webhooks: URL tokens, raw HMAC, filters, rotation, replay expiry and fixed coalescing survive restart", async () => {
  const secret = NodeCrypto.randomBytes(32).toString("hex");
  const saved = await rpc("scheduledTasks.upsert", {
    title: "C1 signed hook",
    prompt: "C1 hook {{body.value}}",
    enabled: true,
    projectId: chat.projectId,
    threadId: chat.threadId,
    workspaceStrategy: { type: "root" },
    modelSelection: { instanceId: "pi", model: "test/c1-model" },
    runtimeMode: "full-access",
    interactionMode: "default",
    schedule: {
      type: "webhook",
      signature: { header: "x-hub-signature-256", encoding: "hex", prefix: "sha256=", secret },
      filters: [{ path: "body.action", op: "equals", value: "opened" }],
      dedupe: {
        replayKey: "{{headers.delivery-id}}",
        coalesceKey: "{{body.id}}",
        coalesceWindowSeconds: 10,
      },
    },
  });
  let task = saved.task;
  expect(task.webhook.url).toBe(`https://hooks.example.invalid/base${task.webhook.path}`);
  expect(JSON.stringify(task)).not.toContain(secret);
  const post = async (
    id: string,
    value: number,
    action = "opened",
    valid = true,
    path = task.webhook.path,
  ) => {
    const body = `{ "id": "one", "action": "${action}", "value": ${value} }`;
    const response = await fetch(`${origin}${path}`, {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        "delivery-id": id,
        "x-hub-signature-256": `sha256=${NodeCrypto.createHmac("sha256", secret)
          .update(valid ? body : body.trim() + " ")
          .digest("hex")}`,
      },
    });
    return { status: response.status, outcome: response.headers.get("x-ozi-hook-outcome") };
  };
  expect((await post("bad", 0, "opened", false)).status).toBe(401);
  expect((await post("filtered", 0, "closed")).outcome).toBe("filtered");
  expect((await post("a", 1)).outcome).toBe("accepted");
  expect((await post("a", 9)).outcome).toBe("duplicate");
  await advance("6s");
  expect((await post("b", 2)).outcome).toBe("coalesced");
  await advance("4s");
  await delivered("C1 hook 2");
  expect((await messages()).some((message) => message.text === "C1 hook 1")).toBe(false);
  const deliveries = await rpc("scheduledTasks.listWebhookDeliveries", {
    id: task.id,
    acceptAnyOutcome: true,
  });
  expect(deliveries.deliveries.map((item: any) => item.outcome)).toEqual(
    expect.arrayContaining([
      "accepted",
      "coalesced",
      "duplicate",
      "filtered",
      "rejected_signature",
    ]),
  );
  const previous = task.webhook.path;
  task = (await rpc("scheduledTasks.rotateWebhookToken", { id: task.id })).task;
  expect((await post("old", 3, "opened", true, previous)).status).toBe(404);
  await stop();
  await start();
  expect(
    (await cli("schedules", "--json")).tasks.find((entry: any) => entry.scheduledTaskId === task.id)
      .webhookUrl,
  ).toBe(`https://environment.example.invalid${task.webhook.path}`);
  expect((await post("a", 3)).outcome).toBe("duplicate");
  await advance("8d");
  expect((await post("a", 3)).outcome).toBe("accepted");
  await advance("10s");
  await delivered("C1 hook 3");
  await cli("schedule", "rm", task.id, "--json");
}, 240_000);

it("c1.public-url: unsigned CLI webhooks omit the public URL without configuration", async () => {
  await stop();
  await start(null);
  const task = await add(
    "--webhook",
    "--prompt",
    "C1 unsigned {{body.value}}",
    "--filter",
    JSON.stringify({ path: "body.action", op: "equals", value: "opened" }),
  );
  expect(task.webhookUrl).toBeUndefined();
  expect(task.webhookSignature).toBe("none");
  const { tasks } = await rpc("scheduledTasks.list", {});
  const saved = tasks.find((entry: any) => entry.id === task.scheduledTaskId);
  expect(
    (
      await fetch(`${origin}${saved.webhook.path}`, {
        method: "POST",
        body: JSON.stringify({ action: "opened", value: "delivered" }),
        headers: { "content-type": "application/json" },
      })
    ).status,
  ).toBe(202);
  await delivered("C1 unsigned delivered");
  await cli("schedule", "rm", task.scheduledTaskId, "--json");
}, 120_000);
