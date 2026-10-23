import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { expect, it } from "vite-plus/test";
import { startHarness, type Projection } from "./harness.ts";
import { startAnthropic } from "./fakes/anthropic.ts";

it("m9.extension-ui persists Pi UI updates and answers main's dialogs", async () => {
  const pi = NodeURL.fileURLToPath(new URL("./node_modules/.bin/pi", import.meta.url));
  const claude = NodeURL.fileURLToPath(new URL("./node_modules/.bin", import.meta.url));
  const fake = await startAnthropic();
  const h = await startHarness({
    bundled: true,
    pi: {
      binaryPath: pi,
      env: {
        PATH: [
          claude,
          NodeURL.fileURLToPath(new URL("./fakes", import.meta.url)),
          NodePath.dirname(process.execPath),
          "/usr/bin",
          "/bin",
        ].join(":"),
        ANTHROPIC_BASE_URL: fake.url,
        ANTHROPIC_API_KEY: "ozi-test-only",
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      },
    },
  }).catch(async (error: unknown) => {
    await fake.close();
    throw error;
  });
  const answer = async (title: string, value?: string) => {
    const projection = await h.wait("ozi-main", `request:${title}`, 60);
    const item = projection.turnItems.findLast(
      (item) =>
        (item.type === "user_input_request" || item.type === "approval_request") &&
        item.title === title,
    );
    if (item?.type !== "user_input_request" && item?.type !== "approval_request")
      throw new Error(`Missing dialog ${title}`);
    await h.ozi("answer", item.requestId, ...(value === undefined ? ["--cancel"] : [value]));
    return item;
  };
  try {
    await h.ozi("wait", "provider", "pi", "ready", "--timeout", "30");
    const extensions = NodePath.join(h.home, "caches/ozi-main-pi/extensions");
    await NodeFSP.mkdir(extensions, { recursive: true });
    await NodeFSP.writeFile(
      NodePath.join(extensions, "ui-demo.js"),
      `
export default function (pi) {
  pi.on("session_start", (_event, ctx) => ctx.ui.setStatus("session", "Ready"));
  pi.registerCommand("ui-demo", {
    description: "Exercise RPC extension UI",
    handler: async (_args, ctx) => {
      ctx.ui.notify("demo-info");
      ctx.ui.notify("demo-warning", "warning");
      ctx.ui.notify("demo-error", "error");
      ctx.ui.setStatus("demo", "Working");
      ctx.ui.setStatus("keep", "Retained");
      ctx.ui.setWidget("above", ["First", "Second"]);
      ctx.ui.setWidget("below", ["Below"], { placement: "belowEditor" });
      ctx.ui.setTitle("Demo title");
      ctx.ui.setEditorText("Draft\\nsecond line");
      const choice = await ctx.ui.select("Demo select", ["Alpha", "Beta"]);
      const text = await ctx.ui.editor("Demo editor", "Initial\\ntext");
      const input = await ctx.ui.input("Demo input", "Enter text");
      const allowed = await ctx.ui.confirm("Demo allow", "Continue?");
      const denied = await ctx.ui.confirm("Demo deny", "Continue?");
      const selectCancelled = await ctx.ui.select("Cancel select", ["Alpha"]);
      const editorCancelled = await ctx.ui.editor("Cancel editor", "Prefill");
      const inputCancelled = await ctx.ui.input("Cancel input");
      const confirmCancelled = await ctx.ui.confirm("Cancel confirm", "Continue?");
      ctx.ui.setStatus("demo", undefined);
      ctx.ui.setWidget("above", undefined);
      for (let index = 0; index < 24; index++) ctx.ui.notify("burst-" + index);
      ctx.ui.notify("answers:" + JSON.stringify({ choice, text, input, allowed, denied,
        selectCancelled: selectCancelled === undefined,
        editorCancelled: editorCancelled === undefined,
        inputCancelled: inputCancelled === undefined, confirmCancelled }));
    },
  });
}
`,
    );
    await h.ozi("say", "/ui-demo");
    const initial = await h.wait("ozi-main", "request:Demo select", 60);
    expect(initial.thread.extensionUi).toMatchObject({
      statuses: { demo: "Working", keep: "Retained" },
      widgets: {
        above: { lines: ["First", "Second"], placement: "aboveEditor" },
        below: { lines: ["Below"], placement: "belowEditor" },
      },
      title: "Demo title",
      editorText: { text: "Draft\nsecond line", at: expect.any(String) },
      notices: [
        { message: "demo-info", type: "info", id: expect.any(String), at: expect.any(String) },
        {
          message: "demo-warning",
          type: "warning",
          id: expect.any(String),
          at: expect.any(String),
        },
        { message: "demo-error", type: "error", id: expect.any(String), at: expect.any(String) },
      ],
    });
    const select = await answer("Demo select", "Beta");
    expect(
      select.type === "user_input_request" &&
        select.questions[0]?.options.map((option) => option.value),
    ).toEqual(["Alpha", "Beta"]);
    const editor = await answer("Demo editor", "Edited\nmultiple lines");
    expect(editor.type === "user_input_request" && editor.questions[0]).toMatchObject({
      initialAnswer: "Initial\ntext",
      options: [],
    });
    await answer("Demo input", "");
    await answer("Demo allow", "allow");
    await answer("Demo deny", "deny");
    await answer("Cancel select");
    await answer("Cancel editor");
    await answer("Cancel input");
    await answer("Cancel confirm");
    const final = await h.wait("ozi-main", "notice:answers:", 60);
    const ui = final.thread.extensionUi!;
    expect(JSON.parse(ui.notices.at(-1)!.message.slice(8))).toEqual({
      choice: "Beta",
      text: "Edited\nmultiple lines",
      input: "",
      allowed: true,
      denied: false,
      selectCancelled: true,
      editorCancelled: true,
      inputCancelled: true,
      confirmCancelled: false,
    });
    expect(ui.statuses).toEqual({ session: "Ready", keep: "Retained" });
    expect(ui.widgets).toEqual({ below: { lines: ["Below"], placement: "belowEditor" } });
    expect(ui.notices).toHaveLength(20);
    expect(ui.notices[0]?.message).toBe("burst-5");
    expect(final.runtimeRequests.every((request) => request.status !== "pending")).toBe(true);
    await h.restart();
    expect((await h.ozi<Projection>("thread", "ozi-main")).thread.extensionUi).toEqual(ui);
  } finally {
    await h.close();
    await fake.close();
  }
});
