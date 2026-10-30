import * as NodeChildProcess from "node:child_process";
import * as NodeEvents from "node:events";
import * as NodeFSP from "node:fs/promises";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodeNet from "node:net";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import type { Ticket } from "../packages/contracts/src/ticket.ts";

const exec = NodeUtil.promisify(NodeChildProcess.execFile);
const root = NodePath.resolve(import.meta.dirname, "..");
const bin = NodePath.join(root, "apps/server/src/bin.ts");

describe("p2.codex-inbox", () => {
  let directory: string;
  let home: string;
  let workspace: string;
  let env: NodeJS.ProcessEnv;
  let dev: NodeChildProcess.NodeChildProcess;
  let threadId: string;
  let ticket: Ticket;
  let output = "";
  const cli = async (...args: string[]) =>
    JSON.parse(
      (
        await exec(process.execPath, [bin, ...args, "--home", home, "--json"], {
          cwd: workspace,
          env,
          timeout: 55_000,
          maxBuffer: 2 * 1024 * 1024,
        }).catch((error) => {
          throw new Error(`${error.stderr}\n${output}`);
        })
      ).stdout,
    );
  const wire = async (): Promise<Array<Record<string, any>>> =>
    (await NodeFSP.readFile(NodePath.join(directory, "wire.jsonl"), "utf8").catch(() => ""))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  const observe = (predicate: (records: Array<Record<string, any>>) => boolean) =>
    new Promise<void>((resolve, reject) => {
      const watcher = NodeFS.watch(directory, { signal: AbortSignal.timeout(20_000) });
      const check = async () => {
        if (!predicate(await wire())) return;
        resolve();
        watcher.close();
      };
      watcher.on("change", () => {
        void check().catch(reject);
      });
      watcher.once("close", () => reject(new Error(`No matching Codex event: ${output}`)));
      void check().catch(reject);
    });

  beforeAll(async () => {
    directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "ozi-p2-"));
    home = NodePath.join(directory, "home");
    workspace = NodePath.join(directory, "workspace");
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
          codex: {
            driver: "codex",
            enabled: true,
            config: { binaryPath: binary, homePath: NodePath.join(directory, "codex-home") },
          },
        },
      }),
    );
    env = {
      ...process.env,
      HOME: directory,
      SHELL: "/bin/sh",
      OZI_HOME: home,
      OZI_CODEX_FAKE: directory,
      OZI_TELEMETRY_ENABLED: "false",
      OZI_PORT_OFFSET: String(3000 + (process.pid % 1000)),
      PATH: `${NodePath.join(root, "node_modules/.bin")}${NodePath.delimiter}${process.env.PATH}`,
    };
    const reserve = NodeNet.createServer();
    reserve.listen(0, "127.0.0.1");
    await NodeEvents.once(reserve, "listening");
    const address = reserve.address();
    if (address === null || typeof address === "string") throw new Error("No TCP address");
    await new Promise<void>((resolve) => reserve.close(() => resolve()));
    dev = NodeChildProcess.spawn(
      process.execPath,
      [
        bin,
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
    await new Promise<void>((resolve, reject) => {
      const read = (chunk: Buffer) => {
        output += String(chunk);
        if (output.includes("Ozi server is ready.")) resolve();
      };
      dev.stdout!.on("data", read);
      dev.stderr!.on("data", read);
      dev.once("error", reject);
      dev.once("exit", (code) => reject(new Error(`Dev exited ${code}: ${output}`)));
    });
    await exec(process.execPath, [bin, "project", "add", workspace, "--home", home], { env });
  });

  afterAll(async () => {
    if (dev?.pid && dev.exitCode === null) {
      const exited = NodeEvents.once(dev, "exit");
      dev.kill("SIGTERM");
      await exited;
    }
    if (directory) await NodeFSP.rm(directory, { recursive: true, force: true });
  });

  it("P2.fork: full context and model stay in a hidden fork while the main chat accepts the next reply", async () => {
    const started = await cli(
      "thread",
      "start",
      workspace,
      "decision: choose a release channel",
      "--provider",
      "codex",
      "--model",
      "gpt-5.6-sol",
      "--wait",
    );
    threadId = started.threadId;
    expect(JSON.stringify(started), output).toContain("Reply: decision");
    await observe((records) => records.some((record) => record.event === "fork"));
    const first = (await wire()).find((record) => record.event === "fork")!;
    expect(first.context[0].text).toContain("decision");
    const requests = await wire();
    const params = requests.find((record) => record.method === "thread/fork")!.params;
    expect(params).toMatchObject({
      model: "gpt-5.6-sol",
      lastTurnId: first.context[0].id,
      config: {
        "hooks.Stop": [],
        "hooks.SubagentStop": [],
        "hooks.state": { stop: { enabled: false }, subagentStop: { enabled: false } },
      },
    });
    expect(
      requests.find((record) => record.method === "thread/start")!.params.config["hooks.state"],
    ).toEqual({
      stop: { trusted_hash: "hash:stop" },
      subagentStop: { trusted_hash: "hash:subagentStop" },
    });
    const sent = await cli("thread", "send", threadId, "hello: small talk", "--wait");
    expect(JSON.stringify(sent)).toContain("Reply: hello");
    await NodeFSP.writeFile(NodePath.join(directory, "release"), "");
    await observe(
      (records) => records.filter((record) => record.method === "thread/archive").length === 2,
    );
  });

  it("P2.history: ticket provenance, the main transcript and the shared work-log counts survive the fork", async () => {
    const [{ tickets }, shown] = await Promise.all([
      cli("ticket", "list"),
      cli("thread", "show", threadId, "--activity"),
    ]);
    [ticket] = tickets;
    expect(ticket).toMatchObject({
      title: "P2 release channel",
      origin: { threadId, chatId: threadId, jobId: null, workerId: null },
    });
    expect(shown.messages.map((message: { text: string }) => message.text)).toEqual([
      "decision: choose a release channel",
      "Reply: decision: choose a release channel",
      "hello: small talk",
      "Reply: hello: small talk",
    ]);
    expect((await wire()).filter((record) => record.event === "fork")).toHaveLength(2);
    expect(
      shown.activity
        .filter((item: { title: string }) => item.title?.startsWith("Inbox check"))
        .map((item: { title: string }) => item.title),
    ).toEqual(["Inbox check · 1 filed", "Inbox check · 0 filed"]);
  });

  it("P2.acknowledge: the fork closes listed tickets using this turn's user message", async () => {
    await cli("thread", "send", threadId, "acknowledge: got it", "--wait");
    await observe(
      (records) => records.filter((record) => record.method === "thread/archive").length === 3,
    );
    const archived: Ticket = await cli(
      "ticket",
      "get",
      "--input",
      JSON.stringify({ id: ticket.id }),
    );
    expect(archived.status).toBe("archived");
    expect(archived.cleared?.by).toMatchObject({ type: "agent", threadId });
    if (archived.cleared?.by.type !== "agent") throw new Error("No agent acknowledgement");
    expect(archived.cleared.by.messageId).not.toBe(ticket.origin.messageId);
  });

  it("P2.credentials: forks can call only I2 ticket tools and their credentials expire at completion", async () => {
    const records = await wire();
    expect(
      records.filter((record) => record.event === "restricted").map((record) => record.status),
    ).toEqual([403, 403, 403]);
    for (const fork of records.filter((record) => record.method === "thread/fork")) {
      const mcp = fork.params.config["mcp_servers.t3-code"];
      const result = await fetch(mcp.url, {
        method: "POST",
        headers: {
          ...mcp.http_headers,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      expect(result.status).toBe(401);
    }
  });

  it("P2.failure: a failed inbox fork leaves the main result and reply path usable", async () => {
    const result = await cli("thread", "send", threadId, "failure: preserve this reply", "--wait");
    expect(JSON.stringify(result)).toContain("Reply: failure");
    const { activity } = await cli("thread", "show", threadId, "--activity");
    expect(
      activity.findLast((item: { title: string }) => item.title?.startsWith("Inbox check")),
    ).toMatchObject({ status: "failed" });
    const next = await cli("thread", "send", threadId, "hello again", "--wait");
    expect(JSON.stringify(next)).toContain("Reply: hello again");
  });
});
