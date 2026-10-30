#!/usr/bin/env node
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeReadline from "node:readline";

const args = process.argv.slice(2);
if (args.includes("--version")) {
  console.log("1.4.0");
  process.exit(0);
}
if (args.includes("--export")) {
  const index = args.indexOf("--export");
  const content = NodeFS.readFileSync(args[index + 1], "utf8")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;");
  NodeFS.writeFileSync(
    args[index + 2],
    `<!doctype html><title>Pi session</title><pre>${content}</pre>`,
  );
  process.exit(0);
}
const directory = NodePath.join(process.env.HOME, "pi-sessions");
NodeFS.mkdirSync(directory, { recursive: true });
let file;
let entries;
let waiting = false;
const send = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
const save = () =>
  NodeFS.writeFileSync(file, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
const fresh = () => {
  file = NodePath.join(directory, `${NodeCrypto.randomUUID()}.jsonl`);
  entries = [
    {
      type: "session",
      version: 3,
      id: NodeCrypto.randomUUID(),
      timestamp: new Date().toISOString(),
      cwd: process.cwd(),
    },
  ];
  save();
};
const branch = () => {
  const result = [];
  let entry = entries.at(-1);
  while (entry && entry.type !== "session") {
    result.unshift(entry);
    entry = entries.find((candidate) => candidate.id === entry.parentId);
  }
  return result;
};
const add = (role, text) => {
  const entry = {
    type: "message",
    id: NodeCrypto.randomUUID(),
    parentId: entries.length > 1 ? entries.at(-1).id : null,
    timestamp: new Date().toISOString(),
    message: { role, content: [{ type: "text", text }] },
  };
  entries.push(entry);
  save();
};
const finish = (text, failed = false) => {
  waiting = false;
  add("assistant", text);
  send({ type: "message_start", message: { role: "assistant" } });
  send({
    type: "message_update",
    assistantMessageEvent: { type: "text_end", contentIndex: 0, content: text },
  });
  send({
    type: "message_end",
    message: {
      role: "assistant",
      stopReason: failed ? "error" : "stop",
      errorMessage: failed ? text : undefined,
    },
  });
  send({ type: "agent_end", messages: [], willRetry: false });
  send({ type: "agent_settled" });
};
fresh();
if (args.includes("--fork")) {
  entries = JSON.parse(
    JSON.stringify(
      NodeFS.readFileSync(args[args.indexOf("--fork") + 1], "utf8")
        .trim()
        .split("\n")
        .map(JSON.parse),
    ),
  );
  save();
}
for await (const line of NodeReadline.createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  if (process.env.OZI_FAKE_LOG)
    NodeFS.appendFileSync(process.env.OZI_FAKE_LOG, JSON.stringify({ file, request }) + "\n");
  const response = (data = {}) =>
    send({ type: "response", id: request.id, command: request.type, success: true, data });
  switch (request.type) {
    case "get_state":
      response({
        sessionFile: file,
        sessionId: entries[0].id,
        isStreaming: waiting,
        isCompacting: false,
        thinkingLevel: "high",
        messageCount: entries.length - 1,
        pendingMessageCount: 0,
      });
      break;
    case "get_available_models":
      response({
        models: [
          {
            id: "test",
            provider: "test",
            name: "Test model",
            contextWindow: 200000,
            maxTokens: 4096,
            reasoning: true,
            input: ["text"],
          },
        ],
      });
      break;
    case "get_commands":
      response({ commands: [] });
      break;
    case "get_entries":
      response({
        entries: entries.slice(1),
        leafId: entries.length > 1 ? entries.at(-1).id : null,
      });
      break;
    case "get_messages":
      response({
        messages: branch()
          .filter((entry) => entry.type === "message")
          .map((entry) => entry.message),
      });
      break;
    case "get_session_stats":
      response({ tokens: { input: 10, output: 10, total: 20 }, cost: 0 });
      break;
    case "switch_session":
      file = request.sessionPath;
      entries = NodeFS.readFileSync(file, "utf8").trim().split("\n").map(JSON.parse);
      response({ cancelled: false });
      break;
    case "new_session":
      fresh();
      response({ cancelled: false });
      break;
    case "fork": {
      const prior = branch();
      const end = prior.findIndex((entry) => entry.id === request.entryId);
      const kept = [entries[0], ...prior.slice(0, end)];
      fresh();
      entries = kept;
      save();
      response({ cancelled: false });
      break;
    }
    case "prompt": {
      response();
      send({ type: "agent_start" });
      const history = branch()
        .filter((entry) => entry.message?.role === "user")
        .map((entry) =>
          typeof entry.message.content === "string"
            ? entry.message.content
            : entry.message.content[0].text,
        );
      add("user", request.message);
      if (request.message === "ask") {
        waiting = true;
        send({
          type: "extension_ui_request",
          id: "question",
          method: "confirm",
          title: "Continue?",
        });
      } else if (request.message === "fail") finish("Provider failed", true);
      else finish(JSON.stringify({ history, prompt: request.message }));
      break;
    }
    case "extension_ui_response":
      finish("Answered");
      break;
    case "abort":
      waiting = false;
      response();
      send({ type: "agent_settled", aborted: true });
      break;
    default:
      response();
  }
}
