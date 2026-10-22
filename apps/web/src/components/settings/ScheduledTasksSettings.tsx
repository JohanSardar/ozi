import { useAtomValue } from "@effect/atom-react";
import {
  OZI_MAIN_THREAD_ID,
  type EnvironmentId,
  type ScheduledTask,
  type ScheduledTaskId,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { useRef, useState } from "react";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { useEnvironmentThread } from "../../state/threads";
import { useSettingsScope } from "./SettingsScopeContext";
import { requireCommand } from "../ozi/useJobActions";
import { commandError } from "../ozi/JobPanel";

export function ScheduledTasksSettings(_target: {
  environmentId?: EnvironmentId;
  taskId?: ScheduledTaskId;
}) {
  const { environment } = useSettingsScope();
  return environment ? (
    <TaskList environmentId={environment.environmentId} />
  ) : (
    <p className="p-8">Connect to Ozi to see scheduled tasks.</p>
  );
}

function TaskList({ environmentId }: { environmentId: EnvironmentId }) {
  const result = useAtomValue(serverEnvironment.scheduledTasksLive({ environmentId, input: {} }));
  const tasks = Option.getOrNull(AsyncResult.value(result))?.tasks;
  const main = useEnvironmentThread(environmentId, OZI_MAIN_THREAD_ID);
  const projection = Option.getOrNull(main.data);
  const save = useAtomCommand(serverEnvironment.upsertScheduledTask, { reportFailure: false });
  const toggle = useAtomCommand(serverEnvironment.setScheduledTaskEnabled, {
    reportFailure: false,
  });
  const run = useAtomCommand(serverEnvironment.runScheduledTaskNow, { reportFailure: false });
  const remove = useAtomCommand(serverEnvironment.deleteScheduledTask, { reportFailure: false });
  const [title, setTitle] = useState("");
  const [editing, setEditing] = useState<ScheduledTask | null>(null);
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<"interval" | "fixed_time" | "webhook">("interval");
  const [minutes, setMinutes] = useState(60);
  const [time, setTime] = useState("09:00");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const perform = async (action: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(commandError(cause));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };
  const connected = result._tag === "Success" && !result.waiting && main.status === "live";
  const action = (task: ScheduledTask, type: "toggle" | "run" | "delete") =>
    perform(async () => {
      if (type === "toggle")
        requireCommand(
          await toggle({ environmentId, input: { id: task.id, enabled: !task.enabled } }),
        );
      else if (type === "run") requireCommand(await run({ environmentId, input: { id: task.id } }));
      else requireCommand(await remove({ environmentId, input: { id: task.id } }));
    });
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-8">
      <h1 className="text-xl font-semibold">Scheduled tasks</h1>
      {result._tag === "Failure" && (
        <p role="alert">Could not load scheduled tasks. Reconnect to try again.</p>
      )}
      {!tasks && result._tag !== "Failure" && <p role="status">Loading scheduled tasks…</p>}
      {tasks?.length === 0 && <p>No scheduled tasks yet.</p>}
      {tasks?.map((task) => (
        <article key={task.id} className="rounded-xl border border-border p-4">
          <h2 className="font-semibold">{task.title}</h2>
          <p className="whitespace-pre-wrap">{task.prompt}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {task.enabled ? "On" : "Off"} ·{" "}
            {task.nextRunAt
              ? `Next: ${new Date(task.nextRunAt).toLocaleString()}`
              : task.schedule.type === "webhook"
                ? "Runs when a request arrives"
                : "No next run"}
          </p>
          {task.lastRunError && <p role="alert">{task.lastRunError}</p>}
          {task.webhook?.url && <p className="break-all text-sm">{task.webhook.url}</p>}
          <div className="mt-3 flex gap-4">
            <button
              disabled={!connected || pending}
              onClick={() => {
                setEditing(task);
                setTitle(task.title);
                setPrompt(task.prompt);
                setMode(task.schedule.type);
                if (task.schedule.type === "interval") setMinutes(task.schedule.everyMs / 60_000);
                if (task.schedule.type === "fixed_time") setTime(task.schedule.timeOfDay);
              }}
            >
              Edit
            </button>
            {(
              [
                ["toggle", task.enabled ? "Turn off" : "Turn on"],
                ["run", "Run now"],
                ["delete", "Delete"],
              ] as const
            ).map(([type, label]) => (
              <button
                key={type}
                disabled={!connected || pending}
                onClick={() => void action(task, type)}
              >
                {label}
              </button>
            ))}
          </div>
        </article>
      ))}
      <form
        className="flex flex-col gap-3 rounded-xl border border-border p-4"
        onSubmit={(event) => {
          event.preventDefault();
          void perform(async () => {
            if (!projection) throw new Error("Reconnect before scheduling a task.");
            requireCommand(
              await save({
                environmentId,
                input: {
                  ...(editing ? { id: editing.id, requireExisting: true } : {}),
                  title,
                  prompt,
                  enabled: editing?.enabled ?? true,
                  threadId: OZI_MAIN_THREAD_ID,
                  projectId: projection.thread.projectId,
                  workspaceStrategy: { type: "root" },
                  modelSelection: projection.thread.modelSelection,
                  runtimeMode: projection.thread.runtimeMode,
                  interactionMode: projection.thread.interactionMode,
                  schedule:
                    mode === "interval"
                      ? { type: "interval", everyMs: minutes * 60_000 }
                      : mode === "fixed_time"
                        ? {
                            ...(editing?.schedule.type === "fixed_time" ? editing.schedule : {}),
                            type: "fixed_time",
                            timeOfDay: time,
                          }
                        : editing?.schedule.type === "webhook"
                          ? editing.schedule
                          : { type: "webhook" },
                },
              }),
            );
            setTitle("");
            setPrompt("");
            setEditing(null);
          });
        }}
      >
        <h2 className="font-semibold">{editing ? "Edit task" : "Add a task"}</h2>
        <label>
          Name
          <input
            className="block w-full rounded border border-border bg-card p-2"
            required
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label>
          What should Ozi do?
          <textarea
            className="block w-full rounded border border-border bg-card p-2"
            required
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
          />
        </label>
        <label>
          When
          <select
            className="ml-3 rounded border border-border bg-card p-2"
            value={mode}
            onChange={(event) => setMode(event.target.value as typeof mode)}
          >
            <option value="interval">At intervals</option>
            <option value="fixed_time">Every day</option>
            <option value="webhook">When a request arrives</option>
          </select>
        </label>
        {mode === "interval" && (
          <label>
            Every{" "}
            <input
              aria-label="Minutes"
              className="w-20 rounded border border-border bg-card p-2"
              type="number"
              min="1"
              required
              value={minutes}
              onChange={(event) => setMinutes(Number(event.target.value))}
            />{" "}
            minutes
          </label>
        )}
        {mode === "fixed_time" && (
          <label>
            Time{" "}
            <input
              aria-label="Time"
              type="time"
              required
              value={time}
              onChange={(event) => setTime(event.target.value)}
            />
          </label>
        )}
        <button
          className="self-start rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
          disabled={!connected || pending || !title.trim() || !prompt.trim()}
        >
          {editing ? "Save task" : "Add task"}
        </button>
        {editing && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setEditing(null);
              setTitle("");
              setPrompt("");
            }}
          >
            Cancel editing
          </button>
        )}
      </form>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
