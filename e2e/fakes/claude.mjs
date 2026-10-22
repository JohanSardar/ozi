import * as NodeFS from "node:fs";
import { argv, id, interpreter, launch, lines, option, sessionFile, write } from "./agent.mjs";

if (launch("claude")) {
  if (argv[0] === "auth") {
    write({ loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty" });
  } else {
    const sessionId =
      option("--session-id") ??
      (argv.includes("--fork-session") ? id() : (option("--resume") ?? id()));
    const file = sessionFile("claude", sessionId);
    const model = argv.includes("--model") ? option("--model") : "claude-opus-5-5";
    let mcp = argv.includes("--mcp-config") ? JSON.parse(option("--mcp-config")).mcpServers : {};
    let instructions = argv.includes("--append-system-prompt")
      ? option("--append-system-prompt")
      : "";
    let text = "";
    let running = false;
    if (argv.includes("--fork-session") && option("--resume")) {
      const source = sessionFile("claude", option("--resume"));
      const entries = NodeFS.readFileSync(source, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(JSON.parse);
      const boundary = option("--resume-session-at");
      const index = boundary
        ? entries.findIndex((entry) => entry.uuid === boundary)
        : entries.length - 1;
      if (boundary && index < 0) throw new Error("Missing Claude fork boundary");
      NodeFS.writeFileSync(
        file,
        entries
          .slice(0, index + 1)
          .map((entry) =>
            JSON.stringify({ ...entry, sessionId, session_id: sessionId, cwd: process.cwd() }),
          )
          .join("\n") + "\n",
      );
    }
    let parentUuid = NodeFS.existsSync(file)
      ? (JSON.parse(NodeFS.readFileSync(file, "utf8").trim().split("\n").at(-1) || "null")?.uuid ??
        null)
      : null;
    const usage = {
      input_tokens: 1,
      output_tokens: 1,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    };
    const emit = (message) => {
      const frame = {
        ...message,
        uuid: id(),
        parentUuid,
        sessionId,
        session_id: sessionId,
        cwd: process.cwd(),
        timestamp: new Date().toISOString(),
        version: "2.1.288",
        userType: "external",
      };
      parentUuid = frame.uuid;
      NodeFS.appendFileSync(file, `${JSON.stringify(frame)}\n`);
      write(frame);
    };
    const finish = (interrupted = false, error) => {
      running = false;
      emit({
        type: "result",
        subtype: error ? "error_during_execution" : "success",
        is_error: Boolean(error),
        duration_ms: 1,
        duration_api_ms: 1,
        num_turns: 1,
        result: text,
        ...(error ? { errors: [error] } : {}),
        stop_reason: interrupted ? "interrupted" : "end_turn",
        total_cost_usd: 0,
        usage,
        modelUsage: {},
        permission_denials: [],
      });
    };
    const configure = () => engine.configure(mcp?.["t3-code"] ?? {}, instructions);
    const engine = interpreter("claude", {
      say(value) {
        text += value;
        emit({
          type: "assistant",
          parent_tool_use_id: null,
          message: {
            id: id(),
            type: "message",
            role: "assistant",
            content: [{ type: "text", text: value }],
            model,
            stop_reason: "end_turn",
            stop_sequence: null,
            usage,
          },
        });
      },
      done: () => finish(),
      request(requestId, kind, value) {
        write({
          type: "control_request",
          request_id: requestId,
          request: {
            subtype: "can_use_tool",
            tool_name: kind === "ask" ? "AskUserQuestion" : "Bash",
            input:
              kind === "ask"
                ? {
                    questions: [
                      {
                        question: String(value),
                        header: "Question",
                        multiSelect: false,
                        options: [{ label: "Yes", description: "Continue" }],
                      },
                    ],
                  }
                : { command: String(value) },
            tool_use_id: id(),
          },
        });
      },
    });
    configure();
    lines("claude", async (frame) => {
      if (frame.type === "control_response") {
        engine.respond(frame.response.request_id, frame.response.response ?? frame.response.error);
        return;
      }
      if (frame.type === "control_request") {
        const request = frame.request;
        let response = {};
        switch (request.subtype) {
          case "initialize":
            instructions = [request.systemPrompt, request.appendSystemPrompt]
              .flat()
              .filter(Boolean)
              .join("\n\n");
            configure();
            response = {
              commands: [],
              agents: [],
              models: [
                { value: "claude-opus-5-5", displayName: "Opus 5.5", description: "Fake Opus" },
              ],
              account: {
                email: "fake@example.invalid",
                tokenSource: "claude.ai",
                apiKeySource: "none",
                subscriptionType: "max",
              },
              output_style: "default",
              available_output_styles: ["default"],
              fast_mode_state: "off",
            };
            break;
          case "mcp_set_servers":
            mcp = request.servers;
            configure();
            response = { added: Object.keys(mcp), removed: [], errors: {} };
            break;
          case "get_usage":
            response = { five_hour: null, seven_day: null };
            break;
          case "mcp_status":
            response = {
              mcpServers: Object.keys(mcp).map((name) => ({ name, status: "connected" })),
            };
            break;
          case "interrupt":
            engine.interrupt();
            if (running) finish(true);
            break;
          case "set_model":
          case "set_permission_mode":
          case "set_max_thinking_tokens":
          case "stop_task":
            break;
          default:
            write({
              type: "control_response",
              response: {
                subtype: "error",
                request_id: frame.request_id,
                error: `Unsupported Claude control ${request.subtype}`,
              },
            });
            return;
        }
        write({
          type: "control_response",
          response: { subtype: "success", request_id: frame.request_id, response },
        });
        return;
      }
      if (frame.type === "user") {
        running = true;
        text = "";
        NodeFS.appendFileSync(
          file,
          `${JSON.stringify({ ...frame, uuid: frame.uuid ?? id(), sessionId, parentUuid: null, timestamp: new Date().toISOString() })}\n`,
        );
        emit({
          type: "system",
          subtype: "init",
          cwd: process.cwd(),
          tools: [],
          mcp_servers: Object.keys(mcp),
          model,
          permissionMode: "bypassPermissions",
          slash_commands: [],
          agents: [],
          skills: [],
          plugins: [],
          apiKeySource: "none",
          claude_code_version: "2.1.288",
        });
        const prompt =
          typeof frame.message.content === "string"
            ? frame.message.content
            : frame.message.content.map((item) => item.text ?? JSON.stringify(item)).join("\n");
        try {
          await engine.run(prompt);
        } catch (error) {
          finish(false, error.message);
        }
      }
    });
  }
}
