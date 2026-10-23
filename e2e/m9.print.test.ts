import { afterEach, beforeEach, expect, it } from "vite-plus/test";
import { startHarness, type Harness } from "./harness.ts";

let h: Harness;
beforeEach(async () => {
  h = await startHarness();
});
afterEach(async () => {
  await h?.close();
});

it("m9.print sends prompts to main and prints its replies like pi -p", async () => {
  await h.script([
    { match: "^piped-input\nsummarize$", role: "main", steps: [{ say: "summary-ok" }] },
    { match: "^first-print$", role: "main", steps: [{ say: "first-ok" }] },
    { match: "^second-print$", role: "main", steps: [{ say: "second-ok" }] },
    { match: "^json-print$", role: "main", steps: [{ say: "json-ok" }] },
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
