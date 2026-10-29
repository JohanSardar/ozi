import * as NodeChildProcess from "node:child_process";
import * as NodeEvents from "node:events";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import { afterAll, describe, expect, it } from "vite-plus/test";

const exec = NodeUtil.promisify(NodeChildProcess.execFile);
const root = NodePath.resolve(import.meta.dirname, "..");
const bin = NodePath.join(root, "apps/server/src/bin.ts");
const systemdE2E = process.env.OZI_C4_SYSTEMD_E2E === "1";
const cli = async (home: string, ...args: string[]) => {
  const { stdout } = await exec(process.execPath, [bin, ...args, "--home", home], {
    cwd: NodePath.dirname(home),
    env: {
      ...process.env,
      HOME: systemdE2E ? NodeOS.homedir() : NodePath.dirname(home),
      OZI_HOME: "",
      OZI_TELEMETRY_ENABLED: "false",
    },
    timeout: 30_000,
  });
  return stdout;
};
const json = async (home: string, ...args: string[]) =>
  JSON.parse(await cli(home, ...args, "--json"));

async function freePort() {
  const server = NodeNet.createServer();
  server.listen(0, "127.0.0.1");
  await NodeEvents.once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("No TCP address");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

function ready(home: string, previousPid?: number) {
  return new Promise<{ pid: number }>((resolve, reject) => {
    const stateDir = NodePath.join(home, "userdata");
    const controller = new AbortController();
    const finish = (error?: Error, state?: { pid: number }) => {
      controller.abort();
      if (error) reject(error);
      else resolve(state!);
    };
    const check = async () => {
      try {
        const state = JSON.parse(
          await NodeFSP.readFile(NodePath.join(stateDir, "server-runtime.json"), "utf8"),
        );
        if (state.pid === previousPid) return;
        const response = await fetch(`${state.origin}/.well-known/ozi/environment`);
        if (response.ok) finish(undefined, state);
      } catch {}
    };
    NodeFS.watch(stateDir, { signal: controller.signal }, () => void check()).unref();
    void check();
  });
}

describe("c4.remote-client", () => {
  let directory: string;
  let home: string;
  let port: number;
  let server: NodeChildProcess.ChildProcess | undefined;

  it("c4.remote-server: start an isolated pairing server", async () => {
    directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "ozi-c4-"));
    home = NodePath.join(directory, "server");
    port = await freePort();
    await NodeFSP.mkdir(NodePath.join(home, "userdata"), { recursive: true });
    const started = ready(home);
    server = NodeChildProcess.spawn(
      process.execPath,
      [bin, "serve", "--home", home, "--host", "127.0.0.1", "--port", String(port), "--no-browser"],
      {
        cwd: directory,
        env: { ...process.env, HOME: directory, OZI_TELEMETRY_ENABLED: "false" },
        stdio: "ignore",
      },
    );
    await started;
    await exec("git", ["init", directory]);
    await cli(home, "project", "add", directory);
  });

  afterAll(async () => {
    if (server?.exitCode === null) {
      const exited = NodeEvents.once(server, "exit");
      server.kill("SIGTERM");
      await exited;
    }
    if (directory) await NodeFSP.rm(directory, { recursive: true, force: true });
  });

  async function connectClient() {
    const client = await NodeFSP.mkdtemp(NodePath.join(directory, "client-"));
    const pairing = await json(home, "pair");
    const connected = await json(client, "connect", pairing.pairingUrl);
    return { client, pairing, connected };
  }

  it("c4.remote-pairing: exchange once, keep an owner-only session and reject invalid links", async () => {
    const { client, pairing, connected } = await connectClient();
    expect(connected.origin).toBe(`http://127.0.0.1:${port}/`);
    expect(connected.token).toBeUndefined();
    const file = NodePath.join(client, "remote.json");
    const saved = await NodeFSP.readFile(file, "utf8");
    expect(saved).not.toContain(
      new URLSearchParams(new URL(pairing.pairingUrl).hash.slice(1)).get("token"),
    );
    expect((await NodeFSP.stat(file)).mode & 0o777).toBe(0o600);
    expect(await json(client, "thread", "list", "--project", directory)).toEqual([]);
    await expect(
      NodeFSP.access(NodePath.join(client, "userdata", "statev2.sqlite")),
    ).rejects.toThrow();
    await expect(cli(client, "connect", pairing.pairingUrl, "--json")).rejects.toThrow(
      "Pairing failed",
    );
    expect(await NodeFSP.readFile(file, "utf8")).toBe(saved);
    await expect(cli(client, "connect", "invalid", "--json")).rejects.toThrow(
      "Invalid pairing URL",
    );
  });

  it("c4.remote-expiry: expired or malformed sessions ask to connect again", async () => {
    const { client } = await connectClient();
    const file = NodePath.join(client, "remote.json");
    const saved = JSON.parse(await NodeFSP.readFile(file, "utf8"));
    await NodeFSP.writeFile(file, JSON.stringify({ ...saved, expiresAt: 0 }));
    await expect(cli(client, "thread", "list", "--json")).rejects.toThrow("Remote session expired");
    await NodeFSP.writeFile(file, "invalid");
    await expect(cli(client, "thread", "list", "--json")).rejects.toThrow(
      "Saved connection is invalid",
    );
  });

  it("c4.remote-revocation: revoked access fails and a fresh pairing reconnects", async () => {
    const previous = new Set(
      (await json(home, "auth", "session", "list")).map(
        (session: { sessionId: string }) => session.sessionId,
      ),
    );
    const { client } = await connectClient();
    const sessions = await json(home, "auth", "session", "list");
    const session = sessions.find(
      (item: { sessionId: string; client: { label?: string } }) =>
        item.client.label === "ozi cli" && !previous.has(item.sessionId),
    );
    expect(session).toBeDefined();
    await cli(home, "auth", "session", "revoke", session.sessionId);
    await expect(cli(client, "thread", "list", "--project", directory, "--json")).rejects.toThrow(
      "ozi connect",
    );
    const fresh = await json(home, "pair");
    await json(client, "connect", fresh.pairingUrl);
    expect(await json(client, "thread", "list", "--project", directory)).toEqual([]);
    expect(await json(client, "disconnect")).toEqual({ disconnected: true });
    await expect(NodeFSP.access(NodePath.join(client, "remote.json"))).rejects.toThrow();
  });

  it("c4.remote-scopes: read-only pairing permits reads and denies launching work", async () => {
    const client = await NodeFSP.mkdtemp(NodePath.join(directory, "client-"));
    const pairing = await json(home, "pair", "--scope", "orchestration:read");
    await json(client, "connect", pairing.pairingUrl, "--access", "read-only");
    expect(await json(client, "thread", "list", "--project", directory)).toEqual([]);
    await expect(
      cli(client, "thread", "start", directory, "Cannot start from a read-only session", "--json"),
    ).rejects.toThrow();
  });

  it("c4.local-priority: a live local server takes precedence over a saved remote", async () => {
    await NodeFSP.writeFile(NodePath.join(home, "remote.json"), "invalid");
    expect(await json(home, "thread", "list", "--project", directory)).toEqual([]);
  });
});

it.runIf(systemdE2E)(
  "c4.user-service: install, status, restart and uninstall a temporary unit",
  async () => {
    const home = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "ozi-c4-service-"));
    const unit = `ozi-c4-${process.pid}-${crypto.randomUUID()}.service`;
    const args = ["--unit", unit];
    await NodeFSP.mkdir(NodePath.join(home, "userdata"), { recursive: true });
    await NodeFSP.writeFile(
      NodePath.join(home, "service.env"),
      `OZI_PORT=${await freePort()}\nOZI_HOST=127.0.0.1\nOZI_TELEMETRY_ENABLED=false\n`,
      { mode: 0o600 },
    );
    try {
      expect((await json(home, "service", "status", ...args)).installed).toBe(false);
      const started = ready(home);
      const installed = await json(home, "service", "install", "--current-runtime", ...args);
      expect(installed.changed).toBe(true);
      const first = await started;
      const status = await json(home, "service", "status", ...args);
      expect(status.current).toBe(true);
      expect(status.problems).toEqual([]);
      expect(status.unitPath).toBe(NodePath.join(NodeOS.homedir(), ".config/systemd/user", unit));
      const unitText = await NodeFSP.readFile(status.unitPath, "utf8");
      expect(unitText).toContain(`OZI_BOOT_SERVICE_UNIT=${unit}`);
      expect(unitText).toContain(`OZI_HOME=${home}`);
      expect(await json(home, "service", "install", ...args)).toMatchObject({ changed: false });
      const restarted = ready(home, first.pid);
      expect(await json(home, "service", "restart", ...args)).toEqual({ outcome: "restarted" });
      expect((await restarted).pid).not.toBe(first.pid);
      expect((await json(home, "pair")).pairingUrl).toContain("/pair#token=");
      expect(await json(home, "service", "uninstall", ...args)).toEqual({ removed: true });
      expect((await json(home, "service", "status", ...args)).installed).toBe(false);
      await expect(NodeFSP.access(status.unitPath)).rejects.toThrow();
      expect(await NodeFSP.readFile(NodePath.join(home, "service.env"), "utf8")).toContain(
        "OZI_PORT=",
      );
      await expect(
        cli(home, "service", "status", "--unit", "../unsafe.service", "--json"),
      ).rejects.toThrow();
    } finally {
      await json(home, "service", "uninstall", ...args);
      await NodeFSP.rm(home, { recursive: true, force: true });
    }
  },
);
