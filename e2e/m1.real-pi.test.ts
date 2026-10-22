import * as NodeFSP from "node:fs/promises";
import * as NodeHttp from "node:http";
import type * as NodeNet from "node:net";
import * as NodePath from "node:path";
import { OZI_MAIN_TOOL_NAMES } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { startHarness } from "./harness.ts";

interface Request {
  readonly system: string;
  readonly tools: ReadonlyArray<string>;
}

const event = (type: string, data: object) =>
  `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;

const reply = (text: string) =>
  [
    event("message_start", {
      message: {
        id: "msg_e2e",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [],
        stop_reason: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    }),
    event("content_block_start", { index: 0, content_block: { type: "text", text: "" } }),
    event("content_block_delta", { index: 0, delta: { type: "text_delta", text } }),
    event("content_block_stop", { index: 0 }),
    event("message_delta", { delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } }),
    event("message_stop", {}),
  ].join("");

it("m1.main-loadout real Pi sends the model only Ozi tools and the data-root prompt", async () => {
  const requests: Request[] = [];
  const inference = NodeHttp.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString()));
    request.on("end", () => {
      const parsed = JSON.parse(body) as {
        system: string | ReadonlyArray<{ text: string }>;
        tools?: ReadonlyArray<{ name: string }>;
      };
      requests.push({
        system:
          typeof parsed.system === "string"
            ? parsed.system
            : parsed.system.map((part) => part.text).join(""),
        tools: (parsed.tools ?? []).map((tool) => tool.name),
      });
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(reply("real-pi-ok"));
    });
  });
  await new Promise<void>((resolve) => inference.listen(0, "127.0.0.1", resolve));
  const { port } = inference.address() as NodeNet.AddressInfo;
  const h = await startHarness({ realPi: `http://127.0.0.1:${port}` });
  try {
    await h.ozi("say", "Reply with ok");
    const main = (await h.status()).main!.thread.id;
    await h.wait(main, "text:real-pi-ok", 60);
    const prompt = (
      await NodeFSP.readFile(NodePath.join(h.dataRoot, "prompt.md"), "utf8")
    ).replaceAll("{{ADHD}}", "");
    expect(requests[0]!.system).toContain(prompt.trim());
    expect(requests[0]!.tools.filter((name) => !name.startsWith("__pi_")).toSorted()).toEqual(
      OZI_MAIN_TOOL_NAMES.map((name) => `mcp__t3-code__${name}`).toSorted(),
    );
  } finally {
    await h.close();
    inference.close();
  }
});
