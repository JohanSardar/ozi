import * as NodeFSP from "node:fs/promises";
import { afterEach, beforeEach, expect, it } from "vite-plus/test";
import { startHarness, type Harness } from "./harness.ts";
import { createServer } from "vite-plus";
import react from "@vitejs/plugin-react";
import * as NodeURL from "node:url";

async function capturePanelStates() {
  const server = await createServer({
    configFile: false,
    root: import.meta.dirname,
    plugins: [react()],
    resolve: { alias: { "~": NodeURL.fileURLToPath(new URL("../apps/web/src", import.meta.url)) } },
    server: { host: "127.0.0.1", port: 0 },
  });
  try {
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === "string") throw new Error("No panel preview address");
    const page = await h.page();
    await page.setViewportSize({ width: 1100, height: 800 });
    await NodeFSP.mkdir("/tmp/ozi-shots", { recursive: true });
    for (const state of [
      "empty",
      "running",
      "checking",
      "question",
      "free-text",
      "approval",
      "secret",
      "ready",
      "done",
      "disconnected",
    ]) {
      await page.goto(`http://127.0.0.1:${address.port}/panel.html?state=${state}`);
      await page.getByRole("complementary", { name: "Jobs", exact: true }).waitFor();
      await page.screenshot({ path: `/tmp/ozi-shots/${state}.png` });
      expect(
        await page.evaluate(() =>
          document
            .getAnimations()
            .some((animation) => animation.effect?.getTiming().iterations === Infinity),
        ),
      ).toBe(false);
    }
  } finally {
    await server.close();
  }
}

let h: Harness;
beforeEach(async () => {
  h = await startHarness();
});
afterEach(async () => {
  await h?.close();
});

it("m2.no-thread-list opens the main conversation without project or conversation navigation", async () => {
  await h.script([
    { match: "hello-ozi", steps: [{ say: "Hello from Ozi" }] },
    { match: "ui-attachment", steps: [{ say: "File received" }] },
  ]);
  const page = await h.page();
  await page.getByRole("textbox", { name: "Message Ozi", exact: true }).waitFor();
  expect((await h.status()).main?.thread.id).toBe("ozi-main");
  expect(
    await page.getByRole("navigation", { name: /threads|projects|conversations/i }).count(),
  ).toBe(0);
  expect(
    await page
      .getByRole("button", { name: /new thread|new project|select project|worktree|branch/i })
      .count(),
  ).toBe(0);
  expect(await page.locator('[data-sidebar="sidebar"]').count()).toBe(0);
  expect(new URL(page.url()).pathname).toBe("/");
  await page.getByRole("textbox", { name: "Message Ozi", exact: true }).fill("hello-ozi");
  await page.getByRole("button", { name: "Submit message", exact: true }).click();
  await h.wait("ozi-main", "text:Hello from Ozi", 20);
  await page.getByText("Hello from Ozi", { exact: true }).waitFor();
  const file = `${h.root}/ui-note.txt`;
  await NodeFSP.writeFile(file, "A note for Ozi");
  await page.getByLabel("Attach files").setInputFiles(file);
  await page.getByRole("button", { name: "Remove ui-note.txt ×", exact: true }).waitFor();
  await page.getByRole("textbox", { name: "Message Ozi", exact: true }).fill("ui-attachment");
  await page.getByRole("button", { name: "Submit message", exact: true }).click();
  const projection = await h.wait("ozi-main", "text:File received", 20);
  expect(
    projection.messages.find((message) => message.text === "ui-attachment")?.attachments,
  ).toEqual(expect.arrayContaining([expect.objectContaining({ name: "ui-note.txt" })]));
  await page.getByText("File received", { exact: true }).waitFor();
  await NodeFSP.mkdir("/tmp/ozi-shots", { recursive: true });
  await page.screenshot({ path: "/tmp/ozi-shots/main.png" });
  await capturePanelStates();
});

it("m2.drawer opens the lead conversation while the main composer stays usable", async () => {
  await h.script([
    {
      match: "start-drawer-job",
      role: "main",
      steps: [
        {
          tool: {
            name: "delegate_task",
            arguments: {
              task: `drawer-worker-brief ${"Visit details. ".repeat(400)}`,
              title: "Arrange a visit",
              mode: "async",
              clientRequestId: "m2-drawer-worker",
            },
          },
        },
        { say: "The visit is underway" },
      ],
    },
    {
      match: "drawer-worker-brief",
      role: "worker",
      steps: [{ say: "Looking at available times" }, { wait: true }],
    },
    {
      match: "drawer-direct-message",
      role: "worker",
      steps: [{ say: "The job received **your message**" }],
    },
    {
      match: "Still usable with a job open",
      role: "main",
      steps: [{ say: "Main stayed available" }],
    },
  ]);
  await h.ozi("say", "start-drawer-job");
  await h.wait("ozi-main", "text:The visit is underway", 20);
  const jobs = await h.ozi<{ jobId: string; title: string }[]>("jobs");
  expect(jobs).toHaveLength(1);
  const job = jobs[0]!;
  await h.wait(job.jobId, "text:Looking at available times", 20);
  const page = await h.page();
  const main = page.getByRole("textbox", { name: "Message Ozi", exact: true });
  await main.fill("Keep this message");
  await main.evaluate((element) => element.setAttribute("data-main-composer", "retained"));
  await page.getByRole("button", { name: job.title, exact: true }).click();
  const drawer = page.getByRole("complementary", { name: "Job details" });
  await drawer.getByText("Looking at available times", { exact: true }).waitFor();
  await drawer.getByText("Brief from Ozi", { exact: true }).waitFor();
  const brief = await drawer
    .getByText("Brief from Ozi", { exact: true })
    .locator("..")
    .boundingBox();
  const lead = await drawer.getByRole("region", { name: "Job conversation" }).boundingBox();
  expect(lead!.height).toBeGreaterThan(brief!.height);
  expect(await main.getAttribute("data-main-composer")).toBe("retained");
  expect(await main.inputValue()).toBe("Keep this message");
  await main.fill("Still usable with a job open");
  await page
    .getByRole("region", { name: "Main conversation", exact: true })
    .getByRole("button", { name: "Submit message", exact: true })
    .click();
  await h.wait("ozi-main", "text:Main stayed available", 20);
  await main.fill("Keep this message too");
  await drawer
    .getByRole("textbox", { name: "Message this job", exact: true })
    .fill("drawer-direct-message");
  await drawer.getByRole("combobox", { name: "When to send" }).selectOption("steer");
  await drawer.getByRole("button", { name: "Submit message", exact: true }).click();
  await h.wait(job.jobId, "text:The job received", 20);
  await h.wait(job.jobId, "completed", 20);
  expect(
    (await h.thread("ozi-main")).messages.some(
      (message) => message.text === "drawer-direct-message",
    ),
  ).toBe(false);
  await NodeFSP.mkdir("/tmp/ozi-shots", { recursive: true });
  await page.screenshot({ path: "/tmp/ozi-shots/drawer.png" });
  await drawer.getByRole("button", { name: "Close drawer" }).click();
  expect(await main.inputValue()).toBe("Keep this message too");
  const card = page.locator(`[data-job-id="${job.jobId}"]`);
  await h.ozi("wait", "job", job.jobId, "ready", "--timeout", "20");
  await card.locator("strong", { hasText: "your message" }).waitFor();
  expect(await card.textContent()).not.toContain("**");
  await card.getByRole("button", { name: "Got it, close", exact: true }).click();
  await h.ozi("wait", "job", job.jobId, "done", "--timeout", "20");
  await page
    .getByRole("region", { name: "Done", exact: true })
    .getByText("Closed", { exact: true })
    .waitFor();
});
