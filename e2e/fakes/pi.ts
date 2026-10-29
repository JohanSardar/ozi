#!/usr/bin/env node
import * as NodeCrypto from "node:crypto";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeReadline from "node:readline";

if (process.argv.includes("--version")) {
  console.log("0.80.5");
  process.exit(0);
}

type Rpc = Record<string, unknown>;

const model = {
  type: "chat",
  id: "fake-model",
  name: "Fake model",
  api: "fake",
  provider: "fake",
  reasoning: false,
  input: ["text", "image"],
  contextWindow: 200_000,
  maxTokens: 8_000,
};
const sessionIndex = process.argv.indexOf("--session");
const sessionFile =
  sessionIndex > 0
    ? process.argv[sessionIndex + 1]
    : NodePath.join(NodeOS.tmpdir(), `fake-pi-${NodeCrypto.randomUUID()}.jsonl`);
const entries: Array<Rpc> = [];
let streaming = false;

const send = (record: Rpc) => process.stdout.write(`${JSON.stringify(record)}\n`);
const respond = (request: Rpc, data?: unknown) =>
  send({
    ...(request.id === undefined ? {} : { id: request.id }),
    type: "response",
    command: request.type,
    success: true,
    ...(data === undefined ? {} : { data }),
  });
const append = (message: Rpc) => {
  const id = NodeCrypto.randomBytes(4).toString("hex");
  entries.push({
    type: "message",
    id,
    parentId: entries.at(-1)?.id ?? null,
    timestamp: new Date().toISOString(),
    message,
  });
};
const userMessage = (text: string) => {
  const message = { role: "user", content: [{ type: "text", text }], timestamp: Date.now() };
  send({ type: "message_start", message });
  send({ type: "message_end", message });
  append(message);
};
const reply = (text: string) => {
  const message = {
    role: "assistant",
    content: [{ type: "text", text }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    stopReason: "stop",
    timestamp: Date.now(),
  };
  send({ type: "message_start", message: { ...message, content: [], stopReason: "pending" } });
  send({ type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 0 } });
  send({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: text },
  });
  send({
    type: "message_update",
    assistantMessageEvent: { type: "text_end", contentIndex: 0, content: text },
  });
  send({ type: "message_end", message });
  send({ type: "turn_end", message, toolResults: [] });
  append(message);
};
const settle = () => {
  streaming = false;
  send({ type: "agent_end", messages: entries.map((entry) => entry.message) });
  send({ type: "agent_settled" });
};
const answer = (text: string) => {
  reply(`Fake reply: ${text}`);
  if (!text.includes("hold")) settle();
};

const handlers: Record<string, (request: Rpc) => void> = {
  get_state: (request) =>
    respond(request, {
      model,
      thinkingLevel: "off",
      isStreaming: streaming,
      isCompacting: false,
      steeringMode: "one-at-a-time",
      followUpMode: "one-at-a-time",
      sessionFile,
      sessionId: NodePath.basename(sessionFile),
      autoCompactionEnabled: false,
      messageCount: entries.length,
      pendingMessageCount: 0,
    }),
  get_available_models: (request) => respond(request, { models: [model] }),
  get_commands: (request) => respond(request, { commands: [] }),
  get_messages: (request) => respond(request, { messages: entries.map((entry) => entry.message) }),
  get_entries: (request) => {
    const since = entries.findIndex((entry) => entry.id === request.since);
    respond(request, {
      entries: entries.slice(since + 1),
      leafId: entries.at(-1)?.id ?? null,
    });
  },
  get_session_stats: (request) =>
    respond(request, {
      sessionFile,
      sessionId: NodePath.basename(sessionFile),
      totalMessages: entries.length,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    }),
  set_model: (request) => respond(request, model),
  prompt: (request) => {
    const text = String(request.message);
    if (streaming) {
      send({ type: "queue_update", steering: [text], followUp: [] });
      respond(request, { disposition: "queued" });
      send({ type: "queue_update", steering: [], followUp: [] });
    } else {
      streaming = true;
      respond(request, { disposition: "started" });
      send({ type: "agent_start" });
    }
    send({ type: "turn_start" });
    userMessage(text);
    answer(text);
  },
  abort: (request) => {
    if (streaming) settle();
    respond(request);
  },
};

NodeReadline.createInterface({ input: process.stdin }).on("line", (line) => {
  if (line.trim() === "") return;
  const request = JSON.parse(line) as Rpc;
  const handler = handlers[String(request.type)];
  if (handler) handler(request);
  else respond(request);
});
