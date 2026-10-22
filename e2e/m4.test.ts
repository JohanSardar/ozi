import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeURL from "node:url";
import type {
  OziCheck,
  OziJobCard,
  OziTodoSettings,
  OziTodos,
  ScheduledTask,
} from "@t3tools/contracts";
import { afterEach, beforeEach, expect, it } from "vite-plus/test";
import { startHarness, type Harness, type Rule } from "./harness.ts";

type Card = typeof OziJobCard.Encoded;
type Task = typeof ScheduledTask.Encoded & { webhookUrl?: string };
let h: Harness;
beforeEach(async () => {
  h = await startHarness({ testClock: "2026-01-05T08:59:00Z" });
});
afterEach(async () => {
  await h?.close();
});
const delegate = (task: string): Rule["steps"][number] => ({
  tool: {
    name: "delegate_task",
    arguments: { task, title: task, mode: "async", clientRequestId: task },
  },
});
const scripts = (rules: Rule[]) =>
  h.script([
    ...rules,
    {
      match: ".*",
      role: "checker",
      steps: [{ say: JSON.stringify({ verdict: "done", useful: false }) }],
      repeat: true,
    },
    { match: ".*", role: "main", steps: [{ say: "Received routine result" }], repeat: true },
  ]);
const add = (...args: string[]) => h.ozi<Task>("schedule", "add", ...args);
const schedules = () => h.ozi<Task[]>("schedules");
const advance = (value: string) => h.ozi("test-clock", "--advance", value);

it("m4.interval queues main and persists quiet jobs without routine cards", async () => {
  await scripts([
    {
      match: "^interval-wake$",
      role: "main",
      steps: [delegate("routine-worker"), { say: "Interval delegated" }],
    },
    { match: "^routine-worker$", role: "worker", steps: [{ say: "Nothing useful found" }] },
  ]);
  const task = await add("--every", "1m", "--prompt", "interval-wake");
  expect(task.threadId).toBe("ozi-main");
  expect(task.nextRunAt).toBe("2026-01-05T09:00:00.000Z");
  await advance("59s");
  expect((await schedules())[0]?.runCount).toBe(0);
  await advance("1s");
  await h.wait("ozi-main", "text:Interval delegated");
  const worker = (await h.status()).snapshot.threads.find((thread) => thread.jobId === thread.id)!;
  expect(worker).toBeTruthy();
  await h.wait(worker.id, "text:Nothing useful found");
  const completed = await h.wait(worker.id, "completed");
  await h.ozi(
    "wait",
    "check",
    completed.runs.at(-1)!.completionCheck!.id,
    "checked",
    "--timeout",
    "40",
  );
  expect((await h.thread(worker.id)).thread.visibility).toBe("quiet");
  expect(await h.ozi("jobs")).toEqual([]);
  await h.restart();
  expect((await h.thread(worker.id)).thread.visibility).toBe("quiet");
  expect(await h.ozi("jobs")).toEqual([]);
  await h.ozi("schedule", "run", task.id);
  expect((await schedules())[0]?.runCount).toBe(2);
  await h.ozi("schedule", "rm", task.id);
  expect(await schedules()).toEqual([]);
  await expect(add("--every", "10s", "--prompt", "too-fast")).rejects.toThrow();
  await expect(add("--every", "1m", "--at", "09:00", "--prompt", "ambiguous")).rejects.toThrow();
});

it("m4.time-of-day fires only at the selected local time and weekday", async () => {
  await scripts([{ match: "^morning-wake$", role: "main", steps: [{ say: "Morning woke main" }] }]);
  const task = await add("--at", "09:00", "--days", "1,3,5", "--prompt", "morning-wake");
  expect(task.nextRunAt).toBe("2026-01-05T09:00:00.000Z");
  await advance("59s");
  expect((await schedules())[0]?.runCount).toBe(0);
  await advance("1s");
  await h.wait("ozi-main", "text:Morning woke main");
  expect((await schedules())[0]).toMatchObject({
    runCount: 1,
    nextRunAt: "2026-01-07T09:00:00.000Z",
  });
  await advance("1d");
  expect((await schedules())[0]?.runCount).toBe(1);
  await advance("1d");
  await h.wait("ozi-main", "idle");
  expect((await schedules())[0]?.runCount).toBe(2);
  await expect(add("--at", "25:00", "--prompt", "invalid-time")).rejects.toThrow();
  await expect(add("--at", "09:00", "--days", "7", "--prompt", "invalid-days")).rejects.toThrow();
});

it("m4.useful-card reveals only checked useful findings and binds scheduled requests", async () => {
  await scripts([
    {
      match: "^finding-wake$",
      role: "main",
      steps: [delegate("finding-worker"), { say: "Finding delegated" }],
    },
    { match: "^finding-worker$", role: "worker", steps: [{ say: "Useful finding" }] },
    {
      match: "Claim: Useful finding$",
      role: "checker",
      steps: [{ say: "Finding check pending" }, { wait: true }],
    },
    {
      match: "release finding",
      role: "checker",
      steps: [{ say: JSON.stringify({ verdict: "done", useful: true }) }],
    },
  ]);
  const task = await add("--every", "1m", "--prompt", "finding-wake");
  await h.ozi("schedule", "run", task.id);
  await h.wait("ozi-main", "text:Finding delegated");
  const worker = (await h.status()).snapshot.threads.find(
    (thread) => thread.title === "finding-worker",
  )!;
  const completed = await h.wait(worker.id, "completed");
  const checkId = completed.runs.at(-1)!.completionCheck!.id;
  const checkerId = `${checkId}:round:1`;
  await h.wait(checkerId, "text:Finding check pending");
  expect(await h.ozi("jobs")).toEqual([]);
  await h.ozi("steer", "release finding", "--thread", checkerId);
  const card = await h.ozi<Card>("wait", "job", worker.id, "ready", "--timeout", "40");
  expect(card.report).toMatchObject({ text: "Useful finding", useful: true });
  const source = (await h.thread("ozi-main")).messages.find(
    (message) => message.scheduledTaskId === task.id,
  )!;
  const checked = (await h.ozi<OziCheck[]>("checks", "ozi-main")).find(
    (check) => check.runId === source.runId,
  )!;
  expect(checked.requestEventId).toBe(card.requestEventId);
  await h.ozi("wait", "check", checked.id, "checked", "--timeout", "40");
  await h.restart();
  expect(await h.ozi<{ card: Card }>("job", worker.id)).toMatchObject({
    card: { column: "ready", report: { useful: true, text: "Useful finding" } },
  });
});

it("m4.webhook verifies raw bytes, suppresses replays, filters and coalesces real POSTs", async () => {
  await scripts([
    {
      match: "^prepare-signing$",
      role: "main",
      steps: [delegate("signing-worker"), { say: "Signing job started" }],
    },
    {
      match: "^signing-worker$",
      role: "worker",
      steps: [
        {
          tool: {
            name: "request_secret",
            arguments: { label: "Webhook signing key", reason: "Verify fixture deliveries" },
          },
        },
        { say: "signing-ref:$result.secretRef" },
      ],
    },
    {
      match: "^hook-message:.*second",
      role: "main",
      steps: [delegate("hook-worker"), { say: "Webhook delegated" }],
    },
    {
      match: "^hook-worker$",
      role: "worker",
      steps: [{ ask: "Choose a response" }, { say: "Response received" }],
    },
  ]);
  await h.ozi("say", "prepare-signing");
  await h.wait("ozi-main", "text:Signing job started");
  const setup = (await h.ozi<Card[]>("jobs"))[0]!;
  const requested = await h.ozi<Card>("wait", "job", setup.jobId, "needs_you", "--timeout", "20");
  const secret = NodeCrypto.randomBytes(32).toString("hex");
  await h.ozi("answer", requested.requests[0]!.id, secret);
  const lead = await h.wait(setup.jobId, "text:signing-ref:");
  const ref = lead.messages
    .find((message) => message.role === "assistant" && message.text.startsWith("signing-ref:"))!
    .text.slice("signing-ref:".length);
  const task = await add(
    "--webhook",
    "--secret-ref",
    ref,
    "--filter",
    JSON.stringify({ path: "body.action", op: "equals", value: "changed" }),
    "--replay-key",
    "{{body.delivery}}",
    "--coalesce-key",
    "{{body.subject}}",
    "--coalesce-window",
    "10s",
    "--prompt",
    "hook-message:{{body.text}}",
  );
  const endpoint = `http://127.0.0.1:${h.port}${task.webhook!.path}`;
  const http = (await h.page()).request;
  const post = async (
    body: string,
    signature = NodeCrypto.createHmac("sha256", secret).update(body).digest("hex"),
    url = endpoint,
  ) => {
    const response = await http.post(url, {
      headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${signature}` },
      data: body,
    });
    const result = { status: response.status(), headers: response.headers() };
    await response.dispose();
    return result;
  };

  const body = '{ "action": "changed", "delivery": "one", "subject": "same", "text": "first" }';
  expect((await post(body, "wrong")).status).toBe(401);
  expect(
    (await post(body, undefined, `${endpoint.slice(0, endpoint.lastIndexOf("/"))}/wrong`)).status,
  ).toBe(404);
  const filtered = await post(JSON.stringify({ action: "ignored", delivery: "ignored" }));
  expect(filtered.headers["x-ozi-hook-outcome"]).toBe("filtered");
  expect((await post(body)).status).toBe(202);
  expect((await post(body)).headers["x-ozi-hook-outcome"]).toBe("duplicate");
  const coalesced = await post(
    JSON.stringify({ action: "changed", delivery: "two", subject: "same", text: "second" }),
  );
  expect(coalesced.headers["x-ozi-hook-outcome"]).toBe("coalesced");
  expect((await schedules()).find((item) => item.id === task.id)?.runCount).toBe(0);
  await advance("10s");
  await h.wait("ozi-main", "text:Webhook delegated");
  const worker = (await h.status()).snapshot.threads.find(
    (thread) => thread.title === "hook-worker",
  )!;
  const card = await h.ozi<Card>("wait", "job", worker.id, "needs_you", "--timeout", "20");
  expect((await h.thread(worker.id)).thread.visibility).toBe("quiet");
  expect(card.requests[0]?.prompt).toBe("Choose a response");
  expect((await schedules()).find((item) => item.id === task.id)?.runCount).toBe(1);
  await h.restart();
  expect((await post(body)).headers["x-ozi-hook-outcome"]).toBe("duplicate");
  expect(JSON.stringify(await schedules())).not.toContain(secret);
  expect(JSON.stringify(await h.ozi("jobs"))).not.toContain(secret);
});

it("m4.base-url reports only configured self-hosted webhook URLs with flag precedence", async () => {
  const missing = await add("--webhook", "--prompt", "base-url-missing");
  expect(missing.webhookUrl).toBeUndefined();
  await h.close();
  h = await startHarness({ publicUrlEnv: "https://hooks.example.invalid/ozi/" });
  const envTask = await add("--webhook", "--prompt", "base-url-env");
  expect(envTask.webhookUrl).toBe(`https://hooks.example.invalid/ozi${envTask.webhook!.path}`);
  expect((await schedules())[0]?.webhookUrl).toBe(envTask.webhookUrl);
  await h.close();
  h = await startHarness({
    publicUrl: "https://public.example.invalid/",
    publicUrlEnv: "https://ignored.example.invalid/",
  });
  const flagTask = await add("--webhook", "--prompt", "base-url-flag");
  expect(flagTask.webhookUrl).toBe(`https://public.example.invalid${flagTask.webhook!.path}`);
  await h.restart();
  expect((await schedules())[0]?.webhookUrl).toBe(flagTask.webhookUrl);
});

it("m4.todos maps MCP data, retains stale rows, hides unconfigured sources and renders the panel", async () => {
  expect(await h.ozi("todos")).toBeNull();
  const page = await h.page();
  await page.getByRole("textbox", { name: "Message Ozi", exact: true }).waitFor();
  expect(await page.getByRole("region", { name: "Your to-dos", exact: true }).count()).toBe(0);
  const fixture = NodeURL.fileURLToPath(new URL("./fixtures/todos.mjs", import.meta.url));
  const state = `${h.root}/todos.json`;
  const item = {
    key: "reminder-1",
    name: "Pick up package",
    url: "https://example.invalid/reminders/1",
    state: "open",
    when: { label: "5 pm" },
  };
  await NodeFSP.writeFile(state, JSON.stringify({ mode: "text", items: [item] }));
  const settings: OziTodoSettings = {
    source: "Apple Reminders",
    server: {
      type: "stdio",
      command: process.execPath,
      args: [fixture, state],
      env: { FIXTURE_KEY: "private-stdio-value" },
    },
    tool: "list_reminders",
    arguments: { list: "inbox" },
    itemsPath: "reminders",
    fields: { id: "key", title: "name", link: "url", status: "state", due: "when.label" },
  };
  const available = await h.ozi<OziTodos>("todos", "--configure", JSON.stringify(settings));
  expect(available).toMatchObject({
    source: "Apple Reminders",
    state: "available",
    items: [{ id: "reminder-1", title: "Pick up package", due: "5 pm" }],
  });
  const settingsResponses: string[] = [];
  page.on("websocket", (socket) =>
    socket.on("framereceived", ({ payload }) => settingsResponses.push(String(payload))),
  );
  await page.reload();
  const panel = page.getByRole("region", { name: "Your to-dos", exact: true });
  await panel.getByText("· Apple Reminders", { exact: true }).waitFor();
  await panel.getByRole("link", { name: "Pick up package" }).waitFor();
  expect(settingsResponses.join("")).toContain("externalTodos");
  const callsBeforeAdvance = await NodeFSP.readFile(`${state}.calls`, "utf8");
  await advance("1h");
  expect(await NodeFSP.readFile(`${state}.calls`, "utf8")).toBe(callsBeforeAdvance);
  expect((await h.status()).main?.runs).toEqual([]);
  expect(await panel.getByText("5 pm", { exact: true }).count()).toBe(1);
  expect(
    await panel
      .locator('[data-todo-id="reminder-1"]')
      .evaluate((element) => getComputedStyle(element).borderTopStyle),
  ).toBe("dashed");
  await page.goto(`${new globalThis.URL(page.url()).origin}/settings/appearance`);
  await page.getByText("Appearance", { exact: true }).first().waitFor();
  expect(settingsResponses.join("")).not.toContain("private-stdio-value");
  await page.goto(`${new globalThis.URL(page.url()).origin}/`);
  await panel.getByRole("link", { name: "Pick up package" }).waitFor();
  const latest = await h.ozi<OziTodos>("todos");
  await NodeFSP.writeFile(state, JSON.stringify({ mode: "malformed", items: [] }));
  await advance("1m");
  const stale = await h.ozi<OziTodos>("todos");
  expect(stale).toMatchObject({
    state: "stale",
    items: available!.items,
    fetchedAt: latest!.fetchedAt,
  });
  await panel.getByRole("button", { name: "Refresh", exact: true }).click();
  await panel.getByText("Unavailable · showing saved to-dos", { exact: true }).waitFor();
  expect(await panel.getByText("No to-dos", { exact: true }).count()).toBe(0);
  await NodeFSP.writeFile(state, JSON.stringify({ mode: "offline", items: [] }));
  expect(await h.ozi<OziTodos>("todos")).toMatchObject({
    state: "stale",
    fetchedAt: latest!.fetchedAt,
  });
  const mcpProcess = NodeChildProcess.fork(fixture, [state, "--http"], {
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  try {
    const port = await new Promise<number>((resolve, reject) => {
      mcpProcess.once("message", (message) => resolve((message as { port: number }).port));
      mcpProcess.once("error", reject);
      mcpProcess.once("exit", () => reject(new Error("MCP fixture exited before readiness")));
    });
    const httpSettings = {
      ...settings,
      server: {
        type: "http",
        url: `http://127.0.0.1:${port}/mcp`,
        headers: { Authorization: "Bearer private-http-value" },
      },
    };
    expect(
      await h.ozi<OziTodos>("todos", "--configure", JSON.stringify(httpSettings)),
    ).toMatchObject({ state: "unavailable", items: null, fetchedAt: null });
    await NodeFSP.writeFile(state, JSON.stringify({ mode: "malformed", items: [] }));
    expect(await h.ozi<OziTodos>("todos")).toMatchObject({ state: "unavailable", items: null });
    await NodeFSP.writeFile(state, JSON.stringify({ mode: "ok", items: [item] }));
    expect(await h.ozi<OziTodos>("todos")).toMatchObject({
      state: "available",
      items: [{ title: "Pick up package" }],
    });
    await page.reload();
    await panel.getByRole("link", { name: "Pick up package" }).waitFor();
    await NodeFSP.mkdir("/tmp/ozi-shots", { recursive: true });
    await page.screenshot({ path: "/tmp/ozi-shots/m4-todos.png" });
    expect(settingsResponses.join("")).not.toContain("private-http-value");
    await h.ozi("todos", "--clear");
    await panel.getByRole("button", { name: "Refresh", exact: true }).click();
    await panel.waitFor({ state: "hidden" });
    expect(await h.ozi("todos")).toBeNull();
  } finally {
    if (mcpProcess.exitCode === null && mcpProcess.signalCode === null) {
      const exited = new Promise<void>((resolve) => mcpProcess.once("exit", () => resolve()));
      mcpProcess.kill("SIGTERM");
      await exited;
    }
  }
});

it("m4.removed rejects retired APIs and commands and removes their repository slices", async () => {
  const removed = [
    "projects.list",
    "projects.add",
    "projects.remove",
    "projects.listEntries",
    "projects.listIgnoredFiles",
    "projects.readFile",
    "projects.searchContents",
    "projects.searchEntries",
    "projects.writeFile",
    "projects.mutate",
    "projects.ensureScratch",
    "projects.createNew",
    "filesystem.browse",
    "filesystem.getMetadata",
    "agentSessions.scan",
    "agentSessions.import",
    "vcs.pull",
    "vcs.refreshStatus",
    "vcs.listRefs",
    "vcs.createWorktree",
    "vcs.removeWorktree",
    "vcs.createRef",
    "vcs.switchRef",
    "vcs.init",
    "git.runStackedAction",
    "git.resolvePullRequest",
    "git.preparePullRequestThread",
    "review.getDiffPreview",
    "review.getDiffFileContents",
    "terminal.open",
    "terminal.attach",
    "terminal.observe",
    "terminal.write",
    "terminal.resize",
    "terminal.clear",
    "terminal.restart",
    "terminal.close",
    "device.configure",
    "device.list",
    "device.testHost",
    "device.easAccount",
    "device.open",
    "device.close",
    "device.shutdown",
    "device.detail",
    "device.action",
    "server.updateServer",
    "server.updateServerWithProgress",
    "server.commitDesktopUpdate",
    "server.runStorageCleanup",
    "server.getStorageCleanupReport",
    "server.discoverSourceControl",
    "server.getProcessDiagnostics",
    "server.getHostResources",
    "server.getProcessResourceHistory",
    "server.getResourceTelemetryHistory",
    "server.retryResourceTelemetry",
    "server.signalProcess",
    "server.reportClientActivity",
    "server.reportHostPowerState",
    "server.getBackgroundPolicy",
    "cloud.getRelayClientStatus",
    "cloud.installRelayClient",
    "pullRequests.list",
    "pullRequests.listStats",
    "pullRequests.summary",
    "pullRequests.routing",
    "pullRequests.routingIdentity",
    "pullRequests.stack",
    "pullRequests.linkedThreads",
    "pullRequests.detail",
    "pullRequests.preview",
    "pullRequests.checks",
    "pullRequests.activity",
    "pullRequests.reviewGuide",
    "pullRequests.generateReviewGuide",
    "pullRequests.threadComments",
    "pullRequests.diffFileContents",
    "pullRequests.filesViewed",
    "pullRequests.changeBreakdown",
    "pullRequests.setFilesViewed",
    "pullRequests.runAction",
    "pullRequests.update",
    "pullRequests.comment",
    "pullRequests.updateComment",
    "pullRequests.submitReview",
    "pullRequests.replyToThread",
    "pullRequests.setThreadResolution",
    "pullRequests.setReaction",
    "pullRequests.invalidate",
    "pullRequests.reportState",
    "pullRequests.subscribeRefreshes",
    "pullRequests.reviewerCandidates",
    "pullRequests.requestReviewers",
    "pullRequests.labelCandidates",
    "pullRequests.setLabels",
    "sourceControl.lookupRepository",
    "sourceControl.cloneRepository",
    "sourceControl.publishRepository",
    "projectClone.start",
    "projectClone.cancel",
    "projectClone.retry",
    "subscribeProjectClones",
    "subscribeVcsStatus",
    "subscribeWorktreeSetup",
    "worktreeSetup.cancel",
    "subscribeTerminalEvents",
    "subscribeTerminalMetadata",
    "subscribeDeviceState",
    "subscribeBackgroundPolicy",
    "subscribeResourceTelemetry",
  ];
  const rpcs = await h.ozi<
    Array<{
      target: string;
      ok: boolean;
      result?: { environment: { capabilities: Record<string, unknown> } };
      error?: string;
    }>
  >("request", "server.getConfig", ...removed);
  expect(rpcs[0]?.ok).toBe(true);
  expect(rpcs).toHaveLength(removed.length + 1);
  for (const row of rpcs.slice(1)) {
    expect(row.ok, row.target).toBe(false);
    expect(row.error, row.target).toContain("Unknown request tag: " + row.target);
  }
  for (const name of [
    "repositoryIdentity",
    "requiredWorktreeBootstrap",
    "storageCleanup",
    "storageCleanupRun",
    "projectWorktreeCleanup",
    "settledWorktreeCleanup",
    "threadSettlement",
    "threadPullRequests",
    "threadPullRequestWatch",
    "threadPullRequestLinking",
    "projectCloneTracking",
    "ignoredFileListing",
  ])
    expect(rpcs[0]?.result?.environment.capabilities).not.toHaveProperty(name);
  const routes = [
    "/api/connect/link-proof",
    "/api/connect/relay-config",
    "/api/connect/reachability",
    "/api/connect/unlink",
    "/api/connect/preferences",
    "/api/connect/mint-credential",
    "/api/t3-connect/health",
    "/api/t3-connect/mint-credential",
  ];
  const responses = await h.ozi<Array<{ target: string; status: number }>>(
    "request",
    "--method",
    "POST",
    ...routes,
  );
  for (const row of responses) expect(row.status, row.target).toBe(404);
  const reads = await h.ozi<Array<{ target: string; status: number }>>(
    "request",
    "/.well-known/t3/environment",
    "/api/connect/link-state",
  );
  expect(reads.map((row) => row.status)).toEqual([200, 404]);
  for (const command of [
    "connect",
    "cloud",
    "relay",
    "device",
    "terminal",
    "git",
    "vcs",
    "review",
    "diff",
    "pull-request",
    "project",
    "update",
    "__service-launcher",
    "__service-preflight",
  ])
    await expect(h.ozi(command)).rejects.toThrow(/Unknown subcommand/);
  const root = NodeURL.fileURLToPath(new URL("..", import.meta.url));
  for (const path of [
    "infra",
    "native/resource-monitor",
    "apps/server/src/cloud",
    "apps/server/src/relay",
    "apps/server/src/device",
    "apps/server/src/terminal",
    "apps/server/src/sourceControl",
    "apps/server/src/vcs",
    "apps/server/src/git",
    "apps/server/src/pullRequests",
    "apps/web/src/cloud",
    "apps/web/src/onboarding",
    "apps/web/src/components/terminal",
    "apps/web/src/components/vcs",
    "apps/web/src/routes/connect.tsx",
    "packages/contracts/src/relay.ts",
    "packages/client-runtime/src/relay",
    "packages/shared/src/relayJwt.ts",
    "packages/source-control-azure-devops",
    "packages/source-control-bitbucket",
    "packages/source-control-core",
    "packages/source-control-forgejo",
    "packages/source-control-gitcafe",
    "packages/source-control-github",
    "packages/source-control-gitlab",
    "packages/source-control-testing",
  ])
    await expect(NodeFSP.stat(root + "/" + path), path).rejects.toMatchObject({ code: "ENOENT" });
  const workspace = await NodeFSP.readFile(root + "/pnpm-workspace.yaml", "utf8");
  const lock = await NodeFSP.readFile(root + "/pnpm-lock.yaml", "utf8");
  expect(workspace + lock).not.toMatch(
    /source-control-|t3code-relay|node-pty|electron-updater|@clerk\/|alchemy|resource-monitor/,
  );
  const build = await NodeFSP.readFile(root + "/scripts/build-desktop-artifact.ts", "utf8");
  const mac = build.slice(
    build.indexOf("export const preflightMacDesktopBuild"),
    build.indexOf("export const preflightMacDesktopBuild") + 1800,
  );
  expect(mac).toContain("clang");
  expect(mac).not.toMatch(/cargo|rustc|rustTargets|resourceMonitor/);
  expect(build).not.toMatch(/stageResourceMonitor|resource-monitor/);
  expect(build).toContain('const DESKTOP_APP_ID = "app.ozi.desktop"');
  const desktop = JSON.parse(await NodeFSP.readFile(root + "/apps/desktop/package.json", "utf8"));
  expect(desktop.productName).toBe("Ozi");
});
