import * as NodeFSP from "node:fs/promises";
import * as NodeHttp from "node:http";
import * as NodeReadline from "node:readline";

const file = process.argv[2];
const handle = async (message) => {
  if (message.id === undefined) return;
  const state = JSON.parse(await NodeFSP.readFile(file, "utf8"));
  if (state.mode === "offline") throw new Error("Offline fixture");
  let result;
  if (message.method === "initialize")
    result = {
      protocolVersion: message.params.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: "todos-fixture", version: "1" },
    };
  else if (message.method === "tools/list")
    result = {
      tools: [
        {
          name: "list_reminders",
          inputSchema: { type: "object", properties: {} },
        },
      ],
    };
  else if (message.method === "tools/call") {
    if (message.params.name !== "list_reminders" || message.params.arguments.list !== "inbox")
      return {
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32602, message: "Unexpected call" },
      };
    const data = {
      reminders: state.mode === "malformed" ? [{ key: "broken", name: 42 }] : state.items,
    };
    result = {
      content: [{ type: "text", text: JSON.stringify(data) }],
      ...(state.mode === "text" ? {} : { structuredContent: data }),
    };
    await NodeFSP.appendFile(`${file}.calls`, "list\n");
  } else result = {};
  return { jsonrpc: "2.0", id: message.id, result };
};

if (process.argv.includes("--http")) {
  const server = NodeHttp.createServer(async (request, response) => {
    if (request.method !== "POST") {
      response.writeHead(405).end();
      return;
    }
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const result = await handle(JSON.parse(Buffer.concat(chunks).toString()));
      response.writeHead(result ? 200 : 202, { "content-type": "application/json" });
      response.end(result ? JSON.stringify(result) : undefined);
    } catch {
      response.writeHead(503).end();
    }
  });
  server.listen(0, "127.0.0.1", () => process.send({ port: server.address().port }));
} else {
  for await (const line of NodeReadline.createInterface({ input: process.stdin })) {
    try {
      const result = await handle(JSON.parse(line));
      if (result) process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch {
      process.exit(1);
    }
  }
}
