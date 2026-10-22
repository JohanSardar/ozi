import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";

export const argv = process.argv.slice(2);
export const option = (name) => {
  const index = argv.findIndex((arg) => arg === name || arg.startsWith(`${name}=`));
  if (index < 0) return undefined;
  return argv[index].startsWith(`${name}=`) ? argv[index].slice(name.length + 1) : argv[index + 1];
};
export const id = () => crypto.randomUUID();
export const write = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const redact = (key, value) =>
  /authorization|token|secret|api.?key/i.test(key) ? "[redacted]" : value;
export const log = (provider, event, value) => {
  if (process.env.OZI_FAKE_LOG)
    NodeFS.appendFileSync(
      process.env.OZI_FAKE_LOG,
      `${JSON.stringify({ provider, event, pid: process.pid, ...value }, redact)}\n`,
    );
};
export function launch(provider) {
  log(provider, "launch", {
    argv,
    cwd: process.cwd(),
    env: Object.keys(process.env).filter((name) =>
      /^(OZI|T3|CODEX|CLAUDE|PI|ANTHROPIC)/.test(name),
    ),
  });
  if (argv.includes("--version")) {
    process.stdout.write(
      `${provider === "pi" ? "1.0.0" : provider === "claude" ? "2.1.288 (Claude Code)" : "codex-cli 0.162.0"}\n`,
    );
    return false;
  }
  if (argv.includes("--help")) {
    process.stdout.write(`${provider} ${argv[0]}\n`);
    return false;
  }
  if (provider === "codex" && argv[0] === "login") {
    process.stderr.write("Logged in using ChatGPT\n");
    return false;
  }
  return true;
}
export function lines(provider, receive) {
  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      try {
        const frame = JSON.parse(line);
        log(provider, "receive", { frame });
        Promise.resolve(receive(frame)).catch((error) => {
          log(provider, "error", { message: error.message });
          process.stderr.write(`${error.stack}\n`);
          process.exitCode = 1;
        });
      } catch (error) {
        process.stderr.write(`${error.stack}\n`);
        process.exitCode = 1;
      }
    }
  });
}

const parseResponse = async (response) => {
  const body = await response.text();
  if (!response.ok) throw new Error(`MCP HTTP ${response.status}: ${body}`);
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    for (const line of body.split("\n"))
      if (line.startsWith("data: ")) {
        const message = JSON.parse(line.slice(6));
        if (message.result !== undefined || message.error) return message;
      }
    throw new Error("MCP stream has no result");
  }
  return body ? JSON.parse(body) : {};
};
export function interpreter(provider, hooks) {
  let endpoint;
  let authorization;
  let session;
  let initialized;
  let tools = [];
  let instructions = "";
  let controller;
  const used = new Set();
  const pending = new Map();
  let result;
  const call = async (method, params, notification = false) => {
    if (!endpoint) throw new Error("Provider has no configured MCP endpoint");
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
        ...(authorization ? { Authorization: authorization } : {}),
        ...(session ? { "mcp-session-id": session } : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        ...(!notification ? { id: id() } : {}),
        method,
        params,
      }),
    });
    session = response.headers.get("mcp-session-id") ?? session;
    const message = await parseResponse(response);
    if (message.error) {
      if (method === "tools/call")
        return { isError: true, content: [{ type: "text", text: message.error.message }] };
      throw new Error(message.error.message);
    }
    return message.result;
  };
  const initialize = async () => {
    if (!initialized)
      initialized = (async () => {
        await call("initialize", {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: `ozi-fake-${provider}`, version: "1" },
        });
        await call("notifications/initialized", {}, true);
        tools = (await call("tools/list", {})).tools;
        log(provider, "loadout", { instructions, tools });
      })();
    return initialized;
  };
  const interpolate = (value, prompt) => {
    if (typeof value === "string") {
      if (value === "$result") return result;
      return value.replaceAll("$prompt", prompt).replace(/\$result(?:\.([\w.]+))?/g, (_, path) => {
        let current = result?.structuredContent ?? result;
        for (const segment of path?.split(".") ?? []) current = current?.[segment];
        return typeof current === "string" ? current : JSON.stringify(current);
      });
    }
    if (Array.isArray(value)) return value.map((item) => interpolate(item, prompt));
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, interpolate(item, prompt)]),
      );
    return value;
  };
  return {
    configure(config = {}, prompt = "") {
      endpoint = config.url ?? config.endpoint ?? process.env.T3_MCP_URL;
      authorization =
        config.headers?.Authorization ??
        config.http_headers?.Authorization ??
        (process.env.T3_MCP_BEARER_TOKEN ? `Bearer ${process.env.T3_MCP_BEARER_TOKEN}` : undefined);
      instructions = prompt;
      log(provider, "configuration", { config, instructions });
    },
    respond(requestId, value) {
      pending.get(requestId)?.(value);
      pending.delete(requestId);
    },
    interrupt() {
      controller?.abort();
      for (const resolve of pending.values()) resolve({ cancelled: true });
      pending.clear();
    },
    async run(prompt) {
      controller?.abort();
      const turnController = new AbortController();
      controller = turnController;
      if (endpoint) await initialize();
      const role =
        process.env.OZI_FAKE_ROLE ??
        (/\[worker\]/i.test(prompt)
          ? "worker"
          : /(?:you are|role:) [^\n]*main agent/i.test(instructions) ||
              (tools.some((tool) => tool.name === "read_skill") &&
                !tools.some((tool) => /^(?:preview_|t3_project_|t3_terminal_)/.test(tool.name)))
            ? "main"
            : "worker");
      log(provider, "prompt", { prompt, role, instructions });
      const script = process.env.OZI_FAKE_SCRIPT
        ? JSON.parse(NodeFS.readFileSync(process.env.OZI_FAKE_SCRIPT, "utf8"))
        : [];
      const rules = Array.isArray(script) ? script : script.rules;
      const index = rules.findIndex(
        (rule) =>
          !used.has(rule.id ?? JSON.stringify(rule)) &&
          (!rule.provider || rule.provider === provider) &&
          (!rule.role || rule.role === role) &&
          (!rule.stage || rule.stage === process.env.OZI_REPAIR_STAGE) &&
          Boolean(rule.stage) === Boolean(process.env.OZI_REPAIR_STAGE) &&
          new RegExp(rule.match ?? ".*", "s").test(prompt),
      );
      if (index < 0) throw new Error(`No fake ${provider} rule matches: ${prompt.slice(0, 180)}`);
      if (!rules[index].repeat) used.add(rules[index].id ?? JSON.stringify(rules[index]));
      for (const step of rules[index].steps) {
        if (turnController.signal.aborted) return;
        if (step.say !== undefined) {
          const text = interpolate(step.say, prompt);
          await hooks.say(typeof text === "string" ? text : JSON.stringify(text));
        } else if (step.tool) {
          await initialize();
          const tool = interpolate(step.tool, prompt);
          result = await call("tools/call", { name: tool.name, arguments: tool.arguments ?? {} });
          log(provider, "tool", { name: tool.name, arguments: tool.arguments, result });
          await hooks.tool?.(tool, result);
        } else if (step.ask || step.approval) {
          const requestId = id();
          const answer = new Promise((resolve) => pending.set(requestId, resolve));
          await hooks.request(requestId, step.ask ? "ask" : "approval", step.ask ?? step.approval);
          result = await answer;
          log(provider, "answer", { requestId, result });
        } else if (step.wait) {
          log(provider, "waiting", {});
          await new Promise((resolve) =>
            turnController.signal.addEventListener("abort", resolve, { once: true }),
          );
        } else if (step.fail) {
          log(provider, "failure", { message: step.fail });
          throw new Error(step.fail);
        } else if (step.exec) {
          const execution = NodeChildProcess.spawnSync("/bin/sh", ["-c", step.exec], {
            encoding: "utf8",
            timeout: 5000,
          });
          result = { stdout: execution.stdout, stderr: execution.stderr, code: execution.status };
          log(provider, "exec", result);
          await hooks.say(JSON.stringify(result));
        } else throw new Error(`Unknown fake step: ${JSON.stringify(step)}`);
      }
      if (!turnController.signal.aborted) await hooks.done();
    },
  };
}
export function sessionFile(provider, sessionId) {
  const root =
    process.env[
      provider === "codex"
        ? "CODEX_HOME"
        : provider === "claude"
          ? "CLAUDE_CONFIG_DIR"
          : "PI_CODING_AGENT_DIR"
    ];
  if (!root) throw new Error(`Fake ${provider} requires an isolated provider home`);
  const directory =
    provider === "claude"
      ? NodePath.join(root, "projects", process.cwd().replace(/[^a-zA-Z0-9]/g, "-"))
      : root;
  NodeFS.mkdirSync(directory, { recursive: true });
  return NodePath.join(directory, `${sessionId}.jsonl`);
}
