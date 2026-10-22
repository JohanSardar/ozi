import * as NodeFSP from "node:fs/promises";
import * as NodeCrypto from "node:crypto";
import * as NodePath from "node:path";
import { afterEach, beforeEach, expect, it } from "vite-plus/test";
import { startHarness, type Harness, type Projection, type Rule } from "./harness.ts";

let h: Harness;
beforeEach(async ({ task }) => {
  h = await startHarness({ fresh: task.name.startsWith("m1.fresh-install") });
});
afterEach(async () => {
  await h?.close();
});
const main = async () => {
  const value = (await h.status()).main;
  expect(value, "fresh server must bootstrap the main thread").not.toBeNull();
  return value!;
};
const content = (projection: Projection) =>
  projection.messages.map((message) => message.text).join("\n");
const say = async (text: string) => {
  await h.ozi("say", text);
  return (await h.status()).main!.thread.id;
};
const bootstrap = async () => {
  await h.script([{ match: "cli-bootstrap", steps: [{ say: "ready" }] }]);
  const id = await say("cli-bootstrap");
  await h.wait(id, "completed");
  return id;
};
const delegate = (task: string, provider?: string): Rule["steps"][number] => ({
  tool: {
    name: "delegate_task",
    arguments: {
      task,
      mode: "async",
      ...(provider
        ? {
            target: {
              providerInstanceId: provider,
              model:
                provider === "codex"
                  ? "gpt-6.1-sol"
                  : provider === "claudeAgent"
                    ? "claude-opus-5-5"
                    : "claude-bridge/claude-opus-5-5",
            },
          }
        : {}),
    },
  },
});

it("m1.fresh-install starts isolated state and only the three supported providers", async () => {
  const status = await h.status();
  expect(status.main?.thread).toMatchObject({ role: "main", effectiveLoadout: { provider: "pi" } });
  expect(status.snapshot.threads.filter((thread) => thread.role === "main")).toHaveLength(1);
  expect(status.server.providers.map((provider) => provider.driver).sort()).toEqual([
    "claudeAgent",
    "codex",
    "pi",
  ]);
  expect(
    (await NodeFSP.stat(NodePath.join(h.home, "userdata/statev2.sqlite"))).size,
  ).toBeGreaterThan(0);
});

it("m1.main-loadout preserves the Pi loadout, prompt and tools after resume and fork", async () => {
  const initial = await main();
  expect(initial.thread.modelSelection).toMatchObject({
    instanceId: "pi",
    model: "claude-bridge/claude-opus-5-5",
  });
  expect(initial.thread.modelSelection.options).toEqual([
    { id: "thinking", value: "high" },
    { id: "fastMode", value: false },
  ]);
  const prompt = (
    await NodeFSP.readFile(NodePath.join(h.dataRoot, "prompt.md"), "utf8")
  ).replaceAll("{{ADHD}}", "");
  expect(initial.thread.effectiveLoadout).toMatchObject({
    provider: "pi",
    model: "claude-bridge/claude-opus-5-5",
    options: initial.thread.modelSelection.options,
    systemPromptSha256: NodeCrypto.createHash("sha256").update(prompt).digest("hex"),
  });
  const assertLoadout = async () => {
    const records = await h.records();
    const source = records.findLast(
      (record) => record.provider === "pi" && record.event === "prompt" && record.role === "main",
    )!;
    expect(source).toBeTruthy();
    const loadout = records.findLast(
      (record) => record.event === "loadout" && record.pid === source.pid,
    )!;
    expect(loadout.instructions).toBe(prompt);
    expect(loadout.tools?.map((tool) => tool.name)).toContain("read_skill");
    expect(
      loadout.tools?.filter((tool) =>
        /shell|file|browser|preview|device|computer|terminal|project|git|pull_request/.test(
          tool.name,
        ),
      ),
    ).toEqual([]);
  };
  await h.script([
    { match: "loadout-before", steps: [{ say: "loadout-before-ok" }] },
    { match: "loadout-resume", steps: [{ say: "loadout-resume-ok" }] },
    { match: "loadout-child", steps: [{ say: "loadout-child-ok" }] },
  ]);
  await say("loadout-before");
  await h.wait(initial.thread.id, "completed");
  await assertLoadout();
  await h.restart();
  await say("loadout-resume");
  await h.wait(initial.thread.id, "completed");
  await assertLoadout();
  const fork = await h.ozi<Projection>(
    "thread",
    initial.thread.id,
    "--fork",
    "--message",
    "loadout-child",
  );
  const forked = await h.wait(fork.thread.id, "completed");
  expect(forked.thread.role).toBe("main-fork");
  expect(forked.thread.modelSelection).toEqual(initial.thread.modelSelection);
  expect(forked.thread.effectiveLoadout).toEqual(initial.thread.effectiveLoadout);
  expect((await h.status()).main?.thread.id).toBe(initial.thread.id);
  await assertLoadout();
  expect((await h.records()).some((record) => record.argv?.includes("--fork"))).toBe(true);
  await expect(
    h.ozi("thread", initial.thread.id, "--provider", "codex", "--model", "gpt-6.1-sol"),
  ).rejects.toThrow();
  await expect(
    h.ozi("thread", fork.thread.id, "--provider", "codex", "--model", "gpt-6.1-sol"),
  ).rejects.toThrow();
});

it("m1.main-cannot-execute rejects execution tools on main", async () => {
  const initial = await main();
  expect(initial.thread.modelSelection.model).toBe("claude-bridge/claude-opus-5-5");
  await h.script([
    {
      match: "forbidden-execution",
      steps: [
        { tool: { name: "bash", arguments: { command: "echo forbidden" } } },
        { say: "execution rejected" },
      ],
    },
  ]);
  await say("forbidden-execution");
  await h.wait(initial.thread.id, "completed");
  const call = (await h.records()).find(
    (record) => record.event === "tool" && record.name === "bash",
  );
  expect(call?.result?.isError).toBe(true);
  const launch = (await h.records()).find(
    (record) =>
      record.provider === "pi" &&
      record.event === "launch" &&
      record.argv?.includes("--system-prompt"),
  );
  expect(launch?.argv).toEqual(
    expect.arrayContaining([
      "--no-builtin-tools",
      "--no-mcp",
      "--no-extensions",
      "--no-skills",
      "--no-context-files",
      "--no-prompt-templates",
      "--system-prompt",
      "claude-bridge",
    ]),
  );
  expect(launch?.argv?.filter((argument) => argument === "--extension")).toHaveLength(2);
  expect(launch?.argv).not.toContain("--no-tools");
});

it("m1.delegate-async starts the default worker and returns its result to main", async () => {
  const initial = await main();
  await h.script([
    {
      match: "delegate-default",
      provider: "pi",
      steps: [delegate("worker-default"), { say: "worker started" }],
    },
    { match: "worker-default", provider: "codex", steps: [{ say: "worker-default-result" }] },
    {
      match: "worker-default-result",
      provider: "pi",
      steps: [{ say: "reported worker-default-result" }],
    },
  ]);
  await say("delegate-default");
  await h.ozi(
    "wait",
    "thread",
    initial.thread.id,
    "text:reported worker-default-result",
    "--timeout",
    "20",
  );
  const workers = (await h.status()).snapshot.threads.filter(
    (thread) => thread.id !== initial.thread.id,
  );
  expect(workers).toHaveLength(1);
  expect(workers[0]!.role).toBe("worker");
  expect(workers[0]!.modelSelection).toMatchObject({
    instanceId: "codex",
    model: "gpt-6.1-sol",
    options: expect.arrayContaining([
      { id: "reasoningEffort", value: "xhigh" },
      { id: "serviceTier", value: "priority" },
    ]),
  });
  expect(content(await h.thread(initial.thread.id))).toContain("worker started");
  const projection = await h.wait(initial.thread.id, "completed");
  expect(projection.runs.filter((run) => run.status === "completed").length).toBeGreaterThanOrEqual(
    2,
  );
  expect((await h.status()).main?.thread.id).toBe(initial.thread.id);
});

it("m1.responsive answers another message while a worker stays active", async () => {
  const initial = await main();
  await h.script([
    {
      match: "responsive-delegate",
      provider: "pi",
      steps: [delegate("responsive-worker"), { say: "started responsive worker" }],
    },
    { match: "responsive-worker", provider: "codex", steps: [{ wait: true }] },
    { match: "responsive-question", provider: "pi", steps: [{ say: "responsive-answer" }] },
  ]);
  await say("responsive-delegate");
  await h.wait(initial.thread.id, "completed");
  await say("responsive-question");
  await h.wait(initial.thread.id, "completed");
  expect(content(await h.thread(initial.thread.id))).toContain("responsive-answer");
  const worker = (await h.status()).snapshot.threads.find(
    (thread) => thread.id !== initial.thread.id,
  )!;
  await h.wait(worker.id, "running");
  await h.ozi("stop", "--thread", worker.id);
});

it("m1.worker-choice starts Claude and Pi workers on request", async () => {
  const initial = await main();
  await h.script([
    {
      match: "worker-catalog",
      role: "main",
      steps: [{ tool: { name: "orchestrator_capabilities" } }, { say: "catalog inspected" }],
    },
    {
      match: "worker-choice",
      provider: "pi",
      steps: [
        delegate("[worker] choice-claude", "claudeAgent"),
        delegate("[worker] choice-pi", "pi"),
        { say: "both workers started" },
      ],
    },
    { match: "choice-claude", provider: "claude", steps: [{ say: "claude-choice-result" }] },
    { match: "choice-pi", provider: "pi", steps: [{ say: "pi-choice-result" }] },
    {
      match: "choice-result",
      provider: "pi",
      steps: [{ say: "worker result received" }],
      repeat: true,
    },
  ]);
  await say("worker-catalog");
  await h.wait(initial.thread.id, "text:catalog inspected");
  const result = (await h.records()).findLast(
    (record) => record.name === "orchestrator_capabilities",
  )?.result;
  const providers = result?.structuredContent?.providers as {
    providerInstanceId: string;
    models: { id: string }[];
  }[];
  expect(
    providers
      .find((provider) => provider.providerInstanceId === "pi")
      ?.models.map((model) => model.id),
  ).toEqual(["claude-bridge/claude-opus-5-5", "claude-bridge/claude-sonnet-5-5"]);
  await say("worker-choice");
  await h.wait(initial.thread.id, "completed");
  const workers = (await h.status()).snapshot.threads.filter(
    (thread) => thread.id !== initial.thread.id,
  );
  expect(workers.map((thread) => thread.providerInstanceId).sort()).toEqual(["claudeAgent", "pi"]);
  for (const worker of workers) await h.wait(worker.id, "completed");
  const records = await h.records();
  const workerPid = records.find(
    (record) => record.event === "prompt" && record.prompt === "[worker] choice-pi",
  )?.pid;
  expect(
    records.find((record) => record.event === "launch" && record.pid === workerPid)?.argv,
  ).toContainEqual(expect.stringContaining("pi-claude-bridge"));
  expect(
    records.find((record) => record.pid === workerPid && record.frame?.type === "set_model")?.frame,
  ).toMatchObject({ provider: "claude-bridge", modelId: "claude-opus-5-5" });
});

it("m1.attachments delivers file content to main and the delegated brief", async () => {
  const initial = await main();
  const file = NodePath.join(h.root, "attachment.txt");
  await NodeFSP.writeFile(file, "ozi-attachment-marker");
  await h.script([
    {
      match: "attachment-request",
      provider: "pi",
      steps: [delegate("attachment-worker $prompt"), { say: "attachment forwarded" }],
    },
    { match: "attachment-worker", provider: "codex", steps: [{ say: "attachment read" }] },
    { match: "attachment read", provider: "pi", steps: [{ say: "attachment reported" }] },
  ]);
  await h.ozi("say", "attachment-request", "--file", file);
  await h.wait(initial.thread.id, "text:attachment reported");
  const records = await h.records();
  expect(
    records.some(
      (record) =>
        record.provider === "pi" &&
        record.prompt?.includes("attachment.txt") &&
        record.prompt.includes("ozi-attachment-marker"),
    ),
  ).toBe(true);
  expect(
    records.some(
      (record) =>
        record.provider === "codex" &&
        record.prompt?.includes("attachment.txt") &&
        record.prompt.includes("ozi-attachment-marker"),
    ),
  ).toBe(true);
  expect(
    (await h.thread(initial.thread.id)).messages.some((message) =>
      message.attachments.some((attachment) => attachment.name === "attachment.txt"),
    ),
  ).toBe(true);
});

it("m1.steer-queue-stop steers, holds queued messages and stops main and worker", async () => {
  const threadId = await bootstrap();
  await h.script([
    { match: "control-hold", steps: [{ say: "holding" }, { wait: true }] },
    { match: "control-steer", steps: [{ say: "steered" }, { wait: true }] },
    { match: "control-queued", steps: [{ fail: "queue ran despite stop" }] },
    {
      match: "control-delegate",
      steps: [delegate("control-worker", "codex"), { say: "worker started" }],
    },
    { match: "control-worker", steps: [{ wait: true }] },
  ]);
  await say("control-hold");
  await h.wait(threadId, "running");
  await h.ozi("steer", "control-steer");
  await h.ozi("wait", "thread", threadId, "text:steered", "--timeout", "15");
  await say("control-queued");
  await h.ozi("stop");
  await h.wait(threadId, "interrupted");
  expect((await h.thread(threadId)).runs.some((run) => run.status === "queued")).toBe(true);
  await say("control-delegate");
  await h.ozi("wait", "thread", threadId, "text:worker started", "--timeout", "15");
  const worker = (await h.status()).snapshot.threads.find((thread) => thread.id !== threadId)!;
  await h.wait(worker.id, "running");
  await h.ozi("stop", "--thread", worker.id);
  await h.wait(worker.id, "interrupted");
  expect((await h.records()).some((record) => record.prompt === "control-queued")).toBe(false);
});

it("m1.read-skill loads a named data-root skill and rejects an unknown name", async () => {
  const initial = await main();
  await h.script([
    {
      match: "read-demo-skill",
      steps: [
        { tool: { name: "read_skill", arguments: { name: "demo" } } },
        { say: "$result" },
        { tool: { name: "read_skill", arguments: { name: "missing" } } },
        { say: "$result" },
      ],
    },
  ]);
  await say("read-demo-skill");
  await h.wait(initial.thread.id, "completed");
  const calls = (await h.records()).filter(
    (record) => record.event === "tool" && record.name === "read_skill",
  );
  expect(calls).toHaveLength(2);
  expect(JSON.stringify(calls[0]!.result)).toContain("ozi-demo-skill-loaded");
  expect(calls[1]!.result?.isError).toBe(true);
});

it("m1.remote-client pairs Chromium over the network address and chats", async () => {
  const threadId = await bootstrap();
  await h.script([{ match: "browser-message", steps: [{ say: "browser-response" }] }]);
  const page = await h.page();
  await page.waitForURL((url) => url.pathname !== "/pair", { timeout: 30_000 });
  const editor = page.getByRole("textbox", { name: "Message Ozi", exact: true });
  await editor.waitFor();
  await editor.fill("browser-message");
  await page.getByRole("button", { name: "Submit message", exact: true }).click();
  await h.ozi("wait", "thread", threadId, "text:browser-response", "--timeout", "20");
  await page.getByText("browser-response", { exact: true }).waitFor();
  expect(new URL(page.url()).hostname).not.toBe("127.0.0.1");
});

it("m1.cli-json returns JSON and exercises each provider, attachments, waits and errors", async () => {
  const threadId = await bootstrap();
  const file = NodePath.join(h.root, "cli-file.txt");
  await NodeFSP.writeFile(file, "cli-file-marker");
  for (const [provider, model] of [
    ["codex", "gpt-6.1-sol"],
    ["claudeAgent", "claude-opus-5-5"],
    ["pi", "claude-bridge/claude-opus-5-5"],
  ]) {
    await h.script([
      {
        match: `^json-${provider}`,
        role: "main",
        steps: [delegate(`json-worker-${provider}`, provider), { say: `json-started-${provider}` }],
      },
      {
        match: `json-worker-${provider}`,
        role: "worker",
        steps: [{ say: `json-result-${provider}` }],
      },
      {
        match: `json-result-${provider}`,
        role: "main",
        steps: [{ say: `json-reported-${provider}` }],
      },
    ]);
    await h.ozi("say", `json-${provider}`, "--file", file);
    await h.wait(threadId, `text:json-reported-${provider}`);
    const projection = await h.wait(threadId, "completed");
    expect(content(projection)).toContain(`json-reported-${provider}`);
    const worker = (await h.status()).snapshot.threads.find(
      (thread) => thread.role === "worker" && thread.providerInstanceId === provider,
    )!;
    expect(
      await h.ozi("thread", worker.id, "--provider", provider!, "--model", model!),
    ).toHaveProperty("runs");
  }
  expect(await h.ozi("pair")).toHaveProperty("url");
  expect(await h.ozi("status")).toHaveProperty("main");
  expect(await h.ozi("thread", threadId)).toHaveProperty("runs");
  expect(await h.ozi("service", "status")).toHaveProperty("supported");
  const invalid = ["schedule", "add", "--every", "1m", "--at", "09:00", "--prompt", "invalid"];
  const message = "Ozi requires exactly one of --every, --at or --webhook.";
  expect(await h.execOutput(...invalid, "--json")).toEqual({
    code: 1,
    stdout: `${JSON.stringify({ error: { code: "OziClientError", message } })}\n`,
    stderr: "",
  });
  expect(await h.execOutput(...invalid)).toEqual({ code: 1, stdout: "", stderr: `${message}\n` });
  await expect(h.wait(threadId, "impossible", 0.1)).rejects.toThrow();
  await h.script([
    { match: "json-hold", steps: [{ wait: true }] },
    { match: "json-steer", steps: [{ wait: true }] },
  ]);
  await say("json-hold");
  await h.wait(threadId, "running");
  expect(await h.ozi("steer", "json-steer")).toHaveProperty("sequence");
  expect(await h.ozi("stop")).toHaveProperty("sequence");
  await h.wait(threadId, "interrupted");
  expect(
    (await h.records())
      .filter((record) => record.event === "prompt")
      .map((record) => record.provider),
  ).toEqual(expect.arrayContaining(["pi", "claude", "codex"]));
  expect(await h.exec("status")).toBe(0);
});

it.each([
  ["codex", "gpt-6.1-sol"],
  ["pi", "claude-bridge/claude-opus-5-5"],
  ["claudeAgent", "claude-opus-5-5"],
])("m1.cli-json native-forks %s without changing the source", async (provider, model) => {
  const mainId = (await main()).thread.id;
  await h.script([
    {
      match: "^native-start$",
      role: "main",
      steps: [delegate("native-seed", provider), { say: "native worker started" }],
    },
    { match: "native-seed", role: "worker", steps: [{ say: "native-seeded" }] },
    { match: "native-seeded", role: "main", steps: [{ say: "native worker ready" }] },
  ]);
  await say("native-start");
  await h.wait(mainId, "text:native worker ready");
  await h.wait(mainId, "completed");
  const sourceId = (await h.status()).snapshot.threads.find(
    (thread) => thread.role === "worker",
  )!.id;
  await h.wait(sourceId, "completed");
  await h.ozi("thread", sourceId, "--provider", provider!, "--model", model!);
  const before = await h.thread(sourceId);
  await h.script([
    {
      match: "native-child",
      steps: [
        {
          tool: {
            name: "t3_thread_send",
            arguments: { threadId: sourceId, message: "native-resume" },
          },
        },
        { say: "native-fork-result" },
      ],
    },
    { match: "native-resume", steps: [{ say: "source still usable" }] },
    { match: "source still usable", role: "main", steps: [{ say: "native source reported" }] },
  ]);
  const fork = await h.ozi<Projection>("thread", sourceId, "--fork", "--message", "native-child");
  await h.ozi("wait", "thread", sourceId, "text:source still usable", "--timeout", "30");
  const child = await h.wait(fork.thread.id, "completed");
  expect(child.thread.role).toBe("worker");
  expect(child.thread.modelSelection).toEqual((await h.thread(sourceId)).thread.modelSelection);
  expect(content(child)).toContain("native-fork-result");
  expect((await h.thread(sourceId)).messages.slice(0, before.messages.length)).toEqual(
    before.messages,
  );
});
