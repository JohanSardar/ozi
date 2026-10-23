import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { expect, it } from "vite-plus/test";
import { startHarness, type Projection } from "./harness.ts";
import { startAnthropic } from "./fakes/anthropic.ts";

it("m9.model-switch applies the user's model and thinking on the next real Pi turn", async () => {
  const fake = await startAnthropic((input) => ({
    text: input.system.some((block) => block.text.includes("runtime completion checker"))
      ? '{"verdict":"done","useful":false}'
      : JSON.stringify(input.messages).includes("model-after")
        ? "model-after-ok"
        : "model-before-ok",
  }));
  const h = await startHarness({
    bundled: true,
    pi: {
      binaryPath: NodeURL.fileURLToPath(new URL("./node_modules/.bin/pi", import.meta.url)),
      env: {
        PATH: [
          NodeURL.fileURLToPath(new URL("./node_modules/.bin", import.meta.url)),
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
    await h.ozi("say", "model-before");
    await h.wait("ozi-main", "text:model-before-ok", 60);
    await h.wait("ozi-main", "completed", 60);
    expect(fake.requests[0]).toMatchObject({
      model: "claude-opus-5-5",
      output_config: { effort: "high" },
    });
    const selected = await h.ozi<Projection>(
      "thread",
      "ozi-main",
      "--model",
      "claude-bridge/claude-sonnet-5-5",
      "--thinking",
      "low",
    );
    expect(selected.thread.effectiveLoadout).toMatchObject({
      provider: "pi",
      model: "claude-bridge/claude-sonnet-5-5",
      options: expect.arrayContaining([
        { id: "thinking", value: "low" },
        { id: "fastMode", value: false },
      ]),
    });
    const before = fake.requests.length;
    await h.ozi("say", "model-after");
    const result = await h.wait("ozi-main", "text:model-after-ok", 60);
    expect(result.thread.modelSelection).toEqual(selected.thread.modelSelection);
    const requests = fake.requests
      .slice(before)
      .filter((request) => JSON.stringify(request.messages).includes("model-after"));
    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests) {
      expect(request.model).toBe("claude-sonnet-5-5");
      expect(request.output_config?.effort).toBe("low");
      expect(request.speed).not.toBe("fast");
    }
  } finally {
    await h.close();
    await fake.close();
  }
});
