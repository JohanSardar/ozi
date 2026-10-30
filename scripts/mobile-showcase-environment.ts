// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off - This host-side fixture creates an isolated local T3 environment.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import {
  OrchestrationV2AppThreadJson,
  OrchestrationV2ConversationMessageJson,
  OrchestrationV2TurnItemJson,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const SHOWCASE_THREAD_ID = "remote-command-center";
export const SHOWCASE_SCENES = [
  "threads",
  "thread",
  "terminal",
  "environments",
  "agent-activity",
] as const;
export type ShowcaseScene = (typeof SHOWCASE_SCENES)[number];
const SHOWCASE_TERMINAL_PROMPT = "\u001b[1;32m→\u001b[0m \u001b[1;36mozi\u001b[0m ";
const SHOWCASE_TERMINAL_BUFFER = [
  `${SHOWCASE_TERMINAL_PROMPT}vpr dev`,
  "",
  "  \u001b[1;32mVITE\u001b[0m \u001b[32mv7.1.1\u001b[0m  \u001b[2mready in\u001b[0m \u001b[1m1.24s\u001b[0m",
  "",
  "  \u001b[32m→\u001b[0m  \u001b[2mLocal:\u001b[0m    \u001b[4;36mhttp://127.0.0.1:5173/\u001b[0m",
  "  \u001b[32m→\u001b[0m  \u001b[2mNetwork:\u001b[0m  \u001b[4;36mhttp://192.168.1.24:5173/\u001b[0m",
  "",
  "  \u001b[32m✓ 612 passed\u001b[0m   \u001b[33m△ 2 warnings\u001b[0m   \u001b[31m✗ 0 failed\u001b[0m",
  "",
  "  \u001b[42;30m READY \u001b[0m \u001b[2mwatching for changes, press\u001b[0m \u001b[1mq\u001b[0m \u001b[2mto quit\u001b[0m",
  "",
  SHOWCASE_TERMINAL_PROMPT,
].join("\r\n");

export const SHOWCASE_ENVIRONMENTS = [
  {
    id: "moonbase-terminal",
    label: "Moonbase Terminal",
  },
  {
    id: "suspense-station",
    label: "Suspense Station",
  },
  {
    id: "kernel-cabin",
    label: "Kernel Cabin",
  },
] as const;

export const SHOWCASE_THREADS = [
  {
    id: SHOWCASE_THREAD_ID,
    environmentId: "moonbase-terminal",
    title: "Make remote coding feel local ✦",
    minutesAgo: 3,
    request:
      "Give Ozi a remote-first command center. Make three machines feel one tap away, keep agent work in sync, and make every handoff feel instant.",
    response:
      "Ozi now treats every machine like it is right here in the room. ✦\n\n- Moonbase, Suspense Station, and Kernel Cabin stay live together\n- Terminal state follows you without losing a single line\n- Agent work remains perfectly in sync across devices\n- Handoffs land before your train of thought can wander\n\nI also ran the changed workspace: **612 tests passed**.",
  },
  {
    id: "pocket-command-center",
    environmentId: "moonbase-terminal",
    title: "Put the command center in your pocket",
    minutesAgo: 21,
    state: "approval" as const,
    request: "Make switching between desktop, phone, and tablet feel like one continuous session.",
    response:
      "The handoff flow preserves the selected thread, terminal buffer, and chat context. The final motion treatment is ready for approval.",
  },
  {
    id: "buttery-suspense",
    environmentId: "suspense-station",
    title: "Make Suspense transitions buttery",
    minutesAgo: 12,
    state: "working" as const,
    request:
      "Trace the last few dropped frames in nested Suspense transitions and make them disappear.",
    response: null,
  },
  {
    id: "hydration-haikus",
    environmentId: "suspense-station",
    title: "Turn hydration warnings into haikus",
    minutesAgo: 44,
    request:
      "Keep hydration errors precise, but make the development copy unexpectedly delightful.",
    response:
      "The diagnostics still lead with the exact mismatch and component stack. A tiny optional haiku now closes the expanded explanation.",
    snoozeMinutes: 90,
  },
  {
    id: "beautiful-boot",
    environmentId: "kernel-cabin",
    title: "Make boot logs oddly beautiful",
    minutesAgo: 34,
    state: "plan" as const,
    request:
      "Design a clearer boot timeline that remains useful over serial and never hides kernel detail.",
    response:
      "The plan groups milestones without changing the underlying log stream, preserves plain-text output, and adds zero work to the hot path.",
  },
  {
    id: "patient-penguins",
    environmentId: "kernel-cabin",
    title: "Teach penguins to wait patiently",
    minutesAgo: 52,
    request: "Make delayed work easier to follow without adding noise to the scheduler trace.",
    response:
      "Delayed work now carries a concise reason through the trace, so the wait is legible without changing scheduling behavior.",
    snoozeMinutes: 8 * 60,
  },
  {
    id: "handoff-haptics",
    environmentId: "moonbase-terminal",
    title: "Tune the handoff haptics",
    minutesAgo: 5 * 60,
    settled: true,
    request: "Give the desktop-to-phone handoff a haptic that lands with the animation.",
    response:
      "The handoff now taps once as the thread lands and stays silent on failure, so the phone never celebrates a handoff that did not happen.",
  },
  {
    id: "streaming-shell",
    environmentId: "suspense-station",
    title: "Stream the shell before the data",
    minutesAgo: 28 * 60,
    settled: true,
    request: "Get the app shell painted before any data request resolves.",
    response:
      "The shell now flushes on first byte and the data boundaries hydrate underneath it, so the first paint no longer waits on the slowest query.",
  },
  {
    id: "quieter-oom",
    environmentId: "kernel-cabin",
    title: "Make the OOM killer explain itself",
    minutesAgo: 2 * 24 * 60,
    settled: true,
    request: "Make out-of-memory kills legible without adding a single allocation to the hot path.",
    response:
      "Kills now report the winning heuristic and the runner-up alongside the usual dump, assembled entirely from data the path already had.",
  },
] as const;

const decodeThread = Schema.decodeUnknownSync(OrchestrationV2AppThreadJson);
const decodeMessage = Schema.decodeUnknownSync(OrchestrationV2ConversationMessageJson);
const decodeItem = Schema.decodeUnknownSync(OrchestrationV2TurnItemJson);
const minutesBefore = (now: number, minutes: number) =>
  new Date(now - minutes * 60000).toISOString();

export async function seedShowcaseEnvironment(input: {
  readonly baseDir: string;
  readonly environmentIds?: ReadonlyArray<string>;
  readonly now?: number;
}) {
  const now = input.now ?? Date.now();
  const selected = new Set(
    input.environmentIds ?? SHOWCASE_ENVIRONMENTS.map((environment) => environment.id),
  );
  const threads = SHOWCASE_THREADS.filter((thread) => selected.has(thread.environmentId));
  if (threads.length === 0) throw new Error("Select a showcase environment.");
  const workspaceRoot = NodePath.join(input.baseDir, "workspace");
  await NodeFSP.mkdir(workspaceRoot, { recursive: true });
  await NodeFSP.writeFile(NodePath.join(workspaceRoot, "README.md"), "# Ozi showcase\n");
  const dbPath = NodePath.join(input.baseDir, "userdata", "statev2.sqlite");
  const database = new NodeSqlite.DatabaseSync(dbPath, { timeout: 30000 });
  try {
    database.exec("BEGIN IMMEDIATE");
    const event = database.prepare(
      "INSERT INTO orchestration_events (event_id,aggregate_kind,stream_id,stream_version,event_type,occurred_at,actor_kind,payload_json,metadata_json,application_event_version) VALUES (?,'thread',?,?,?,?, 'user',?,'{}',2)",
    );
    const insertThread = database.prepare(
      "INSERT INTO orchestration_v2_projection_threads (thread_id,title,default_provider,provider_instance_id,runtime_mode,interaction_mode,created_at,updated_at,payload_json) VALUES (?,?,'codex','codex','full-access','default',?,?,?)",
    );
    const insertMessage = database.prepare(
      "INSERT INTO orchestration_v2_projection_messages (message_id,thread_id,role,streaming,created_at,updated_at,payload_json) VALUES (?,?,?,0,?,?,?)",
    );
    const insertItem = database.prepare(
      "INSERT INTO orchestration_v2_projection_turn_items (turn_item_id,thread_id,ordinal,type,status,updated_at,payload_json) VALUES (?,?,?,?,'completed',?,?)",
    );
    for (const thread of threads) {
      for (const table of [
        "orchestration_v2_projection_messages",
        "orchestration_v2_projection_turn_items",
        "orchestration_v2_projection_threads",
      ])
        database.prepare(`DELETE FROM ${table} WHERE thread_id=?`).run(thread.id);
      database
        .prepare("DELETE FROM orchestration_events WHERE aggregate_kind='thread' AND stream_id=?")
        .run(thread.id);
      const createdAt = minutesBefore(now, thread.minutesAgo + 120),
        updatedAt = minutesBefore(now, thread.minutesAgo);
      const payload = {
        id: thread.id,
        title: thread.title,
        providerInstanceId: "codex",
        modelSelection: { instanceId: "codex", model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
        workingDirectory: workspaceRoot,
        activeProviderThreadId: null,
        lineage: { rootThreadId: thread.id, parentThreadId: null, relationshipToParent: null },
        forkedFrom: null,
        createdBy: "user",
        creationSource: "server",
        createdAt,
        updatedAt,
        archivedAt: null,
        settledOverride: "settled" in thread ? "settled" : null,
        settledAt: "settled" in thread ? updatedAt : null,
        snoozedUntil:
          "snoozeMinutes" in thread
            ? new Date(now + thread.snoozeMinutes * 60000).toISOString()
            : null,
        snoozedAt: "snoozeMinutes" in thread ? updatedAt : null,
        lastVisitedAt: null,
        deletedAt: null,
      };
      decodeThread(payload);
      insertThread.run(thread.id, thread.title, createdAt, updatedAt, JSON.stringify(payload));
      let version = 1;
      event.run(
        `showcase:${thread.id}:${version}`,
        thread.id,
        version,
        "thread.created",
        createdAt,
        JSON.stringify(payload),
      );
      const messages = [
        { role: "user", text: thread.request, at: minutesBefore(now, thread.minutesAgo + 5) },
        ...(thread.response === null
          ? []
          : [{ role: "assistant", text: thread.response, at: updatedAt }]),
      ];
      for (const [index, message] of messages.entries()) {
        const id = `${thread.id}:${index}`,
          at = message.at;
        const body = {
          id,
          threadId: thread.id,
          runId: null,
          nodeId: null,
          role: message.role,
          text: message.text,
          attachments: [],
          streaming: false,
          createdBy: message.role === "user" ? "user" : "agent",
          creationSource: "server",
          createdAt: at,
          updatedAt: at,
        };
        decodeMessage(body);
        insertMessage.run(id, thread.id, message.role, at, at, JSON.stringify(body));
        version++;
        event.run(
          `showcase:${thread.id}:${version}`,
          thread.id,
          version,
          "message.updated",
          at,
          JSON.stringify(body),
        );
        const item = {
          id: `${id}:item`,
          threadId: thread.id,
          runId: null,
          nodeId: null,
          providerThreadId: null,
          providerTurnId: null,
          nativeItemRef: null,
          parentItemId: null,
          ordinal: index + 1,
          status: "completed",
          title: null,
          startedAt: at,
          completedAt: at,
          updatedAt: at,
          type: message.role === "user" ? "user_message" : "assistant_message",
          messageId: id,
          text: message.text,
          ...(message.role === "user"
            ? {
                createdBy: "user",
                creationSource: "server",
                inputIntent: "turn_start",
                attachments: [],
              }
            : { streaming: false }),
        };
        decodeItem(item);
        insertItem.run(item.id, thread.id, item.ordinal, item.type, at, JSON.stringify(item));
        version++;
        event.run(
          `showcase:${thread.id}:${version}`,
          thread.id,
          version,
          "turn-item.updated",
          at,
          JSON.stringify(item),
        );
      }
    }
    database.exec("COMMIT");
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    database.close();
  }
  if (threads.some((thread) => thread.id === SHOWCASE_THREAD_ID)) {
    const terminalDirectory = NodePath.join(input.baseDir, "userdata", "logs", "terminals");
    await NodeFSP.mkdir(terminalDirectory, { recursive: true });
    await NodeFSP.writeFile(
      NodePath.join(
        terminalDirectory,
        `terminal_${Buffer.from(SHOWCASE_THREAD_ID).toString("base64url")}.log`,
      ),
      SHOWCASE_TERMINAL_BUFFER,
    );
  }
  return { dbPath, workspaceRoot };
}
