import * as NodeReadline from "node:readline";

for await (const line of NodeReadline.createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  if (request.id === undefined) continue;
  const result =
    request.method === "initialize"
      ? {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "p6-probe", version: "1.0.0" },
        }
      : request.method === "tools/list"
        ? {
            tools: [
              {
                name: "list_reminders",
                description: "List P6 test reminders",
                inputSchema: { type: "object", properties: {} },
              },
            ],
          }
        : { content: [{ type: "text", text: "P6_REMINDERS_OK" }] };
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n`);
}
