import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import {
  desktopDir,
  resolveDevProtocolClient,
  resolveElectronLaunchCommand,
} from "./electron-launcher.mjs";
import { waitForResources } from "./wait-for-resources.mjs";

const devServerUrl = process.env.VITE_DEV_SERVER_URL?.trim();
if (!devServerUrl) {
  throw new Error("VITE_DEV_SERVER_URL is required for desktop development.");
}

const devServer = new URL(devServerUrl);
const port = Number.parseInt(devServer.port, 10);
if (!Number.isInteger(port) || port <= 0) {
  throw new Error(`VITE_DEV_SERVER_URL must include an explicit port: ${devServerUrl}`);
}

const requiredFiles = [
  "dist-electron/main.cjs",
  "dist-electron/electron/WindowsForegroundFocusWorker.cjs",
  "dist-electron/preload.cjs",
  "dist-electron/snapShot/GlobalShiftShortcutWorker.cjs",
  "dist-electron/snapShot/RegionSnapShotWorker.cjs",
  "dist-electron/snapShot/SnapShotAccessibilityWorker.cjs",
];
const watchedDirectories = [
  { directory: "dist-electron", files: new Set(["main.cjs", "preload.cjs"]) },
  {
    directory: "dist-electron/electron",
    files: new Set(["WindowsForegroundFocusWorker.cjs"]),
  },
  {
    directory: "dist-electron/snapShot",
    files: new Set([
      "GlobalShiftShortcutWorker.cjs",
      "RegionSnapShotWorker.cjs",
      "SnapShotAccessibilityWorker.cjs",
    ]),
  },
  { directory: "../server/src", recursive: true },
  ...NodeFS.readdirSync(NodePath.join(desktopDir, "../../packages"))
    .map((name) => ({ directory: `../../packages/${name}/src`, recursive: true }))
    .filter(({ directory }) => NodeFS.existsSync(NodePath.join(desktopDir, directory))),
];
const forcedShutdownTimeoutMs = 1_500;
const restartDebounceMs = 120;
const remoteDebuggingPort = process.env.OZI_DESKTOP_REMOTE_DEBUGGING_PORT?.trim();

NodeChildProcess.execFileSync(
  process.execPath,
  [NodePath.join(desktopDir, "scripts/build-browser-secret.mjs")],
  { stdio: "inherit" },
);

await waitForResources({
  baseDir: desktopDir,
  files: requiredFiles,
  tcpHost: devServer.hostname,
  tcpPort: port,
});

const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;
const automation = process.env.OZI_DESKTOP_AUTOMATION === "1";
const testArgs =
  process.env.OZI_DESKTOP_TEST === "1"
    ? process.platform === "darwin"
      ? ["--use-mock-keychain"]
      : process.platform === "linux"
        ? ["--password-store=basic", "--ozone-platform=x11"]
        : []
    : [];
const devProtocolClient = automation ? null : resolveDevProtocolClient();
if (devProtocolClient) {
  childEnv.OZI_DESKTOP_APP_USER_MODEL_ID = devProtocolClient.appBundleId;
  childEnv.OZI_DESKTOP_PROTOCOL_REGISTRATION_MANAGED = "1";
}

let shuttingDown = false;
let restartTimer = null;
let currentApp = null;
let restartQueue = Promise.resolve();
const expectedExits = new WeakSet();
const watchers = [];

function startApp() {
  if (shuttingDown || currentApp !== null) {
    return;
  }

  const electronArgs = remoteDebuggingPort
    ? [...testArgs, `--remote-debugging-port=${remoteDebuggingPort}`]
    : testArgs;
  const launchArgs = devProtocolClient
    ? electronArgs
    : [...electronArgs, `--ozi-dev-root=${desktopDir}`, "dist-electron/main.cjs"];
  const electronCommand = resolveElectronLaunchCommand(launchArgs);
  const app = NodeChildProcess.spawn(electronCommand.electronPath, electronCommand.args, {
    cwd: desktopDir,
    env: childEnv,
    stdio: "inherit",
  });

  currentApp = app;

  app.once("error", () => {
    if (currentApp === app) {
      currentApp = null;
    }

    if (!shuttingDown) {
      scheduleRestart();
    }
  });

  app.once("exit", (code, signal) => {
    if (currentApp === app) {
      currentApp = null;
    }

    const exitedAbnormally = signal !== null || code !== 0;
    if (!shuttingDown && !expectedExits.has(app) && exitedAbnormally) {
      scheduleRestart();
    }
  });
}

async function stopApp() {
  const app = currentApp;
  if (!app) {
    return;
  }

  currentApp = null;
  expectedExits.add(app);

  await new Promise((resolve) => {
    let settled = false;

    const finish = () => {
      if (settled) {
        return;
      }

      settled = true;
      resolve();
    };

    app.once("exit", finish);
    app.kill("SIGTERM");

    setTimeout(() => {
      if (settled) {
        return;
      }

      app.kill("SIGKILL");
      finish();
    }, forcedShutdownTimeoutMs).unref();
  });
}

function scheduleRestart() {
  if (shuttingDown) {
    return;
  }

  if (restartTimer) {
    clearTimeout(restartTimer);
  }

  restartTimer = setTimeout(() => {
    restartTimer = null;
    restartQueue = restartQueue
      .catch(() => undefined)
      .then(async () => {
        await stopApp();
        if (!shuttingDown) {
          startApp();
        }
      });
  }, restartDebounceMs);
}

function startWatchers() {
  for (const { directory, files, recursive = false } of watchedDirectories) {
    const watcher = NodeFS.watch(
      NodePath.join(desktopDir, directory),
      { persistent: true, recursive },
      (_eventType, filename) => {
        if (
          typeof filename !== "string" ||
          (files ? !files.has(filename) : !/\.(ts|json)$/.test(filename))
        ) {
          return;
        }

        scheduleRestart();
      },
    );

    watchers.push(watcher);
  }
}

async function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;

  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }

  for (const watcher of watchers) {
    watcher.close();
  }

  await stopApp();
  process.exit(exitCode);
}

if (automation) {
  console.log(
    `[desktop-dev] ready ${JSON.stringify({
      cwd: desktopDir,
      env: Object.fromEntries(
        [
          "XDG_CONFIG_HOME",
          "XDG_DATA_HOME",
          "XDG_CACHE_HOME",
          "OZI_HOME",
          "OZI_PORT",
          "VITE_DEV_SERVER_URL",
          "OZI_DESKTOP_DEV_NODE_PATH",
          "OZI_TELEMETRY_ENABLED",
        ].map((name) => [name, childEnv[name]]),
      ),
      ...resolveElectronLaunchCommand([...testArgs, "dist-electron/main.cjs"], {
        useLauncher: false,
      }),
    })}`,
  );
} else {
  startWatchers();
  startApp();
}

process.once("SIGINT", () => {
  void shutdown(130);
});
process.once("SIGTERM", () => {
  void shutdown(143);
});
process.once("SIGHUP", () => {
  void shutdown(129);
});
