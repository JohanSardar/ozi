import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { expect, it } from "vite-plus/test";
import { startHarness } from "./harness.ts";

it("m9.remote-pi runs Pi commands against main's server directory from a paired client", async () => {
  const h = await startHarness({
    pi: {
      binaryPath: NodeURL.fileURLToPath(new URL("./node_modules/.bin/pi", import.meta.url)),
      env: {},
    },
  });
  try {
    const remote = NodePath.join(h.root, "remote-client");
    const pairing = await h.ozi<{ url: string }>("pair");
    await h.ozi("connect", pairing.url, "--home", remote);
    await NodeFSP.writeFile(NodePath.join(h.root, "todos.json"), JSON.stringify({ items: [] }));
    const added = await h.execOutput(
      "pi",
      "--home",
      remote,
      "mcp",
      "add",
      "remote-tool",
      "--",
      process.execPath,
      NodeURL.fileURLToPath(new URL("./fixtures/todos.mjs", import.meta.url)),
      NodePath.join(h.root, "todos.json"),
    );
    expect(added.code).toBe(0);
    expect(added.stdout).toContain("remote-tool");
    const config = await NodeFSP.readFile(
      NodePath.join(h.home, "caches/ozi-main-pi/mcp.json"),
      "utf8",
    );
    expect(JSON.parse(config).mcpServers["remote-tool"].command).toBe(process.execPath);
    await expect(NodeFSP.stat(NodePath.join(remote, "caches/ozi-main-pi"))).rejects.toThrow();
    const interactive = await h.execOutput("pi", "--home", remote);
    expect(interactive.code).toBe(1);
    expect(interactive.stdout).toBe("");
    expect(interactive.stderr).toBe("Run `ozi pi` without arguments on the server machine.\n");
    const rejected = await h.ozi<{ ok: boolean; error: string }[]>(
      "request",
      "ozi.pi.run",
      "--payload",
      JSON.stringify({ args: [] }),
      "--home",
      remote,
    );
    expect(rejected[0]?.ok).toBe(false);
    expect(rejected[0]?.error).toContain("Run `ozi pi` without arguments on the server machine.");
    const localFailure = await h.execOutput("pi", "mcp", "add");
    const remoteFailure = await h.execOutput("pi", "mcp", "add", "--home", remote);
    expect(localFailure.code).not.toBe(0);
    expect(localFailure.stderr).not.toBe("");
    expect(remoteFailure).toEqual(localFailure);
    await h.stop();
    const offline = await h.execOutput("pi", "mcp", "list");
    expect(offline.code, JSON.stringify(offline)).toBe(0);
    expect(offline.stdout).toContain("remote-tool");
  } finally {
    await h.close();
  }
});
