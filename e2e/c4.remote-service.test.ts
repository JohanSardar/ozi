import * as NodeChildProcess from "node:child_process";
import * as NodeEvents from "node:events";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import { expect, it } from "vite-plus/test";

const exec = NodeUtil.promisify(NodeChildProcess.execFile);
const root = NodePath.resolve(import.meta.dirname, "..");
const bin = NodePath.join(root, "apps/server/src/bin.ts");
const cli = async (home: string, ...args: string[]) => {
  const { stdout } = await exec(process.execPath, [bin, ...args, "--home", home], {
    env: { ...process.env, OZI_TELEMETRY_ENABLED: "false" },
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

it("c4.remote-pairing: direct clients exchange once, reconnect, revoke and disconnect", async () => {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "ozi-c4-"));
  const home = NodePath.join(directory, "server");
  const client = NodePath.join(directory, "client");
  const port = await freePort();
  await NodeFSP.mkdir(NodePath.join(home, "userdata"), { recursive: true });
  const started = ready(home);
  const server = NodeChildProcess.spawn(
    process.execPath,
    [bin, "serve", "--home", home, "--host", "127.0.0.1", "--port", String(port)],
    {
      cwd: directory,
      env: { ...process.env, HOME: directory, OZI_TELEMETRY_ENABLED: "false" },
      stdio: "ignore",
    },
  );
  try {
    await started;
    const pairing = await json(home, "pair");
    const connected = await json(client, "connect", pairing.pairingUrl);
    expect(connected.origin).toBe(`http://127.0.0.1:${port}/`);
    expect(connected.token).toBeUndefined();
    const saved = await NodeFSP.readFile(NodePath.join(client, "remote.json"), "utf8");
    expect(saved).not.toContain(
      new URLSearchParams(new URL(pairing.pairingUrl).hash.slice(1)).get("token"),
    );
    expect((await NodeFSP.stat(NodePath.join(client, "remote.json"))).mode & 0o777).toBe(0o600);
    expect(await json(client, "thread", "list")).toEqual([]);
    await expect(cli(client, "connect", pairing.pairingUrl, "--json")).rejects.toThrow(
      "Pairing failed",
    );
    expect(await NodeFSP.readFile(NodePath.join(client, "remote.json"), "utf8")).toBe(saved);
    await expect(cli(client, "connect", "invalid", "--json")).rejects.toThrow(
      "Invalid pairing URL",
    );
    const sessions = await json(home, "auth", "session", "list");
    const session = sessions.find(
      (item: { client: { label?: string } }) => item.client.label === "ozi cli",
    );
    expect(session).toBeDefined();
    await cli(home, "auth", "session", "revoke", session.sessionId);
    await expect(cli(client, "thread", "list", "--json")).rejects.toThrow("ozi connect");
    expect(await json(client, "disconnect")).toEqual({ disconnected: true });
    await expect(NodeFSP.access(NodePath.join(client, "remote.json"))).rejects.toThrow();
  } finally {
    const exited = NodeEvents.once(server, "exit");
    server.kill("SIGTERM");
    await exited;
    await NodeFSP.rm(directory, { recursive: true, force: true });
  }
});

it("c4.user-service: install, status, restart and uninstall a temporary unit", async () => {
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
});
