import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import { afterEach, beforeEach, expect, it } from "vite-plus/test";
import { startHarness, type Harness } from "./harness.ts";

let h: Harness;
beforeEach(async () => {
  h = await startHarness();
});
afterEach(async () => {
  await h?.close();
});

it("m9.print sends prompts and files to main and prints its replies or events like pi -p", async () => {
  await h.script([
    { match: "^piped-input\nsummarize$", role: "main", steps: [{ say: "summary-ok" }] },
    { match: "^first-print$", role: "main", steps: [{ say: "first-ok" }] },
    { match: "^second-print$", role: "main", steps: [{ say: "second-ok" }] },
    { match: "^json-print$", role: "main", steps: [{ say: "json-ok" }] },
    { match: "attached-print", role: "main", steps: [{ say: "attached-ok" }] },
    { match: "^stream-print$", role: "main", steps: [{ say: "stream-ok" }] },
    { match: "^ask-print$", role: "main", steps: [{ ask: "Which colour?" }] },
    { match: "^fail-print$", role: "main", steps: [{ fail: "print boom" }] },
  ]);
  expect(await h.pipe("piped-input\n", "-p", "summarize")).toMatchObject({
    code: 0,
    stdout: "summary-ok\n",
  });
  expect(await h.pipe("", "--print", "first-print", "second-print")).toMatchObject({
    code: 0,
    stdout: "first-ok\nsecond-ok\n",
  });
  const json = await h.pipe("", "print", "json-print", "--json");
  expect(JSON.parse(json.stdout)).toEqual({
    threadId: "ozi-main",
    runId: expect.any(String),
    status: "completed",
    text: "json-ok",
  });
  const note = NodePath.join(h.root, "note.txt");
  await NodeFSP.writeFile(note, "attached-note-content");
  expect(await h.pipe("", "-p", `@${note}`, "attached-print")).toMatchObject({
    code: 0,
    stdout: "attached-ok\n",
  });
  const sent = (await h.thread("ozi-main")).messages.findLast((message) => message.role === "user");
  expect(sent?.attachments.map((attachment) => attachment.name)).toEqual(["note.txt"]);
  const streamed = await h.pipe("", "-p", "--mode", "json", "stream-print");
  const records = streamed.stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { kind?: string });
  expect(records.at(-1)).toMatchObject({ status: "completed", text: "stream-ok" });
  expect(records.length).toBeGreaterThan(1);
  expect(records.slice(0, -1).every((record) => record.kind === "event")).toBe(true);
  const asked = await h.pipe("", "-p", "ask-print");
  expect(asked.code).toBe(1);
  expect(asked.stderr).toMatch(/Ozi is waiting for you: Which colour\? \(ozi answer \S+\)\./);
  const projection = await h.thread("ozi-main");
  const request = projection.runtimeRequests.find((entry) => entry.status === "pending")!;
  await h.ozi("answer", request.id, "blue");
  await h.wait("ozi-main", "idle", 30);
  const failed = await h.pipe("", "-p", "fail-print");
  expect(failed.code).toBe(1);
  expect(failed.stderr).toContain("Ozi run failed.");
  expect(await h.pipe("", "-p")).toMatchObject({ code: 1, stderr: "Ozi print needs a message.\n" });
});
