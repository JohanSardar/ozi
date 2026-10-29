#!/usr/bin/env node
import * as NodeReadline from "node:readline";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
if (process.argv.includes("--version")) {
  console.log("1.0.0");
  process.exit(0);
}
const model = {
  id: "c1-model",
  name: "C1 model",
  provider: "test",
  api: "anthropic-messages",
  reasoning: false,
  input: ["text"],
  contextWindow: 200000,
  maxTokens: 32000,
};
const sessionId = crypto.randomUUID();
const sessionFile = NodePath.join(process.cwd(), `${sessionId}.jsonl`);
const entries = [];
const write = (frame) => console.log(JSON.stringify(frame));
NodeReadline.createInterface({ input: process.stdin }).on("line", (line) => {
  const frame = JSON.parse(line);
  const data =
    frame.type === "get_state"
      ? {
          model,
          sessionId,
          sessionFile,
          isStreaming: false,
          messageCount: entries.length,
          thinkingLevel: "off",
        }
      : frame.type === "get_available_models"
        ? { models: [model] }
        : frame.type === "get_commands"
          ? { commands: [] }
          : frame.type === "get_messages"
            ? { messages: entries.map((entry) => entry.message) }
            : frame.type === "get_entries"
              ? { entries, leafId: entries.at(-1)?.id ?? null }
              : {};
  write({ type: "response", command: frame.type, id: frame.id, success: true, data });
  if (frame.type !== "prompt") return;
  const message = {
    role: "assistant",
    content: [{ type: "text", text: "C1 delivered" }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    timestamp: Date.now(),
    stopReason: "stop",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, total: 0 },
    },
  };
  entries.push({
    type: "message",
    id: crypto.randomUUID(),
    parentId: null,
    timestamp: new Date().toISOString(),
    message,
  });
  NodeFS.writeFileSync(sessionFile, entries.map(JSON.stringify).join("\n"));
  write({ type: "agent_start" });
  write({ type: "message_start", message });
  write({ type: "message_end", message });
  write({ type: "turn_end", message, toolResults: [] });
  write({ type: "agent_end", messages: [message] });
  write({ type: "agent_settled", messages: [message] });
});
