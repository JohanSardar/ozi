import * as NodeFS from "node:fs";
import {
  argv,
  id,
  interpreter,
  launch,
  lines,
  option,
  sessionFile,
  write,
  settled,
  forkBarrier,
} from "./agent.mjs";

if (launch("pi")) {
  if (argv.includes("--fork")) await forkBarrier("pi");
  let sessionId = id();
  let file = sessionFile("pi", sessionId);
  let entries = [];
  let partialHistory = false;
  let active = false;
  let model = {
    id: "claude-opus-5-5",
    name: "Claude Opus 5.5",
    provider: option("--provider") ?? "anthropic",
    api: "anthropic-messages",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 200000,
    maxTokens: 32000,
    thinkingLevelMap: { off: "off", high: "high", low: "low" },
  };
  let thinkingLevel = "high";
  const models = [
    ...(process.env.ANTHROPIC_OAUTH_TOKEN ? [{ ...model, provider: "anthropic" }] : []),
    ...(argv.some((arg) => arg.includes("pi-claude-bridge"))
      ? [
          {
            ...model,
            provider: "claude-bridge",
            id: "claude-sonnet-5-5",
            name: "Claude Sonnet 5.5",
          },
          { ...model, provider: "claude-bridge" },
          {
            ...model,
            provider: "local",
            id: "llama-3.1-8b",
            name: "Llama 3.1 8B",
            reasoning: false,
          },
        ]
      : []),
  ];
  const source = argv.includes("--fork")
    ? option("--fork")
    : argv.includes("--session")
      ? option("--session")
      : null;
  if (source && NodeFS.existsSync(source))
    entries = NodeFS.readFileSync(source, "utf8")
      .trim()
      .split("\n")
      .map(JSON.parse)
      .filter((entry) => entry.type !== "session");
  const save = () =>
    NodeFS.writeFileSync(
      file,
      partialHistory
        ? "{"
        : `${[JSON.stringify({ type: "session", version: 3, id: sessionId, timestamp: new Date().toISOString(), cwd: process.cwd() }), ...entries.map((entry) => JSON.stringify(entry))].join("\n")}\n`,
    );
  const append = (message) => {
    entries.push({
      type: "message",
      id: id(),
      parentId: entries.at(-1)?.id ?? null,
      timestamp: new Date().toISOString(),
      message,
    });
    save();
  };
  const assistant = (text, stopReason = "stop") => ({
    role: "assistant",
    content: [{ type: "text", text }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    timestamp: Date.now(),
    stopReason,
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  });
  const finish = () => {
    partialHistory = false;
    save();
    active = false;
    settled("pi", file, file);
    write({ type: "turn_end", message: entries.at(-1)?.message, toolResults: [] });
    write({
      type: "agent_end",
      messages: entries.filter((entry) => entry.type === "message").map((entry) => entry.message),
    });
    write({ type: "agent_settled" });
  };
  const engine = interpreter("pi", {
    history() {
      partialHistory = true;
      save();
    },
    tool(tool, result) {
      const toolCallId = id();
      append({
        ...assistant("", "toolUse"),
        content: [
          { type: "toolCall", id: toolCallId, name: tool.name, arguments: tool.arguments ?? {} },
        ],
      });
      append({
        role: "toolResult",
        toolCallId,
        toolName: tool.name,
        content: result.content ?? [],
        details: result.structuredContent,
        isError: result.isError ?? false,
        timestamp: Date.now(),
      });
    },
    think(text) {
      const message = assistant("");
      write({ type: "message_start", message });
      write({
        type: "message_update",
        message,
        assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: text },
      });
      write({
        type: "message_update",
        message,
        assistantMessageEvent: { type: "thinking_end", contentIndex: 0, content: text },
      });
      write({ type: "message_end", message });
    },
    shell(command, result) {
      const toolCallId = id();
      write({ type: "tool_execution_start", toolCallId, toolName: "bash", args: { command } });
      write({
        type: "tool_execution_end",
        toolCallId,
        toolName: "bash",
        result: {
          content: [{ type: "text", text: `${result.stdout}${result.stderr}` }],
          details: { exitCode: result.code },
        },
        isError: result.code !== 0,
      });
    },
    say(text) {
      const message = assistant(text);
      write({ type: "message_start", message });
      write({
        type: "message_update",
        message,
        assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: text },
      });
      write({
        type: "message_update",
        message,
        assistantMessageEvent: { type: "text_end", contentIndex: 0, content: text },
      });
      append(message);
      write({ type: "message_end", message });
    },
    done: finish,
    request(requestId, kind, value) {
      write({
        type: "extension_ui_request",
        id: requestId,
        method: kind === "ask" ? "input" : "confirm",
        title: String(value),
        message: String(value),
      });
    },
  });
  const prompt = option("--system-prompt") ?? option("--append-system-prompt") ?? "";
  const promptPath = prompt.startsWith("@") ? prompt.slice(1) : prompt;
  engine.configure(
    {},
    promptPath && NodeFS.existsSync(promptPath) && NodeFS.statSync(promptPath).isFile()
      ? NodeFS.readFileSync(promptPath, "utf8")
      : prompt,
  );
  save();
  lines("pi", async (frame) => {
    const reply = (data) =>
      write({
        type: "response",
        command: frame.type,
        ...(frame.id ? { id: frame.id } : {}),
        success: true,
        ...(data === undefined ? {} : { data }),
      });
    switch (frame.type) {
      case "get_state":
        reply({
          model,
          thinkingLevel,
          isStreaming: active,
          isCompacting: false,
          sessionFile: file,
          sessionId,
          messageCount: entries.length,
          pendingMessageCount: 0,
          autoCompactionEnabled: true,
          steeringMode: "all",
          followUpMode: "all",
        });
        break;
      case "get_available_models":
        reply({ models });
        break;
      case "get_commands":
        reply({ commands: [] });
        break;
      case "get_session_stats":
        reply({
          tokens: entries.reduce(
            (total, entry) => {
              const usage = entry.message?.usage;
              return {
                input: total.input + (usage?.input ?? 0),
                output: total.output + (usage?.output ?? 0),
                cacheRead: 0,
                cacheWrite: 0,
              };
            },
            { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          ),
          contextUsage: { tokens: 2, contextWindow: model.contextWindow },
          totalCost: 0,
        });
        break;
      case "get_entries":
        reply({
          entries: frame.since
            ? entries.slice(entries.findIndex((entry) => entry.id === frame.since) + 1)
            : entries,
          leafId: entries.at(-1)?.id ?? null,
        });
        break;
      case "fork": {
        const index = entries.findIndex((entry) => entry.id === frame.entryId);
        const text =
          entries[index]?.message?.content?.find((item) => item.type === "text")?.text ?? "";
        entries = entries.slice(0, Math.max(0, index));
        save();
        reply({ text, cancelled: false });
        break;
      }
      case "get_messages":
        reply({
          messages: entries
            .filter((entry) => entry.type === "message")
            .map((entry) => entry.message),
        });
        break;
      case "get_last_assistant_text":
        reply({
          text:
            entries.findLast((entry) => entry.message?.role === "assistant")?.message.content[0]
              .text ?? "",
        });
        break;
      case "set_model":
        model = { ...model, provider: frame.provider, id: frame.modelId };
        reply(model);
        break;
      case "set_thinking_level":
        thinkingLevel = frame.level;
        reply();
        break;
      case "set_session_name":
      case "set_auto_compaction":
      case "set_steering_mode":
      case "set_follow_up_mode":
        reply();
        break;
      case "new_session":
        sessionId = id();
        file = sessionFile("pi", sessionId);
        entries = [];
        save();
        reply({ cancelled: false });
        break;
      case "switch_session":
        file = frame.sessionPath;
        entries = NodeFS.readFileSync(file, "utf8")
          .trim()
          .split("\n")
          .map(JSON.parse)
          .filter((entry) => entry.type !== "session");
        reply({ cancelled: false });
        break;
      case "extension_ui_response":
        engine.respond(frame.id, frame.value ?? frame.confirmed);
        break;
      case "abort":
        engine.interrupt();
        reply();
        if (active) finish();
        break;
      case "prompt":
      case "steer":
      case "follow_up": {
        reply({ disposition: active ? "steered" : "started" });
        active = true;
        append({
          role: "user",
          content: [{ type: "text", text: frame.message }],
          timestamp: Date.now(),
        });
        write({ type: "agent_start" });
        write({ type: "turn_start" });
        try {
          await engine.run(frame.message);
        } catch (error) {
          const message = { ...assistant("", "error"), errorMessage: error.message };
          append(message);
          write({ type: "message_end", message });
          finish();
        }
        break;
      }
      default:
        write({
          type: "response",
          id: frame.id,
          command: frame.type,
          success: false,
          error: `Unsupported Pi command ${frame.type}`,
        });
    }
  });
}
