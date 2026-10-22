import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import type { PlatformError } from "effect/PlatformError";
import * as Schema from "effect/Schema";
import * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";

class ServiceError extends Schema.TaggedError<ServiceError>()("OziServiceError", {
  operation: Schema.String,
  exitCode: Schema.optional(Schema.Number),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message() {
    return `Ozi service ${this.operation} failed.`;
  }
}

export class Service extends Context.Service<
  Service,
  {
    readonly run: (
      action: "install" | "status" | "restart" | "uninstall",
    ) => Effect.Effect<unknown, ServiceError | PlatformError>;
  }
>()("t3/ozi/Service") {}

const quote = (value: string) =>
  `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%").replaceAll("$", "$$").replaceAll("\n", "\\n")}"`;

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const runner = yield* ProcessRunner.ProcessRunner;
  const environment = yield* HostProcess.Environment;
  const home = yield* HostProcess.HomeDirectory;
  const platform = yield* HostProcess.Platform;
  const executable = yield* HostProcess.ExecutablePath;
  const args = yield* HostProcess.Arguments;
  const standalone = yield* HostProcess.IsExecutable;
  const unitPath = path.join(
    environment.XDG_CONFIG_HOME ?? path.join(home, ".config"),
    "systemd/user/ozi.service",
  );
  const systemctl = Effect.fn("Service.systemctl")(function* (args: string[]) {
    return yield* runner
      .run({ command: "systemctl", args: ["--user", ...args], timeout: "15 seconds" })
      .pipe(
        Effect.mapError((cause) => new ServiceError({ operation: args[0] ?? "command", cause })),
      );
  });
  const command = Effect.fn("Service.command")(function* (args: string[]) {
    const result = yield* systemctl(args);
    if (result.code !== 0)
      return yield* new ServiceError({
        operation: args[0] ?? "command",
        exitCode: Number(result.code),
      });
  });
  const run: Service["Service"]["run"] = Effect.fn("Service.run")(function* (action) {
    const installed = yield* fs.exists(unitPath);
    if (action === "status") {
      const active =
        installed && platform === "linux"
          ? (yield* systemctl(["is-active", "ozi.service"])).code === 0
          : false;
      return { supported: platform === "linux", installed, active, unitPath };
    }
    if (platform !== "linux")
      return yield* new ServiceError({ operation: "requires systemd on Linux" });
    if (action === "install") {
      const entry = args[1];
      if (!standalone && !entry)
        return yield* new ServiceError({ operation: "has no CLI entry point" });
      const program = [
        executable,
        ...(standalone ? [] : [path.resolve(entry!)]),
        "serve",
        "--home",
        config.baseDir,
        "--data-root",
        config.dataRoot,
        "--port",
        String(config.port),
        ...(config.host ? ["--host", config.host] : []),
      ];
      const unit = [
        "[Unit]",
        "Description=Ozi",
        "After=network.target",
        "[Service]",
        "Type=simple",
        `ExecStart=${program.map(quote).join(" ")}`,
        `Environment=${quote(`PATH=${environment.PATH ?? "/usr/bin:/bin"}`)}`,
        "Restart=on-failure",
        "KillMode=mixed",
        "TimeoutStopSec=30",
        "[Install]",
        "WantedBy=default.target",
        "",
      ].join("\n");
      yield* fs.makeDirectory(path.dirname(unitPath), { recursive: true });
      yield* fs.writeFileString(unitPath, unit, { mode: 0o600 });
      yield* command(["daemon-reload"]);
      yield* command(["enable", "--now", "ozi.service"]);
      return { installed: true, unitPath };
    }
    if (action === "uninstall") {
      if (installed) {
        yield* command(["disable", "--now", "ozi.service"]);
        yield* fs.remove(unitPath);
        yield* command(["daemon-reload"]);
      }
      return { installed: false, unitPath };
    }
    if (installed) yield* command(["restart", "ozi.service"]);
    return { restarted: installed, unitPath };
  });
  return Service.of({ run });
});

export const layer = Layer.effect(Service, make);
