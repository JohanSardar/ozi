import type {
  OziCheck,
  OziJobCard,
  OziSession,
  OziTodos,
  OrchestrationV2ThreadProjection,
  ScheduledTask,
  ServerConfig,
} from "@t3tools/contracts";
import { Fix, Mistake, Replay } from "../ozi/RepairModel.ts";
import * as Schema from "effect/Schema";
import * as DateTime from "effect/DateTime";

const decodeMistakes = Schema.decodeUnknownSync(Schema.Array(Mistake));
const decodeReplays = Schema.decodeUnknownSync(Schema.Array(Replay));
const decodeFixes = Schema.decodeUnknownSync(Schema.Array(Fix));
const decodeService = Schema.decodeUnknownSync(
  Schema.Struct({
    supported: Schema.optional(Schema.Boolean),
    installed: Schema.optional(Schema.Boolean),
    active: Schema.optional(Schema.Boolean),
    restarted: Schema.optional(Schema.Boolean),
  }),
);
const line = (value: string) => value.replace(/\s+/g, " ").trim();
const interval = (milliseconds: number) => {
  for (const [unit, size] of [
    ["w", 604_800_000],
    ["d", 86_400_000],
    ["h", 3_600_000],
    ["m", 60_000],
    ["s", 1000],
  ] as const)
    if (milliseconds % size === 0) return `${milliseconds / size}${unit}`;
  return `${milliseconds}ms`;
};

const shortIds = (ids: ReadonlyArray<string>) => {
  const unique = [...new Set(ids)];
  return (id: string) => {
    let length = Math.min(8, id.length);
    while (
      length < id.length &&
      unique.some((other) => other !== id && other.endsWith(id.slice(-length)))
    )
      length++;
    return id.slice(-length);
  };
};

const messages = (projection: OrchestrationV2ThreadProjection, recent?: number) =>
  projection.messages
    .slice(recent === undefined ? 0 : -recent)
    .map(
      (message) =>
        `${message.role === "user" ? "you" : message.role === "assistant" ? "ozi" : message.role}: ${message.text}`,
    );

export const thread = (projection: OrchestrationV2ThreadProjection) => {
  const run = projection.runs.findLast((run) => run.status !== "queued");
  const selection = projection.thread.modelSelection;
  return [
    `Thread ${shortIds([projection.thread.id])(projection.thread.id)}: ${line(projection.thread.title)} (${run?.completionCheck?.state === "checking" ? "checking" : (run?.status ?? "idle")})`,
    `${selection.instanceId} ${selection.model} ${(selection.options ?? []).map((option) => `${option.id}=${option.value}`).join(" ")}`.trim(),
    ...messages(projection),
    ...Object.values(projection.thread.extensionUi?.statuses ?? {}).map(line),
    ...(projection.thread.extensionUi?.notices.slice(-3) ?? []).map(
      (notice) => `${notice.type}: ${line(notice.message)}`,
    ),
  ].join("\n");
};

export const status = (
  server: ServerConfig,
  main: OrchestrationV2ThreadProjection | null,
  origin: string,
) => {
  const run = main?.runs.findLast((run) => run.status !== "queued");
  const state =
    run?.completionCheck?.state === "checking"
      ? "checking"
      : run && ["preparing", "starting", "running", "waiting"].includes(run.status)
        ? run.status
        : "idle";
  const loadout = main?.thread.effectiveLoadout;
  const selection = main?.thread.modelSelection;
  return [
    `${line(server.environment.label)} ${server.environment.serverVersion} — connected ${origin}`,
    `Main: ${main ? state : "unavailable"}${main ? ` ${loadout?.provider ?? selection?.instanceId} ${loadout?.model ?? selection?.model} ${(loadout?.options ?? selection?.options ?? []).map((option) => `${option.id}=${option.value}`).join(" ")}` : ""}`.trim(),
    ...server.providers.map((provider) => `${provider.instanceId}: ${provider.status}`),
  ].join("\n");
};

const cardLines = (card: OziJobCard, cards: ReadonlyArray<OziJobCard>) => {
  const jobId = shortIds(cards.map((card) => card.jobId));
  const eventId = shortIds(cards.map((card) => card.eventId));
  const requestId = shortIds(cards.flatMap((card) => card.requests.map((request) => request.id)));
  return [
    `${jobId(card.jobId)} ${line(card.title)} — ${card.agent.provider}/${card.agent.model} — ${line(card.status)}${card.checking ? " (checking)" : ""} — event ${eventId(card.eventId)}`,
    ...card.requests.map(
      (request) =>
        `  ${requestId(request.id)} ${request.kind}: ${line(request.prompt)}${request.options.length ? ` [${request.options.map(line).join(" | ")}]` : ""}`,
    ),
  ];
};

export const jobs = (cards: ReadonlyArray<OziJobCard>) =>
  (
    [
      ["needs_you", "Needs you"],
      ["running", "Running"],
      ["ready", "Ready"],
      ["done", "Done"],
    ] as const
  )
    .flatMap(([column, title]) => {
      const section = cards.filter((card) => card.column === column);
      return [`${title} (${section.length})`, ...section.flatMap((card) => cardLines(card, cards))];
    })
    .join("\n");

export const job = (card: OziJobCard, lead: OrchestrationV2ThreadProjection) =>
  [
    ...cardLines(card, [card]),
    ...(card.report ? [card.report.text] : []),
    ...messages(lead, 10),
  ].join("\n");

export const checks = (rows: ReadonlyArray<OziCheck>) => {
  const id = shortIds(rows.map((row) => row.id));
  const threadId = shortIds(rows.map((row) => row.threadId));
  return (
    rows
      .map(
        (row) =>
          `${id(row.id)} ${row.state} thread ${threadId(row.threadId)} rounds ${row.rounds.length} unsuccessful ${row.unsuccessfulRounds}`,
      )
      .join("\n") || "No checks"
  );
};

export const sessions = (rows: ReadonlyArray<OziSession>) => {
  const id = shortIds(rows.map((row) => row.id));
  return (
    rows
      .map(
        (row) =>
          `${id(row.id)} ${line(row.title)} — ${row.messageCount} messages — ${DateTime.formatIso(row.updatedAt)}${row.forkedFrom ? ` — from ${id(row.forkedFrom)}` : ""}`,
      )
      .join("\n") || "No sessions"
  );
};

export const repair = (kind: "mistakes" | "replays" | "fixes", value: unknown) => {
  if (kind === "mistakes") {
    const rows = decodeMistakes(value);
    const id = shortIds(rows.map((row) => row.id));
    return (
      rows
        .map((row) => `${id(row.id)} ${row.status} ${line(row.what)} — ${line(row.why)}`)
        .join("\n") || "No mistakes"
    );
  }
  if (kind === "replays") {
    const rows = decodeReplays(value);
    const id = shortIds(rows.map((row) => row.id));
    const mistakeId = shortIds(rows.map((row) => row.mistake_id));
    return (
      rows
        .map(
          (row) =>
            `${id(row.id)} ${row.state} mistake ${mistakeId(row.mistake_id)}${row.reason ? ` ${line(row.reason)}` : ""}`,
        )
        .join("\n") || "No replays"
    );
  }
  const rows = decodeFixes(value);
  const id = shortIds(rows.map((row) => row.id));
  const commit = shortIds(rows.map((row) => row.commit_sha));
  return (
    rows
      .map(
        (row) =>
          `${id(row.id)} ${row.state} commit ${commit(row.commit_sha)}${row.conflict ? " conflict" : ""}${row.error ? ` ${line(row.error)}` : ""}`,
      )
      .join("\n") || "No fixes"
  );
};

export const schedules = (rows: ReadonlyArray<ScheduledTask>) => {
  const id = shortIds(rows.map((row) => row.id));
  return (
    rows
      .map((row) => {
        const cadence =
          row.schedule.type === "interval"
            ? `every ${interval(row.schedule.everyMs)}`
            : row.schedule.type === "fixed_time"
              ? `at ${row.schedule.timeOfDay}${row.schedule.weekdays ? ` days ${row.schedule.weekdays.join(",")}` : " daily"}`
              : "webhook";
        return `${id(row.id)} ${row.enabled ? "enabled" : "disabled"} ${line(row.title)} — ${cadence} — ${row.lastRunStatus} runs ${row.runCount}${row.nextRunAt ? ` next ${row.nextRunAt}` : ""}${row.webhook?.url ? ` ${row.webhook.url}` : ""}`;
      })
      .join("\n") || "No schedules"
  );
};

export const todos = (value: OziTodos) => {
  if (!value) return "No to-do source configured";
  const id = shortIds(value.items?.map((item) => item.id) ?? []);
  return [
    `${line(value.source)}: ${value.state}`,
    ...(value.items?.map(
      (item) =>
        `${id(item.id)} ${line(item.status)} ${line(item.title)}${item.due ? ` due ${line(item.due)}` : ""}${item.link ? ` ${item.link}` : ""}`,
    ) ?? []),
  ].join("\n");
};

export const result = (action: string, id?: string, state?: string) =>
  [action, id ? shortIds([id])(id) : "", state ? line(state) : ""].filter(Boolean).join(" ");

export const service = (action: string, value: unknown) => {
  const state = decodeService(value);
  return `Service ${action}: ${state.supported === false ? "unsupported" : state.active ? "active" : state.restarted ? "restarted" : state.installed ? "installed" : "not installed"}`;
};
