import {
  OrchestratorMcpDeleteScheduledTaskResult,
  OrchestratorMcpListScheduledTasksResult,
  OrchestratorMcpScheduleTaskInput,
  OrchestratorMcpScheduleTaskResult,
} from "@t3tools/contracts";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Argument, Command, Flag } from "effect/cli";

import { projectLocationFlags } from "./config.ts";
import { ThreadUsageError, withThreadTools } from "./thread.ts";

const flags = { ...projectLocationFlags, json: Flag.Boolean("json") };
const optional = (name: string) => Flag.String(name).pipe(Flag.optional);
const duration = (value: string) => {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h|d|w)$/.exec(value);
  const units: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
  };
  return match ? Number(match[1]) * units[match[2]!]! : NaN;
};
const decodeFilter = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const decodeSchedule = Schema.decodeUnknownEffect(OrchestratorMcpScheduleTaskInput);
const print = (value: unknown) => Console.log(JSON.stringify(value));

const add = Command.make("add", {
  ...flags,
  threadId: Flag.String("chat"),
  prompt: Flag.String("prompt"),
  title: optional("title"),
  every: optional("every"),
  at: optional("at"),
  days: optional("days"),
  webhook: Flag.Boolean("webhook"),
  secretRef: optional("secret-ref"),
  filters: Flag.String("filter").pipe(Flag.atLeast(0)),
  replayKey: optional("replay-key"),
  coalesceKey: optional("coalesce-key"),
  coalesceWindow: optional("coalesce-window"),
}).pipe(
  Command.withDescription("Queue scheduled prompts into a chat."),
  Command.withHandler((input) =>
    withThreadTools(input, (tools) =>
      Effect.gen(function* () {
        const every = Option.getOrUndefined(input.every);
        const at = Option.getOrUndefined(input.at);
        const days = Option.getOrUndefined(input.days);
        const secretRef = Option.getOrUndefined(input.secretRef);
        const replayKey = Option.getOrUndefined(input.replayKey);
        const coalesceKey = Option.getOrUndefined(input.coalesceKey);
        const coalesceWindow = Option.getOrUndefined(input.coalesceWindow);
        if (
          Number(every !== undefined) + Number(at !== undefined) + Number(input.webhook) !== 1 ||
          (days !== undefined && at === undefined) ||
          (!input.webhook &&
            (secretRef !== undefined ||
              input.filters.length > 0 ||
              replayKey !== undefined ||
              coalesceKey !== undefined ||
              coalesceWindow !== undefined))
        ) {
          return yield* new ThreadUsageError({
            detail:
              "Choose exactly one of --every, --at, or --webhook; --days needs --at and webhook options need --webhook.",
          });
        }
        const filters = yield* Effect.forEach(input.filters, (value) => decodeFilter(value));
        const schedule = input.webhook
          ? {
              type: "webhook",
              ...(secretRef === undefined
                ? {}
                : {
                    signature: {
                      header: "x-hub-signature-256",
                      encoding: "hex",
                      prefix: "sha256=",
                      secretRef,
                    },
                  }),
              filters,
              dedupe: {
                replayKey,
                coalesceKey,
                coalesceWindowSeconds:
                  coalesceWindow === undefined ? undefined : duration(coalesceWindow) / 1000,
              },
            }
          : every !== undefined
            ? { type: "interval", everyMs: duration(every) }
            : {
                type: "fixed_time",
                timeOfDay: at,
                ...(days === undefined ? {} : { weekdays: days.split(",").map(Number) }),
              };
        const args = yield* decodeSchedule({
          threadId: input.threadId,
          prompt: input.prompt,
          title: Option.getOrUndefined(input.title),
          schedule,
        });
        yield* print(yield* tools.call("schedule_task", args, OrchestratorMcpScheduleTaskResult));
      }),
    ),
  ),
);

const RunResult = Schema.Struct({
  taskId: Schema.String,
  threadId: Schema.NullOr(Schema.String),
  lastRunStatus: Schema.String,
  runCount: Schema.Number,
  nextRunAt: Schema.NullOr(Schema.String),
});

const action = (name: string, tool: string, schema: Schema.Decoder<unknown>) =>
  Command.make(name, { ...flags, id: Argument.String("id") }).pipe(
    Command.withHandler((input) =>
      withThreadTools(input, (tools) =>
        Effect.gen(function* () {
          yield* print(
            yield* tools.call(
              tool,
              tool === "run_scheduled_task_now"
                ? { taskId: input.id }
                : { scheduledTaskId: input.id },
              schema,
            ),
          );
        }),
      ),
    ),
  );

export const scheduleCommand = Command.make("schedule").pipe(
  Command.withSubcommands([
    add,
    action("rm", "delete_scheduled_task", OrchestratorMcpDeleteScheduledTaskResult),
    action("run", "run_scheduled_task_now", RunResult),
  ]),
);

export const schedulesCommand = Command.make("schedules", flags).pipe(
  Command.withHandler((input) =>
    withThreadTools(input, (tools) =>
      Effect.gen(function* () {
        yield* print(
          yield* tools.call("list_scheduled_tasks", {}, OrchestratorMcpListScheduledTasksResult),
        );
      }),
    ),
  ),
);
