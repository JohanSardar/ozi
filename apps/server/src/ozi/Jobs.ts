import {
  OZI_MAIN_THREAD_ID,
  type OrchestrationV2Command,
  type OrchestrationV2StoredEvent,
  type OziCheck,
  isOziMain,
  OziJobError,
  RuntimeRequestId,
  type OziJobCard,
  type OziJobHandleInput,
  type OziJobRequest,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2DispatchCommandResult,
  type OrchestrationV2Run,
  type ThreadId,
} from "@t3tools/contracts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as EventStore from "../orchestration-v2/EventStore.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as CommandReceiptStore from "../orchestration-v2/CommandReceiptStore.ts";

export class Jobs extends Context.Service<
  Jobs,
  {
    readonly accept: (
      command: Extract<OrchestrationV2Command, { type: "message.dispatch" }>,
    ) => Effect.Effect<
      { sequence: number; storedEvents: ReadonlyArray<OrchestrationV2StoredEvent> } | undefined,
      OziJobError
    >;
    readonly cards: (
      mainThreadId?: ThreadId,
    ) => Effect.Effect<ReadonlyArray<OziJobCard>, OziJobError>;
    readonly subscribe: () => Stream.Stream<ReadonlyArray<OziJobCard>, OziJobError>;
    readonly handle: (
      input: OziJobHandleInput,
    ) => Effect.Effect<OrchestrationV2DispatchCommandResult, OziJobError>;
  }
>()("ozi/ozi/Jobs") {}

const isAcceptance = (text: string) =>
  /^(?:I accept (?:this|the|that) result|accepted|looks good(?:,? thanks)?|that works|approved)[.!\s]*$/i.test(
    text.trim(),
  );

const significant = (event: OrchestrationV2DomainEvent) => {
  switch (event.type) {
    case "completion.updated":
      return event.payload.state !== "checking" && event.payload.state !== "superseded";
    case "thread.created":
    case "runtime-request.updated":
      return true;
    case "provider-thread.updated":
      return event.payload.goal?.status === "blocked";
    case "message.updated":
      return (
        !event.payload.streaming &&
        !(event.payload.role === "user" && isAcceptance(event.payload.text))
      );
    case "run.created":
      return true;
    case "run.updated":
      return ["completed", "failed", "interrupted", "cancelled"].includes(event.payload.status);
    case "turn-item.updated":
      return (
        event.payload.type === "secret_request" ||
        (event.payload.type === "notification" && event.payload.outcome === "failed")
      );
    default:
      return false;
  }
};
const isJobError = Schema.is(OziJobError);

const make = Effect.gen(function* () {
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const events = yield* EventStore.EventStoreV2;
  const sink = yield* EventSink.EventSinkV2;
  const receipts = yield* CommandReceiptStore.CommandReceiptStoreV2;
  const ids = yield* IdAllocator.IdAllocatorV2;
  const sql = yield* SqlClient.SqlClient;
  const readCards = Effect.fn("Jobs.readCards")(function* (mainThreadId: ThreadId) {
    const shell = yield* projections.getShellSnapshot();
    const mains = new Set(shell.threads.filter(isOziMain).map((thread) => thread.id));
    const members = shell.threads.filter(
      (thread) =>
        thread.jobId != null &&
        thread.visibility !== "internal" &&
        thread.lineage.rootThreadId === mainThreadId,
    );
    if (!members.length) return [];
    const stored = yield* events.read().pipe(Stream.runCollect);
    const versions = new Map<string, string>();
    const important = new Set<string>();
    for (const { event } of stored) {
      if (!significant(event)) continue;
      const [key, version] =
        event.type === "run.created" || event.type === "run.updated"
          ? [`run:${event.payload.id}`, event.payload.status]
          : event.type === "message.updated"
            ? [`message:${event.payload.id}`, event.payload.text]
            : event.type === "runtime-request.updated"
              ? [`request:${event.payload.id}`, event.payload.status]
              : event.type === "provider-thread.updated"
                ? [
                    `goal:${event.payload.id}`,
                    `${event.payload.goal?.status}:${event.payload.goal?.objective}`,
                  ]
                : event.type === "turn-item.updated" && event.payload.type === "secret_request"
                  ? [`secret:${event.payload.id}`, event.payload.secretStatus]
                  : [event.id, event.id];
      if (versions.get(key) === version) continue;
      versions.set(key, version);
      important.add(event.id);
    }
    const main = yield* projections.getThreadRecords(mainThreadId, ["runs", "subagents"]);
    const cards: OziJobCard[] = [];
    for (const lead of members.filter((thread) => thread.id === thread.jobId)) {
      const threads = members.filter((thread) => thread.jobId === lead.id);
      const threadIds = new Set(threads.map((thread) => thread.id));
      const jobEvents = stored.filter((stored) => threadIds.has(stored.event.threadId));
      const current = jobEvents.findLast((stored) => important.has(stored.event.id));
      if (!current) continue;
      const requests: OziJobRequest[] = [];
      let active = false;
      let leadCheck: OziCheck | undefined;
      let unchecked = false;
      for (const thread of threads) {
        const projection = yield* projections.getThreadRecords(
          thread.id,
          ["runtimeRequests", "turnItems", "runs"],
          {
            turnItemTypes: [
              "user_input_request",
              "approval_request",
              "secret_request",
              "notification",
            ],
          },
        );
        const check = projection.runs.at(-1)?.completionCheck;
        if (thread.id === lead.id) leadCheck = check;
        unchecked ||= projection.runs.at(-1)?.status === "completed" && check?.state !== "checked";
        const verdict = check?.rounds.at(-1)?.verdict;
        if (check?.state === "blocked" || check?.state === "needs_user")
          requests.push({
            id: RuntimeRequestId.make(check.id),
            threadId: thread.id,
            kind: "blocked",
            prompt:
              check.state === "blocked"
                ? `Blocked: ${check.rounds.at(-1)?.misses.join("; ") ?? "No verified progress."}`
                : verdict?.verdict === "needs_user"
                  ? verdict.reason
                  : "Human input required.",
            options: [],
          });
        active ||= projection.runs.some((run) =>
          ["queued", "preparing", "starting", "running", "waiting"].includes(run.status),
        );
        active ||= ["preparing", "queued", "starting", "running", "waiting"].includes(
          thread.status,
        );
        active ||=
          thread.blockedOnThreadWait === true || (thread.pendingBackgroundTasks?.length ?? 0) > 0;
        if (thread.goal?.status === "blocked")
          requests.push({
            id: RuntimeRequestId.make(thread.id),
            threadId: thread.id,
            kind: "blocked",
            prompt: thread.goal.objective,
            options: [],
          });
        for (const request of projection.runtimeRequests.filter(
          (request) => request.status === "pending" && request.kind !== "dynamic_tool_call",
        )) {
          const item = projection.turnItems.find(
            (item) =>
              (item.type === "user_input_request" || item.type === "approval_request") &&
              item.requestId === request.id,
          );
          requests.push({
            id: request.id,
            threadId: thread.id,
            kind:
              request.kind === "user_input"
                ? "question"
                : request.kind === "auth_refresh"
                  ? "login"
                  : "approval",
            prompt:
              item?.type === "user_input_request"
                ? item.questions.map((question) => question.question).join("\n")
                : item?.type === "approval_request"
                  ? (item.prompt ?? item.title ?? "Approval required")
                  : "Login required",
            options:
              item?.type === "user_input_request"
                ? item.questions.flatMap((question) =>
                    question.options.map((option) => option.label),
                  )
                : item?.type === "approval_request"
                  ? ["allow", "deny"]
                  : [],
          });
        }
        for (const item of projection.turnItems) {
          if (item.type === "secret_request" && item.secretStatus === "pending")
            requests.push({
              id: RuntimeRequestId.make(item.id),
              threadId: thread.id,
              kind: "secret",
              prompt: item.reason || item.label,
              options: [],
            });
          if (item.type === "notification" && item.outcome === "failed" && !projection.runs.length)
            requests.push({
              id: RuntimeRequestId.make(item.id),
              threadId: thread.id,
              kind: "blocked",
              prompt: item.summary,
              options: [],
            });
        }
        const last = projection.runs.at(-1);
        if (thread.id === lead.id && last?.status === "interrupted")
          requests.push({
            id: RuntimeRequestId.make(last.id),
            threadId: thread.id,
            kind: "blocked",
            prompt: "Stopped",
            options: [],
          });
        if (last?.status === "failed" && !projection.runs.some((run) => run.ordinal > last.ordinal))
          requests.push({
            id: RuntimeRequestId.make(last.id),
            threadId: thread.id,
            kind: "blocked",
            prompt: thread.lastError ?? "Worker could not start",
            options: [],
          });
      }
      let request = jobEvents.findLast(
        (stored) =>
          stored.event.type === "message.updated" &&
          threads.some(
            (thread) =>
              thread.id === stored.event.threadId &&
              thread.lineage.parentThreadId !== null &&
              mains.has(thread.lineage.parentThreadId),
          ) &&
          stored.event.payload.role === "user" &&
          stored.event.payload.notification === undefined &&
          stored.event.payload.createdBy !== "system" &&
          !isAcceptance(stored.event.payload.text),
      );
      if (request?.event.type !== "message.updated" || request.event.payload.createdBy !== "user") {
        const parentId =
          threads.find((thread) => thread.id === request?.event.threadId)?.lineage.parentThreadId ??
          lead.lineage.parentThreadId ??
          mainThreadId;
        const parent =
          parentId === mainThreadId
            ? main
            : yield* projections.getThreadRecords(parentId, ["runs", "subagents"]);
        const task = parent.subagents.findLast(
          (task) => task.childThreadId !== null && threadIds.has(task.childThreadId),
        );
        const runs = new Map<string, OrchestrationV2Run>();
        if (request) {
          for (const { sequence, event } of stored) {
            if (sequence > request.sequence) break;
            if (
              event.threadId === parentId &&
              (event.type === "run.created" || event.type === "run.updated")
            )
              runs.set(event.payload.id, event.payload);
          }
        }
        const run =
          [...runs.values()].findLast((run) =>
            ["preparing", "starting", "running", "waiting"].includes(run.status),
          ) ?? parent.runs.find((run) => run.id === task?.runId);
        request =
          stored.findLast(
            (stored) =>
              stored.event.type === "message.updated" &&
              stored.event.threadId === parentId &&
              stored.event.payload.runId === run?.id &&
              stored.event.payload.role === "user" &&
              stored.event.payload.notification === undefined &&
              (request === undefined || stored.sequence <= request.sequence),
          ) ??
          stored.findLast(
            (stored) =>
              stored.event.type === "message.updated" &&
              stored.event.threadId === parentId &&
              stored.event.payload.id === run?.userMessageId,
          ) ??
          request;
      }
      const done = lead.handledEventId === current.event.id;
      const checkedEvent =
        leadCheck?.state === "checked"
          ? stored.findLast((entry) => entry.event.id === leadCheck.eventId)
          : undefined;
      const ready =
        !active &&
        !requests.length &&
        !unchecked &&
        checkedEvent !== undefined &&
        checkedEvent.sequence >= current.sequence;
      const checking = !done && !requests.length && !active && !ready;
      const column = done ? "done" : requests.length ? "needs_you" : ready ? "ready" : "running";
      if (
        lead.visibility === "quiet" &&
        !requests.length &&
        !(leadCheck?.state === "checked" && leadCheck.rounds.at(-1)?.verdict?.useful === true)
      )
        continue;
      cards.push({
        jobId: lead.id,
        eventId: current.event.id,
        title: lead.title,
        column,
        agent: {
          provider: lead.effectiveLoadout?.provider ?? lead.providerInstanceId,
          model: lead.modelSelection.model,
        },
        status: done
          ? "Closed"
          : (requests[0]?.prompt.slice(0, 160) ??
            (ready ? "Ready" : checking ? "Checking" : "Working")),
        checking,
        ...(leadCheck ? { checkState: leadCheck.state } : {}),
        requestEventId: request?.event.id ?? null,
        report:
          ready && leadCheck
            ? {
                eventId: leadCheck.eventId,
                text: leadCheck.report || "Completed.",
                useful: leadCheck.rounds.at(-1)?.verdict?.useful ?? false,
              }
            : null,
        requests,
        handledEventId: lead.handledEventId ?? null,
        updatedAt: current.event.occurredAt,
      });
    }
    return cards;
  });
  const cards: Jobs["Service"]["cards"] = (mainThreadId = OZI_MAIN_THREAD_ID) =>
    sql
      .withTransaction(readCards(mainThreadId))
      .pipe(
        Effect.mapError(
          () => new OziJobError({ reason: "UnknownJob", detail: "Could not read jobs." }),
        ),
      );
  const handle: Jobs["Service"]["handle"] = Effect.fn("Jobs.handle")(
    function* (input) {
      const previous = yield* receipts.getByCommandId(input.commandId);
      if (Option.isSome(previous)) {
        if (
          previous.value.threadId !== input.jobId ||
          previous.value.commandType !== "ozi.jobs.handle"
        )
          return yield* new OziJobError({
            reason: "WrongJob",
            detail: "Command belongs to another job.",
          });
        const handled = yield* sink.readByCommandId({ commandId: input.commandId }).pipe(
          Stream.filter(
            ({ event }) =>
              event.type === "job.handled" &&
              event.payload.eventId === input.eventId &&
              JSON.stringify(event.payload.evidence) === JSON.stringify(input.evidence),
          ),
          Stream.runHead,
        );
        if (Option.isNone(handled))
          return yield* new OziJobError({
            reason: "StaleEvent",
            detail: "Command handled a different event.",
          });
        return { sequence: previous.value.resultSequence };
      }
      const card = (yield* readCards(OZI_MAIN_THREAD_ID)).find(
        (card) => card.jobId === input.jobId,
      );
      if (!card) return yield* new OziJobError({ reason: "UnknownJob", detail: "Unknown job." });
      const event = yield* events.read().pipe(
        Stream.filter((stored) => stored.event.id === input.eventId),
        Stream.runHead,
      );
      const owner = Option.isSome(event)
        ? yield* projections.getThread(event.value.event.threadId)
        : null;
      if (owner && owner.jobId !== input.jobId)
        return yield* new OziJobError({
          reason: "WrongJob",
          detail: "Event belongs to another job.",
        });
      if (card.eventId !== input.eventId)
        return yield* new OziJobError({
          reason: "StaleEvent",
          detail: "The job has a newer event.",
        });
      if (input.evidence.type !== "close") {
        if (card.column !== "ready" || !card.report || card.requests.length)
          return yield* new OziJobError({
            reason: "InvalidEvidence",
            detail: "The report has unresolved or newer obligations.",
          });
        const evidence = input.evidence;
        const proof = yield* events.read().pipe(
          Stream.filter(({ event }) =>
            evidence.type === "verified"
              ? event.id === evidence.checkEventId &&
                event.type === "completion.updated" &&
                event.payload.state === "checked" &&
                event.payload.threadId === input.jobId
              : (event.threadId === input.jobId || event.threadId === OZI_MAIN_THREAD_ID) &&
                event.type === "turn-item.updated" &&
                event.payload.type === "user_message" &&
                event.payload.id === evidence.userMessageId &&
                event.payload.createdBy === "user" &&
                isAcceptance(event.payload.text),
          ),
          Stream.runHead,
        );
        if (
          Option.isNone(proof) ||
          (Option.isSome(event) && proof.value.sequence < event.value.sequence)
        )
          return yield* new OziJobError({
            reason: "InvalidEvidence",
            detail: "No matching completion or user acceptance exists.",
          });
      }
      const now = yield* DateTime.now;
      const result = yield* sink.commitCommand({
        commandId: input.commandId,
        threadId: input.jobId,
        commandType: "ozi.jobs.handle",
        acceptedAt: now,
        events: [
          {
            id: yield* ids.allocate.event({ threadId: input.jobId }),
            threadId: input.jobId,
            type: "job.handled",
            occurredAt: now,
            payload: input,
          },
        ],
        effects: [],
      });
      return { sequence: result.receipt.resultSequence };
    },
    (effect) =>
      sql
        .withTransaction(effect)
        .pipe(
          Effect.mapError((error) =>
            isJobError(error)
              ? error
              : new OziJobError({ reason: "UnknownJob", detail: "Could not handle job." }),
          ),
        ),
  );
  const accept: Jobs["Service"]["accept"] = Effect.fn("Jobs.accept")(
    function* (command) {
      if (
        command.createdBy !== "user" ||
        !isAcceptance(command.text) ||
        (command.attachments?.length ?? 0) > 0
      )
        return undefined;
      const previous = yield* receipts.getByCommandId(command.commandId);
      if (Option.isSome(previous)) {
        const storedEvents = yield* sink
          .readByCommandId({ commandId: command.commandId })
          .pipe(Stream.runCollect);
        if (
          storedEvents.some(({ event }) => event.type === "job.handled") &&
          storedEvents.some(
            ({ event }) =>
              event.type === "message.updated" &&
              event.payload.id === command.messageId &&
              event.payload.text === command.text,
          )
        )
          return { sequence: previous.value.resultSequence, storedEvents };
        return undefined;
      }
      const thread = yield* projections.getThread(command.threadId);
      if (thread.jobId !== thread.id) return undefined;
      const card = (yield* readCards(OZI_MAIN_THREAD_ID)).find((card) => card.jobId === thread.id);
      if (card?.column !== "ready") return undefined;
      const now = yield* DateTime.now;
      const userMessageId = ids.derive.userTurnItem({ messageId: command.messageId });
      const result = yield* sink.commitCommand({
        commandId: command.commandId,
        threadId: thread.id,
        commandType: "message.dispatch",
        acceptedAt: now,
        effects: [],
        events: [
          {
            id: yield* ids.allocate.event({ threadId: thread.id }),
            type: "message.updated",
            threadId: thread.id,
            occurredAt: now,
            payload: {
              id: command.messageId,
              threadId: thread.id,
              runId: null,
              nodeId: null,
              role: "user",
              text: command.text,
              attachments: [],
              streaming: false,
              createdBy: "user",
              creationSource: command.creationSource,
              createdAt: now,
              updatedAt: now,
            },
          },
          {
            id: yield* ids.allocate.event({ threadId: thread.id }),
            type: "turn-item.updated",
            threadId: thread.id,
            occurredAt: now,
            payload: {
              id: userMessageId,
              type: "user_message",
              threadId: thread.id,
              runId: null,
              nodeId: null,
              providerThreadId: null,
              providerTurnId: null,
              nativeItemRef: null,
              parentItemId: null,
              ordinal: 0,
              title: null,
              inputIntent: "turn_start",
              status: "completed",
              startedAt: now,
              completedAt: now,
              updatedAt: now,
              messageId: command.messageId,
              text: command.text,
              attachments: [],
              createdBy: "user",
              creationSource: command.creationSource,
            },
          },
          {
            id: yield* ids.allocate.event({ threadId: thread.id }),
            type: "job.handled",
            threadId: thread.id,
            occurredAt: now,
            payload: {
              commandId: command.commandId,
              jobId: thread.id,
              eventId: card.eventId,
              evidence: { type: "accepted", userMessageId },
            },
          },
        ],
      });
      return { sequence: result.receipt.resultSequence, storedEvents: result.storedEvents };
    },
    (effect) =>
      sql.withTransaction(effect).pipe(
        Effect.mapError((cause) =>
          isJobError(cause)
            ? cause
            : new OziJobError({
                reason: "InvalidEvidence",
                detail: "Could not record acceptance.",
              }),
        ),
      ),
  );
  return Jobs.of({
    accept,
    cards,
    handle,
    subscribe: () =>
      Stream.unwrap(
        Effect.gen(function* () {
          const sequence = yield* sink.latestSequence();
          return Stream.concat(
            Stream.fromEffect(cards()),
            sink.stream({ afterSequence: sequence, bounded: true }).pipe(
              Stream.filter(
                ({ event }) =>
                  significant(event) ||
                  event.type === "thread.metadata-updated" ||
                  event.type === "job.handled",
              ),
              Stream.mapEffect(() => cards()),
            ),
          );
        }),
      ).pipe(
        Stream.changesWith((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        Stream.mapError(
          () => new OziJobError({ reason: "UnknownJob", detail: "Jobs subscription ended." }),
        ),
      ),
  });
});

export const layer = Layer.effect(Jobs, make);
