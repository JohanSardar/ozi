import * as NodeChildProcess from "node:child_process";
import * as NodeEvents from "node:events";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import type { Harness } from "./harness.ts";

export async function startDesktopKeyring(h: Harness) {
  const children: NodeChildProcess.ChildProcess[] = [];
  const close = async () => {
    for (const child of children.toReversed()) {
      if (child.exitCode !== null || child.signalCode !== null) continue;
      const exited = NodeEvents.EventEmitter.once(child, "exit");
      child.kill("SIGKILL");
      await exited;
    }
  };
  if (Effect.runSync(HostProcess.Platform) !== "linux") return close;
  try {
    h.env.XDG_RUNTIME_DIR = NodePath.join(h.root, "runtime");
    await NodeFSP.mkdir(h.env.XDG_RUNTIME_DIR, { mode: 0o700 });
    const bus = NodeChildProcess.spawn(
      "dbus-daemon",
      ["--session", "--nofork", "--print-address=1"],
      {
        env: h.env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    children.push(bus);
    const [address] = await NodeEvents.EventEmitter.once(bus.stdout!, "data", {
      signal: AbortSignal.timeout(15_000),
    });
    h.env.DBUS_SESSION_BUS_ADDRESS = String(address).trim();
    const keyring = NodeChildProcess.spawn(
      "gnome-keyring-daemon",
      ["--foreground", "--unlock", "--components=secrets"],
      {
        env: h.env,
        stdio: ["pipe", "ignore", "pipe"],
      },
    );
    children.push(keyring);
    keyring.stdin!.end("ozi-e2e\n");
    await new Promise<void>((resolve, reject) => {
      NodeChildProcess.execFile(
        "gdbus",
        ["wait", "--session", "--timeout", "15", "org.freedesktop.secrets"],
        {
          env: h.env,
          timeout: 20_000,
        },
        (error) => (error ? reject(error) : resolve()),
      );
    });
    return close;
  } catch (error) {
    await close();
    throw error;
  }
}
