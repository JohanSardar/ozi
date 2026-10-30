#!/usr/bin/env node
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeReadline from "node:readline";
import type {
  ServerNotificationMethod,
  ServerNotificationParamsByMethod,
} from "../../packages/effect-codex-app-server/src/_generated/meta.gen.ts";

if (process.argv.includes("--version")) {
  console.log("codex-cli 0.166.0");
  process.exit(0);
}

const fixture = JSON.parse(
  NodeFS.readFileSync(
    new URL(
      "../../apps/server/src/provider/testFixtures/codexMultiAgentWire.json",
      import.meta.url,
    ),
    "utf8",
  ),
).responses;
const directory = process.env.OZI_CODEX_FAKE!;
const threads = new Map<string, { config: Record<string, any>; turns: any[]; fork: boolean }>();
const send = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);
const notify = <M extends ServerNotificationMethod>(
  method: M,
  params: ServerNotificationParamsByMethod[M],
) => send({ jsonrpc: "2.0", method, params });
const record = (value: unknown) =>
  NodeFS.appendFileSync(NodePath.join(directory, "wire.jsonl"), `${JSON.stringify(value)}\n`);
record({ event: "launch", inboxHook: process.argv.some((arg) => arg.startsWith("hooks.Stop=")) });
const snapshot = (id: string) => ({
  ...fixture.threadStart.thread,
  id,
  sessionId: id,
  turns: threads.get(id)?.turns ?? [],
});
const gate = (name: string) =>
  new Promise<void>((resolve) => {
    if (NodeFS.existsSync(NodePath.join(directory, name))) return resolve();
    const watcher = NodeFS.watch(directory, () => {
      if (!NodeFS.existsSync(NodePath.join(directory, name))) return;
      watcher.close();
      resolve();
    });
  });

const check = async (threadId: string, turn: any) => {
  const state = threads.get(threadId)!;
  const source = state.turns.at(-2)?.text ?? "";
  if (source.includes("decision")) await gate("release");
  if (state.config["mcp_servers.ozi.default_tools_approval_mode"] !== "approve")
    throw new Error("Inbox ticket tools require approval");
  const mcp = state.config["mcp_servers.ozi"];
  let session: string | null = null;
  let next = 0;
  const rpc = async (method: string, params: unknown) => {
    const response = await fetch(mcp.url, {
      method: "POST",
      headers: {
        ...mcp.http_headers,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(session ? { "mcp-session-id": session } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++next, method, params }),
    });
    session = response.headers.get("mcp-session-id") ?? session;
    const text = await response.text();
    const data =
      text.startsWith("event:") || text.startsWith("data:")
        ? text
            .split("\n")
            .find((line) => line.startsWith("data: "))!
            .slice(6)
        : text;
    return { status: response.status, value: data ? JSON.parse(data) : null };
  };
  await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "p2-fake", version: "1" },
  });
  const denied = await rpc("tools/call", { name: "ozi_thread_launch", arguments: {} });
  record({ event: "restricted", threadId, status: denied.status });
  const call = async (name: string, args: unknown) => {
    const result = await rpc("tools/call", { name, arguments: args });
    record({ event: "tool", threadId, name, result });
    return result.value?.result;
  };
  const listed = await call("ticket_list", {});
  const list = listed?.structuredContent ?? JSON.parse(listed?.content?.[0]?.text ?? "{}");
  const tickets = list.tickets ?? [];
  if (source.includes("decision")) {
    await call("ticket_create", {
      group: "Decide",
      title: "P2 release channel",
      need: "Choose a release channel.",
      summary: "The build is ready.\nChoose where to release it.",
      markdown: "Full release context from the fork.",
      choices: [{ label: "Stable", detail: "Release to all users." }],
      attachments: [],
      htmlPages: [],
    });
  } else if (source.includes("acknowledge")) {
    for (const ticket of tickets) await call("ticket_close", { id: ticket.id });
  }
  notify("turn/completed", {
    threadId,
    turn: { ...turn, status: "completed", completedAt: Math.floor(Date.now() / 1000) },
  });
  record({ event: "checked", threadId, source });
};

NodeReadline.createInterface({ input: process.stdin }).on("line", async (line) => {
  const request = JSON.parse(line);
  const { id, method, params = {} } = request;
  if (!method) return;
  record({ method, params });
  const reply = (result: unknown) => send({ id, result });
  switch (method) {
    case "initialize":
      return reply({
        userAgent: "p2-fake",
        codexHome: directory,
        platformFamily: "unix",
        platformOs: "macos",
      });
    case "initialized":
      return;
    case "account/read":
      return reply({ account: { type: "apiKey" }, requiresOpenaiAuth: false });
    case "hooks/list":
      return reply({
        data: [
          {
            cwd: params.cwds[0],
            errors: [],
            warnings: [],
            hooks: ["stop", "subagentStop"].map((eventName) => ({
              key: eventName,
              currentHash: `hash:${eventName}`,
              eventName,
              source: "sessionFlags",
              sourcePath: NodePath.join(directory, "config.toml"),
              handlerType: "command",
              command: "true",
              statusMessage: "Ozi inbox check",
              displayOrder: 0,
              enabled: true,
              isManaged: false,
              timeoutSec: 600,
              trustStatus: "untrusted",
            })),
          },
        ],
      });
    case "skills/list":
      return reply({ data: [] });
    case "model/list":
      return reply({ data: [], nextCursor: null });
    case "thread/start": {
      const threadId = NodeCrypto.randomUUID();
      threads.set(threadId, { config: params.config, turns: [], fork: false });
      return reply({ ...fixture.threadStart, thread: snapshot(threadId), cwd: params.cwd });
    }
    case "thread/fork": {
      const parent = threads.get(params.threadId)!;
      if (parent.turns.at(-1)?.text.includes("failure"))
        return send({ id, error: { code: -32000, message: "p2 fork failure" } });
      const threadId = NodeCrypto.randomUUID();
      threads.set(threadId, { config: params.config, turns: [...parent.turns], fork: true });
      record({ event: "fork", threadId, source: params.threadId, context: parent.turns });
      return reply({ ...fixture.threadStart, thread: snapshot(threadId) });
    }
    case "turn/start": {
      const state = threads.get(params.threadId)!;
      const text = params.input.map((item: any) => item.text ?? "").join("\n");
      const turn = {
        ...fixture.turnStart.turn,
        id: NodeCrypto.randomUUID(),
        startedAt: Math.floor(Date.now() / 1000),
      };
      state.turns.push({ ...turn, text });
      reply({ turn });
      notify("turn/started", { threadId: params.threadId, turn });
      if (state.fork) {
        void check(params.threadId, turn).catch((error) =>
          record({ event: "error", error: String(error) }),
        );
        return;
      }
      const item = {
        type: "agentMessage",
        id: NodeCrypto.randomUUID(),
        text: `Reply: ${text}`,
        phase: "final_answer",
        memoryCitation: null,
      };
      notify("item/started", { threadId: params.threadId, turnId: turn.id, item });
      notify("item/completed", {
        threadId: params.threadId,
        turnId: turn.id,
        item,
        completedAtMs: Date.now(),
      });
      if (state.config["hooks.state"]?.stop?.trusted_hash === "hash:stop")
        notify("hook/completed", {
          threadId: params.threadId,
          turnId: turn.id,
          run: {
            id: NodeCrypto.randomUUID(),
            eventName: "stop",
            handlerType: "command",
            executionMode: "sync",
            scope: "turn",
            sourcePath: NodePath.join(directory, "config.toml"),
            startedAt: Date.now(),
            completedAt: Date.now(),
            status: "completed",
            statusMessage: "Ozi inbox check",
            displayOrder: 0,
            entries: [],
          },
        });
      notify("turn/completed", {
        threadId: params.threadId,
        turn: { ...turn, status: "completed", completedAt: Math.floor(Date.now() / 1000) },
      });
      return;
    }
    default:
      if (id !== undefined) return reply({});
  }
});
