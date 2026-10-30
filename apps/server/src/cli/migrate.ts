import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as References from "effect/References";
import { Command, Flag } from "effect/cli";
import * as LegacyInstall from "../migration/LegacyInstall.ts";
import { baseDirFlag } from "./config.ts";

const encode = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

export const migrateCommand = Command.make("migrate", {
  fromHome: Flag.String("from-home"),
  fromDataRoot: Flag.String("from-data-root"),
  baseDir: baseDirFlag,
  dryRun: Flag.Boolean("dry-run").pipe(Flag.withDefault(false)),
  json: Flag.Boolean("json").pipe(Flag.withDefault(false)),
}).pipe(
  Command.withDescription(
    "Import a stopped old Ozi install into a fresh GUI home (default: <from-home>-gui). Keeps the source intact.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const service = yield* LegacyInstall.LegacyInstall;
      const report = yield* service
        .migrate({ ...flags, home: Option.getOrElse(flags.baseDir, () => `${flags.fromHome}-gui`) })
        .pipe(
          Effect.provideService(References.MinimumLogLevel, "Error"),
          Effect.tapError((error) => Console.error(error.message)),
        );
      yield* Console.log(
        flags.json
          ? yield* encode(report)
          : `${report.status}: ${report.chats} chats, ${report.piSessions} Pi sessions, ${report.schedules} schedules, ${report.webhooks} webhooks, ${report.secretFiles} secret files → ${report.home}\nData root: ${report.dataRoot}\n${report.files.map((file) => `${file.from} → ${file.to}`).join("\n")}`,
      );
    }).pipe(Effect.provide(LegacyInstall.layer)),
  ),
);
