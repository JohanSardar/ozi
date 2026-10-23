import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";
import { expect, it } from "vite-plus/test";
import { startHarness } from "./harness.ts";
import { startAnthropic } from "./fakes/anthropic.ts";

const run = NodeUtil.promisify(NodeChildProcess.execFile);

it("m8.pi-config loads main's own Pi agent directory on the next turn", async () => {
  const pi = NodeURL.fileURLToPath(new URL("./node_modules/.bin/pi", import.meta.url));
  const claude = NodeURL.fileURLToPath(new URL("./node_modules/.bin", import.meta.url));
  const fake = await startAnthropic((input) =>
    JSON.stringify(input.messages).includes("second-turn")
      ? { text: "second-ok" }
      : { text: "first-ok" },
  );
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
  try {
    await h.ozi("wait", "provider", "pi", "ready", "--timeout", "30");
    await h.ozi("say", "first-turn");
    await h.wait("ozi-main", "text:first-ok", 60);
    const first = fake.requests.length;
    const personal = NodePath.join(h.env.HOME!, ".pi/agent");
    await NodeFSP.mkdir(personal, { recursive: true });
    await NodeFSP.writeFile(
      NodePath.join(personal, "APPEND_SYSTEM.md"),
      "personal-pi-must-not-load",
    );
    const state = NodePath.join(h.root, "reminders.json");
    await NodeFSP.writeFile(state, JSON.stringify({ items: [] }));
    const fixture = NodeURL.fileURLToPath(new URL("./fixtures/todos.mjs", import.meta.url));
    const cli = NodeURL.fileURLToPath(new URL("../apps/server/dist/bin.mjs", import.meta.url));
    const added = await run(
      process.execPath,
      [
        cli,
        "pi",
        "mcp",
        "add",
        "reminders",
        "--exposure",
        "direct",
        "--",
        process.execPath,
        fixture,
        state,
      ],
      { env: h.env },
    );
    expect(added.stdout).toContain("reminders");
    const agent = NodePath.join(h.home, "caches/ozi-main-pi");
    await NodeFSP.writeFile(NodePath.join(agent, "APPEND_SYSTEM.md"), "main-pi-append-marker");
    await NodeFSP.mkdir(NodePath.join(agent, "skills/pi-demo"), { recursive: true });
    await NodeFSP.writeFile(
      NodePath.join(agent, "skills/pi-demo/SKILL.md"),
      "---\nname: pi-demo\ndescription: main-pi-skill-marker\n---\nmain-pi-skill-body",
    );
    await h.ozi("say", "second-turn");
    await h.wait("ozi-main", "text:second-ok", 90);
    const before = JSON.stringify(fake.requests.slice(0, first));
    const after = fake.requests.slice(first);
    expect(before).not.toMatch(/mcp__reminders__|main-pi-append-marker|main-pi-skill-marker/);
    expect(
      after.some((request) =>
        request.tools.some(
          (tool) => tool.name === "mcp__custom-tools__mcp__reminders__list_reminders",
        ),
      ),
    ).toBe(true);
    expect(
      after.some((request) => request.tools.some((tool) => tool.name.endsWith("__bash"))),
    ).toBe(true);
    expect(JSON.stringify(after)).toContain("main-pi-append-marker");
    expect(JSON.stringify(after)).toContain("main-pi-skill-marker");
    expect(JSON.stringify(fake.requests)).not.toContain("personal-pi-must-not-load");
  } finally {
    await h.close();
    await fake.close();
  }
});
