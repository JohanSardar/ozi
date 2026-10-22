import * as Schema from "effect/Schema";
import {
  CLIENT_REQUEST_RESPONSES,
  SERVER_NOTIFICATION_PARAMS,
  SERVER_REQUEST_PARAMS,
} from "effect-codex-app-server/rpc";
import * as NodeFS from "node:fs";
import {
  id,
  interpreter,
  launch,
  lines,
  sessionFile,
  write,
  settled,
  forkBarrier,
} from "./agent.mjs";

const requestDecoders = {
  "item/tool/requestUserInput": Schema.decodeUnknownSync(
    SERVER_REQUEST_PARAMS["item/tool/requestUserInput"],
  ),
  "item/commandExecution/requestApproval": Schema.decodeUnknownSync(
    SERVER_REQUEST_PARAMS["item/commandExecution/requestApproval"],
  ),
};

if (launch("codex")) {
  const sessions = new Map();
  const requests = new Map();
  const model = {
    id: "gpt-6.1-sol",
    model: "gpt-6.1-sol",
    displayName: "GPT 6.1 Sol",
    description: "Fake Codex",
    hidden: false,
    isDefault: true,
    supportedReasoningEfforts: ["low", "high", "xhigh"].map((reasoningEffort) => ({
      reasoningEffort,
      description: reasoningEffort,
    })),
    defaultReasoningEffort: "xhigh",
    inputModalities: ["text", "image"],
    supportsPersonality: false,
    serviceTiers: [{ id: "priority", name: "Fast", description: "Fast" }],
  };
  const notify = (method, params) => {
    if (method === "item/started") params = { startedAtMs: Date.now(), ...params };
    if (method === "item/completed") params = { completedAtMs: Date.now(), ...params };
    const schema = SERVER_NOTIFICATION_PARAMS[method];
    if (schema) Schema.decodeUnknownSync(schema)(params);
    write({ method, params });
  };
  const open = (thread) => {
    let turn = thread.turns.at(-1);
    let config = {};
    const save = () =>
      NodeFS.writeFileSync(sessionFile("codex", thread.id), JSON.stringify(thread));
    const emitItem = (item) => {
      turn.items.push(item);
      notify("item/started", { threadId: thread.id, turnId: turn.id, item });
      notify("item/completed", { threadId: thread.id, turnId: turn.id, item });
      save();
    };
    const finish = (status = "completed", error = null) => {
      turn.status = status;
      turn.error = error;
      turn.completedAt = Math.floor(Date.now() / 1000);
      save();
      const usage = {
        totalTokens: 2,
        inputTokens: 1,
        cachedInputTokens: 0,
        outputTokens: 1,
        reasoningOutputTokens: 0,
      };
      notify("thread/tokenUsage/updated", {
        threadId: thread.id,
        turnId: turn.id,
        tokenUsage: {
          last: usage,
          total: {
            ...usage,
            totalTokens: thread.turns.length * 2,
            inputTokens: thread.turns.length,
            outputTokens: thread.turns.length,
          },
          modelContextWindow: 200000,
        },
      });
      settled("codex", thread.id, sessionFile("codex", thread.id));
      notify("turn/completed", { threadId: thread.id, turn });
    };
    const engine = interpreter("codex", {
      say(text) {
        emitItem({ type: "agentMessage", id: id(), text, phase: "final_answer" });
      },
      done: () => finish(),
      tool(tool, result) {
        emitItem({
          type: "mcpToolCall",
          id: id(),
          server: "t3-code",
          tool: tool.name,
          arguments: tool.arguments ?? {},
          status: "completed",
          result,
          error: null,
          durationMs: 1,
        });
      },
      request(requestId, kind, value) {
        requests.set(requestId, engine);
        const request = {
          id: requestId,
          method:
            kind === "ask" ? "item/tool/requestUserInput" : "item/commandExecution/requestApproval",
          params:
            kind === "ask"
              ? {
                  threadId: thread.id,
                  turnId: turn.id,
                  itemId: id(),
                  isBlocking: true,
                  questions: [
                    {
                      id: "answer",
                      header: "Question",
                      question: String(value),
                      isOther: true,
                      isSecret: false,
                      options: [{ label: "Yes", description: "Continue" }],
                    },
                  ],
                }
              : {
                  threadId: thread.id,
                  turnId: turn.id,
                  itemId: id(),
                  startedAtMs: Date.now(),
                  command: String(value),
                  cwd: process.cwd(),
                  reason: "Scripted approval",
                  availableDecisions: ["accept", "decline"],
                },
        };
        requestDecoders[request.method](request.params);
        write(request);
      },
    });
    const loadout = (params) => {
      config = { ...config, ...params.config };
      const mcp = config["mcp_servers.t3-code"] ?? config.mcp_servers?.["t3-code"];
      engine.configure(
        mcp,
        params.collaborationMode?.settings?.developer_instructions ??
          params.developerInstructions ??
          params.baseInstructions ??
          config.developer_instructions ??
          "",
      );
    };
    const threadResult = () => ({
      thread,
      model: model.model,
      modelProvider: "openai",
      serviceTier: "priority",
      cwd: process.cwd(),
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandbox: { type: "dangerFullAccess" },
      reasoningEffort: "xhigh",
    });
    const session = {
      thread,
      engine,
      save,
      loadout,
      threadResult,
      finish,
      get turn() {
        return turn;
      },
      set turn(value) {
        turn = value;
      },
    };
    sessions.set(thread.id, session);
    return session;
  };
  const read = (threadId) =>
    sessions.get(threadId) ??
    open(JSON.parse(NodeFS.readFileSync(sessionFile("codex", threadId), "utf8")));
  lines("codex", async (frame) => {
    if (frame.method === undefined) {
      requests.get(frame.id)?.respond(frame.id, frame.result ?? frame.error);
      requests.delete(frame.id);
      return;
    }
    const { method, params = {} } = frame;
    const reply = (result) => {
      const schema = CLIENT_REQUEST_RESPONSES[method];
      if (schema) Schema.decodeUnknownSync(schema)(result);
      if (frame.id !== undefined) write({ id: frame.id, result });
    };
    switch (method) {
      case "initialize":
        reply({
          userAgent: "codex/0.162.0",
          codexHome: process.env.CODEX_HOME,
          platformFamily: "unix",
          platformOs: "linux",
        });
        break;
      case "initialized":
        break;
      case "account/read":
        reply({
          account: { type: "chatgpt", email: "fake@example.invalid", planType: "pro" },
          requiresOpenaiAuth: false,
        });
        break;
      case "account/rateLimits/read":
        reply({
          rateLimits: { primary: null, secondary: null, credits: null, planType: "pro" },
          rateLimitsByLimitId: {},
        });
        break;
      case "model/list":
        reply({ data: [model], nextCursor: null });
        break;
      case "skills/list":
        reply({ data: [] });
        break;
      case "config/read":
        reply({ config: { service_tier: "priority" }, origins: {}, layers: null });
        break;
      case "configRequirements/read":
        reply({ requirements: null });
        break;
      case "mcpServerStatus/list":
        reply({ data: [], nextCursor: null });
        break;
      case "thread/unsubscribe":
        reply({ status: "unsubscribed" });
        break;
      case "thread/list":
        reply({ data: [], nextCursor: null });
        break;
      case "thread/start": {
        const threadId = id();
        const thread = {
          id: threadId,
          sessionId: threadId,
          projectId: null,
          forkedFromId: null,
          preview: "",
          ephemeral: false,
          modelProvider: "openai",
          createdAt: Math.floor(Date.now() / 1000),
          updatedAt: Math.floor(Date.now() / 1000),
          status: { type: "idle" },
          path: sessionFile("codex", threadId),
          cwd: params.cwd ?? process.cwd(),
          cliVersion: "0.162.0",
          source: "appServer",
          agentNickname: null,
          agentRole: null,
          gitInfo: null,
          name: null,
          turns: [],
        };
        const session = open(thread);
        session.loadout(params);
        session.save();
        reply(session.threadResult());
        break;
      }
      case "thread/resume":
      case "thread/read":
      case "thread/fork": {
        let thread = read(params.threadId).thread;
        if (method === "thread/fork") {
          await forkBarrier("codex");
          const sourceId = thread.id;
          thread = structuredClone(thread);
          thread.id = id();
          thread.forkedFromId = sourceId;
          thread.path = sessionFile("codex", thread.id);
          if (params.lastTurnId)
            thread.turns = thread.turns.slice(
              0,
              thread.turns.findIndex((item) => item.id === params.lastTurnId) + 1,
            );
        }
        const session = sessions.get(thread.id) ?? open(thread);
        session.loadout(params);
        session.save();
        reply(method === "thread/read" ? { thread } : session.threadResult());
        break;
      }
      case "turn/start": {
        const session = read(params.threadId);
        session.loadout(params);
        const turn = {
          id: id(),
          items: [],
          status: "inProgress",
          error: null,
          startedAt: Math.floor(Date.now() / 1000),
          completedAt: null,
          durationMs: null,
        };
        session.turn = turn;
        session.thread.turns.push(turn);
        session.save();
        reply({ turn });
        notify("turn/started", { threadId: session.thread.id, turn });
        const prompt = params.input.map((item) => item.text ?? item.path ?? "").join("\n");
        try {
          await session.engine.run(prompt);
        } catch (error) {
          session.finish("failed", {
            message: error.message,
            codexErrorInfo: "other",
            additionalDetails: null,
          });
        }
        break;
      }
      case "turn/steer": {
        const session = read(params.threadId);
        reply({ turnId: session.turn.id });
        try {
          await session.engine.run(params.input.map((item) => item.text ?? "").join("\n"));
        } catch (error) {
          session.finish("failed", {
            message: error.message,
            codexErrorInfo: "other",
            additionalDetails: null,
          });
        }
        break;
      }
      case "turn/interrupt": {
        const session = read(params.threadId);
        session.engine.interrupt();
        reply({});
        session.finish("interrupted");
        break;
      }
      case "thread/name/set": {
        const session = read(params.threadId);
        session.thread.name = params.name;
        session.save();
        reply({});
        break;
      }
      default:
        if (frame.id !== undefined)
          write({
            id: frame.id,
            error: { code: -32601, message: `Unsupported Codex method ${method}` },
          });
    }
  });
}
