import {
  Box,
  CombinedAutocompleteProvider,
  KeybindingsManager,
  setKeybindings,
  TUI_KEYBINDINGS,
  type KeyId,
  Container,
  Editor,
  Input,
  Loader,
  Markdown,
  matchesKey,
  ProcessTerminal,
  SelectList,
  Spacer,
  Text,
  TuiMainScreen,
  type Component,
  type SelectItem,
} from "@earendil-works/pi-tui";
import { applyOrchestrationV2ProjectionEvent } from "@t3tools/client-runtime/state/orchestration-v2-projection";
import {
  CommandId,
  ORCHESTRATION_V2_WS_METHODS as O,
  OZI_MAIN_THREAD_ID,
  OZI_WS_METHODS as J,
  OziJobError,
  type OrchestrationV2ThreadProjection,
  type OziJobCard,
  type OziJobRequest,
  type ThreadId,
} from "@t3tools/contracts";
import { htmlRenderFromToolItem, mcpAppFromToolItem } from "@t3tools/shared/toolOutput";
import * as Cause from "effect/Cause";
import * as Config from "effect/Config";
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import { HttpClient } from "effect/http";
import { answerRequest, connect, send, type Connection } from "../client.ts";
import {
  bg,
  builtinThemes,
  editor as editorTheme,
  fg,
  markdown,
  selectList,
  useTheme,
  type PiTheme,
} from "./theme.ts";

const columns = [
  ["needs_you", "Needs you"],
  ["running", "Running"],
  ["ready", "Ready"],
  ["done", "Done"],
] as const;
const activeStatuses = new Set(["preparing", "starting", "running", "waiting"]);
const isJobError = Schema.is(OziJobError);
const errorLine = (cause: Cause.Cause<unknown>) => {
  const failure = Cause.squash(cause);
  if (isJobError(failure)) return `${failure.reason}: ${failure.detail}`;
  return (failure instanceof Error ? failure.message : String(failure)).split(/[\r\n]/)[0]!;
};

class Secret implements Component {
  value = "";
  readonly done: (value: string | null) => void;
  constructor(done: (value: string | null) => void) {
    this.done = done;
  }
  render() {
    return [` ${fg("muted", "Secret:")} ${"•".repeat(this.value.length)}`];
  }
  handleInput(data: string) {
    if (matchesKey(data, "escape")) return this.done(null);
    if (matchesKey(data, "backspace")) return void (this.value = this.value.slice(0, -1));
    if (data.startsWith("\x1b")) return;
    for (const char of data) {
      if (char === "\r" || char === "\n") return this.done(this.value);
      if (char >= " ") this.value += char;
    }
  }
  invalidate() {}
}

const tokens = (count: number) =>
  count >= 1_000_000
    ? `${(count / 1_000_000).toFixed(1)}M`
    : count >= 1000
      ? `${(count / 1000).toFixed(1)}k`
      : `${count}`;

const appKeys: Record<string, KeyId[]> = {
  "app.message.dequeue": ["alt+up"],
  "app.interrupt": ["escape"],
  "app.clear": ["ctrl+c"],
  "app.exit": ["ctrl+d"],
  "app.suspend": ["ctrl+z"],
  "app.editor.external": ["ctrl+g"],
  "app.thinking.toggle": ["ctrl+t"],
  "app.tools.expand": ["ctrl+o"],
  "app.message.followUp": ["alt+enter"],
};
const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const KeySetting = Schema.Union([Schema.String, Schema.Array(Schema.String)]);
const Keybindings = Schema.Record(Schema.String, KeySetting);
const PiSettings = Schema.Struct({
  theme: Schema.optional(Schema.String),
  themes: Schema.optional(Schema.Array(Schema.String)),
});
const Theme = Schema.Struct({
  name: Schema.optional(Schema.String),
  vars: Schema.optional(Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Number]))),
  colors: Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Number])),
});

const piAppearance = Effect.fn("ozi.tui.piAppearance")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const explicit = yield* Config.String("PI_CODING_AGENT_DIR").pipe(Config.option);
  const home = yield* Config.String("HOME").pipe(Config.withDefault(""));
  const directory = Option.getOrElse(explicit, () => path.join(home, ".pi/agent"));
  const read = <A, I>(schema: Schema.Codec<A, I>, file: string) =>
    fs
      .readFileString(file)
      .pipe(
        Effect.flatMap(decodeJson),
        Effect.flatMap(Schema.decodeUnknownEffect(schema)),
        Effect.option,
      );
  const settings = Option.getOrElse(
    yield* read(PiSettings, path.join(directory, "settings.json")),
    () => ({}) as typeof PiSettings.Type,
  );
  const keybindings = Option.getOrElse(
    yield* read(Keybindings, path.join(directory, "keybindings.json")),
    () => ({}),
  );
  const name = settings.theme ?? "system";
  let custom: PiTheme | undefined;
  if (!(name in builtinThemes) && name !== "system")
    for (const source of [path.join(directory, "themes"), ...(settings.themes ?? [])]) {
      const files = yield* fs.readDirectory(source).pipe(
        Effect.map((names) =>
          names.filter((file) => file.endsWith(".json")).map((file) => path.join(source, file)),
        ),
        Effect.orElseSucceed(() => [source]),
      );
      for (const file of files) {
        const theme = yield* read(Theme, file);
        if (
          Option.isSome(theme) &&
          (theme.value.name === name || path.basename(file, ".json") === name)
        )
          custom ??= theme.value;
      }
    }
  return { name, custom, keybindings };
});

type Env =
  | ChildProcessSpawner.ChildProcessSpawner
  | Crypto.Crypto
  | FileSystem.FileSystem
  | HttpClient.HttpClient
  | Path.Path;
type Row = { container: Container; key: string };

export const runTui = Effect.fn("ozi.tui")(function* (baseDir: Option.Option<string>) {
  const context = yield* Effect.context<Env>();
  const run = Effect.runForkWith(context);
  const done = yield* Deferred.make<void>();
  const appearance = yield* piAppearance();
  const userKeys = Object.fromEntries(
    Object.entries(appearance.keybindings).map(([id, keys]) => [
      id,
      (Array.isArray(keys) ? keys : [keys]) as KeyId[],
    ]),
  );
  setKeybindings(
    new KeybindingsManager(
      TUI_KEYBINDINGS,
      Object.fromEntries(Object.entries(userKeys).filter(([id]) => id.startsWith("tui."))),
    ),
  );
  const is = (id: string, data: string) =>
    (userKeys[id] ?? appKeys[id] ?? []).some((key) => matchesKey(data, key));
  useTheme(appearance.custom ?? builtinThemes[appearance.name] ?? builtinThemes.dark!);
  const tui = new TuiMainScreen(new ProcessTerminal());
  const chat = new Container();
  const pending = new Text("", 1, 0);
  const status = new Container();
  const area = new Container();
  const footer = new Text("", 1, 0);
  const editor = new Editor(tui, editorTheme, { paddingX: 1 });
  editor.setAutocompleteProvider(
    new CombinedAutocompleteProvider(
      [
        { name: "jobs", description: "Job cards" },
        {
          name: "attach",
          description: "Attach a file to the next message",
          argumentHint: "<path>",
        },
        { name: "stop", description: "Stop the current work" },
        { name: "quit", description: "Exit" },
      ],
      process.cwd(),
    ),
  );
  area.addChild(editor);
  for (const component of [chat, pending, status, area, footer]) tui.addChild(component);
  tui.setFocus(editor);

  let connection: Connection | null = null;
  let projection: OrchestrationV2ThreadProjection | null = null;
  let cards: ReadonlyArray<OziJobCard> | null = null;
  let view: { threadId: ThreadId; title: string } = { threadId: OZI_MAIN_THREAD_ID, title: "" };
  let files: string[] = [];
  let loader: Loader | null = null;
  let lastCtrlC = 0;
  let showThinking = true;
  let expandTools = false;
  let session: Fiber.Fiber<unknown, unknown> | null = null;
  const rows = new Map<string, Row>();
  const outputs = new Map<string, string>();

  const notice = (text: string, tone: "muted" | "red" | "yellow" = "muted") => {
    chat.addChild(new Spacer(1));
    chat.addChild(new Text(fg(tone, text), 1, 0));
    tui.requestRender();
  };

  const active = () =>
    projection?.runs.some(
      (run) =>
        activeStatuses.has(run.status) ||
        (run.completionCheck?.state === "checking" && !run.completionCheck.sourceCaptured),
    ) ?? false;
  const checking = () =>
    projection?.runs.some((run) => run.completionCheck?.state === "checking") ?? false;

  const renderStatus = () => {
    const working = active() ? "Working" : checking() ? "Checking" : null;
    if (working && !loader) {
      loader = new Loader(
        tui,
        (text) => fg("accent", text),
        (text) => fg("muted", text),
        working,
      );
      status.addChild(loader);
    } else if (working && loader) loader.setMessage(working);
    else if (!working && loader) {
      loader.stop();
      status.clear();
      loader = null;
    }
    const counts = columns
      .filter(([column]) => column !== "done")
      .map(
        ([column, label]) =>
          `${label.toLowerCase()} ${(cards ?? []).filter((card) => card.column === column).length}`,
      )
      .join(" · ");
    const where = connection ? new URL(connection.state.origin).host : "connecting…";
    const usage =
      projection?.providerTurns.findLast((turn) => turn.tokenUsage)?.tokenUsage ??
      projection?.providerThreads.findLast((thread) => thread.contextUsage)?.contextUsage ??
      undefined;
    const selection = projection?.thread.modelSelection;
    const thinking = selection?.options?.find((option) => option.id === "thinking")?.value;
    const stats = [
      ...(usage
        ? [
            `↑${tokens(usage.inputTokens ?? 0)} ↓${tokens(usage.outputTokens ?? 0)}`,
            ...(usage.maxTokens
              ? [
                  `${((usage.usedTokens / usage.maxTokens) * 100).toFixed(1)}%/${tokens(usage.maxTokens)}`,
                ]
              : []),
          ]
        : []),
      ...(selection ? [selection.model.split("/").at(-1)!] : []),
      ...(typeof thinking === "string" ? [thinking] : []),
    ].join(" · ");
    const place =
      view.threadId === OZI_MAIN_THREAD_ID ? "main" : `job: ${view.title} · esc returns to main`;
    footer.setText(
      [
        fg(
          "dim",
          `${where}${files.length ? ` · ${files.length} attached` : ""}${stats ? ` · ${stats}` : ""}`,
        ),
        fg("dim", `${place} · `) +
          fg(cards?.some((card) => card.column === "needs_you") ? "yellow" : "dim", counts),
      ].join("\n"),
    );
    tui.requestRender();
  };

  const tool = (title: string, output: string, state: "pending" | "ok" | "error") => {
    const lines = output
      .trimEnd()
      .split("\n")
      .filter((line, index, all) => all.length > 1 || line);
    const limit = expandTools ? lines.length : 10;
    const shown = lines.slice(0, limit).map((line) => fg("muted", line));
    if (lines.length > limit)
      shown.push(fg("dim", `… (${lines.length - limit} more lines, ctrl+o to expand)`));
    const box = new Box(1, 1, (text) =>
      bg(state === "pending" ? "toolPending" : state === "error" ? "toolError" : "toolOk", text),
    );
    box.addChild(new Text([fg("text", title, { bold: true }), ...shown].join("\n"), 0, 0));
    return box;
  };
  const display = (
    item: OrchestrationV2ThreadProjection["visibleTurnItems"][number]["item"],
  ): { key: string; parts: Component[] } | null => {
    const state =
      item.status === "failed" ? "error" : item.status === "completed" ? "ok" : "pending";
    if (item.type === "reasoning")
      return item.text.trim()
        ? {
            key: `${item.text}\u0000${showThinking}`,
            parts: [
              showThinking
                ? new Markdown(item.text.trim(), 1, 0, markdown, {
                    color: (content) => fg("thinking", content, { italic: true }),
                  })
                : new Text(fg("thinking", "Thinking...", { italic: true }), 1, 0),
            ],
          }
        : null;
    if (item.type === "user_message" || item.type === "assistant_message") {
      const text = [
        item.text,
        ...(item.attachments ?? []).map((file) => `_attached ${file.name}_`),
      ].join("\n\n");
      if (item.type === "user_message")
        return {
          key: text,
          parts: [
            new Markdown(text, 1, 1, markdown, {
              color: (content) => fg("text", content),
              bgColor: (content) => bg("userBg", content),
            }),
          ],
        };
      const checking =
        projection?.runs.find((run) => run.id === item.runId)?.completionCheck?.state ===
        "checking";
      return {
        key: `${text}\u0000${checking}`,
        parts: [
          new Markdown(text.trim(), 1, 0, markdown),
          ...(checking ? [new Text(fg("dim", "unchecked"), 1, 0)] : []),
        ],
      };
    }
    if (item.type === "command_execution") {
      if (
        item.outputOmitted &&
        item.status === "completed" &&
        !outputs.has(item.id) &&
        connection
      ) {
        outputs.set(item.id, "");
        run(
          connection.client[O.getTurnItem]({ threadId: item.threadId, itemId: item.id }).pipe(
            Effect.flatMap(({ item: full }) =>
              Effect.sync(() => {
                outputs.set(item.id, full?.type === "command_execution" ? (full.output ?? "") : "");
                renderConversation();
              }),
            ),
            Effect.catchCause(() => Effect.void),
          ),
        );
      }
      const output = item.output ?? outputs.get(item.id) ?? "";
      const failed = state === "error" || (item.exitCode !== undefined && item.exitCode !== 0);
      return {
        key: `${item.status}\u0000${output}\u0000${item.exitCode}\u0000${expandTools}`,
        parts: [tool(`$ ${item.input}`, output, failed ? "error" : state)],
      };
    }
    if (item.type === "file_change")
      return {
        key: `${item.status}\u0000${item.diffStr ?? item.newStr ?? ""}\u0000${expandTools}`,
        parts: [
          tool(
            `${item.title ?? "edit"} ${item.fileName}`,
            item.diffStr ?? item.newStr ?? "",
            state,
          ),
        ],
      };
    if (item.type === "dynamic_tool") {
      if (htmlRenderFromToolItem(item) || mcpAppFromToolItem(item))
        return {
          key: "desktop",
          parts: [new Text(fg("muted", "Open the desktop app to see this reply."), 1, 0)],
        };
      const input = JSON.stringify(item.input ?? {});
      const name = item.toolName ?? item.title ?? "tool";
      if (name.startsWith("mcp__t3-code__"))
        return {
          key: `${item.status}`,
          parts: [
            new Text(
              fg(
                "dim",
                `${name.slice(14)} ${input.length > 80 ? `${input.slice(0, 79)}…` : input}`,
              ),
              1,
              0,
            ),
          ],
        };
      const output =
        typeof item.output === "string" ? item.output : JSON.stringify(item.output ?? "");
      const path = (item.input as { path?: unknown } | undefined)?.path;
      return {
        key: `${item.status}\u0000${output}\u0000${expandTools}`,
        parts: [tool(`${name} ${typeof path === "string" ? path : input}`, output, state)],
      };
    }
    if (item.type === "error")
      return {
        key: item.failure.message,
        parts: [new Text(fg("red", item.failure.message), 1, 0)],
      };
    return null;
  };

  const renderConversation = () => {
    if (!projection) return;
    const seen = new Set<string>();
    for (const { item } of projection.visibleTurnItems) {
      const next = display(item);
      if (!next) continue;
      seen.add(item.id);
      let row = rows.get(item.id);
      if (!row) {
        row = { container: new Container(), key: "" };
        rows.set(item.id, row);
        chat.addChild(row.container);
      }
      if (row.key === next.key) continue;
      row.key = next.key;
      row.container.clear();
      row.container.addChild(new Spacer(1));
      for (const part of next.parts) row.container.addChild(part);
    }
    for (const [id, row] of rows)
      if (!seen.has(id)) {
        chat.removeChild(row.container);
        rows.delete(id);
      }
    const queued = projection.runs.filter((run) => run.status === "queued");
    pending.setText(
      queued
        .map(
          (run) => projection!.messages.find((message) => message.id === run.userMessageId)?.text,
        )
        .filter((text) => text !== undefined)
        .map((text) => fg("muted", `Queued: ${text}`))
        .join("\n"),
    );
    renderStatus();
  };

  const stopLoader = () => loader?.stop();
  const restoreEditor = () => {
    area.clear();
    area.addChild(editor);
    tui.setFocus(editor);
    tui.requestRender();
  };
  const show = (component: Component, focus: Component = component) => {
    area.clear();
    area.addChild(component);
    tui.setFocus(focus);
    tui.requestRender();
  };

  const waiting: Array<() => void> = [];
  const act = <A, E>(label: string, effect: (current: Connection) => Effect.Effect<A, E, Env>) => {
    const current = connection;
    if (!current) return void waiting.push(() => act(label, effect));
    run(
      effect(current).pipe(
        Effect.flatMap(() => Effect.sync(() => label && notice(label))),
        Effect.catchCause((cause) => Effect.sync(() => notice(errorLine(cause), "red"))),
      ),
    );
  };

  const watch = (current: Connection) =>
    Effect.all(
      [
        current.client[O.subscribeThread]({ threadId: view.threadId }).pipe(
          Stream.runForEach((item) =>
            Effect.sync(() => {
              if (item.kind === "snapshot") projection = item.projection;
              else if (item.kind === "event")
                projection = applyOrchestrationV2ProjectionEvent(projection, item.event);
              renderConversation();
            }),
          ),
        ),
        current.client[J.jobsSubscribe]({}).pipe(
          Stream.runForEach((next) =>
            Effect.sync(() => {
              for (const card of next)
                if (
                  card.column === "needs_you" &&
                  cards &&
                  !cards.some(
                    (before) => before.jobId === card.jobId && before.column === "needs_you",
                  )
                )
                  notice(`Needs you: ${card.title} · /jobs`, "yellow");
              cards = next;
              renderStatus();
            }),
          ),
        ),
      ],
      { concurrency: 2 },
    );

  const start = () => {
    if (session) run(Fiber.interrupt(session));
    projection = null;
    rows.clear();
    chat.clear();
    pending.setText("");
    session = run(
      Effect.scoped(
        Effect.gen(function* () {
          const current = yield* connect(baseDir);
          connection = current;
          renderStatus();
          for (const action of waiting.splice(0)) action();
          yield* watch(current);
        }),
      ).pipe(
        Effect.tapCause(() =>
          Effect.sync(() => {
            connection = null;
            renderStatus();
          }),
        ),
        Effect.retry(Schedule.spaced("1 second")),
      ),
    );
  };

  const open = (threadId: ThreadId, title: string) => {
    view = { threadId, title };
    restoreEditor();
    start();
  };

  const respond = (request: OziJobRequest, values: ReadonlyArray<string>) =>
    act("Answered.", (current) => answerRequest(current, request, values));

  const openCard = (card: OziJobCard) => {
    const box = new Container();
    box.addChild(new Spacer(1));
    box.addChild(
      new Text(
        `${fg("accent", card.title, { bold: true })} ${fg("dim", `${card.agent.provider} · ${card.status}`)}`,
        1,
        0,
      ),
    );
    if (card.report) box.addChild(new Markdown(card.report.text.trim(), 1, 1, markdown));
    for (const request of card.requests) box.addChild(new Markdown(request.prompt, 1, 1, markdown));
    const items: Array<SelectItem & { action: () => void }> = [];
    for (const request of card.requests) {
      if (request.kind === "approval")
        for (const value of ["allow", "deny"])
          items.push({
            value: `${request.id}:${value}`,
            label: value === "allow" ? "Allow" : "Deny",
            action: () => respond(request, [value]),
          });
      else if (request.kind === "secret")
        items.push({
          value: `${request.id}:secret`,
          label: "Enter secret",
          action: () => {
            const secret = new Secret((value) => {
              restoreEditor();
              if (value) respond(request, [value]);
            });
            show(secret);
          },
        });
      else if (request.kind === "login")
        items.push({
          value: `${request.id}:login`,
          label: "Sign in from the desktop app",
          action: restoreEditor,
        });
      else {
        for (const option of request.options)
          items.push({
            value: `${request.id}:${option}`,
            label: option,
            action: () => respond(request, [option]),
          });
        items.push({
          value: `${request.id}:text`,
          label: request.options.length ? "Type an answer" : "Reply",
          action: () => {
            const input = new Input();
            input.onSubmit = (value) => {
              restoreEditor();
              if (value.trim()) respond(request, [value.trim()]);
            };
            input.onEscape = restoreEditor;
            show(input);
          },
        });
      }
    }
    if (card.column !== "done")
      items.push({
        value: "close",
        label: "Close",
        action: () =>
          act("Closed.", (current) =>
            Effect.gen(function* () {
              yield* current.client[J.jobsHandle]({
                commandId: CommandId.make(yield* (yield* Crypto.Crypto).randomUUIDv4()),
                jobId: card.jobId,
                eventId: card.eventId,
                evidence: { type: "close" },
              });
            }),
          ),
      });
    if (card.column === "running" || card.column === "needs_you")
      items.push({ value: "stop", label: "Stop", action: () => stop(card.jobId) });
    items.push({
      value: "open",
      label: "Open conversation",
      action: () => open(card.jobId, card.title),
    });
    const list = new SelectList(items, 10, selectList);
    list.onSelect = (item) => {
      restoreEditor();
      items.find((candidate) => candidate.value === item.value)?.action();
    };
    list.onCancel = restoreEditor;
    box.addChild(list);
    show(box, list);
  };

  const openJobs = () => {
    if (!cards?.length) return notice("No jobs yet.");
    const items = columns.flatMap(([column, label]) =>
      cards!
        .filter((card) => card.column === column)
        .map((card) => ({
          value: card.jobId,
          label: `${label} · ${card.title}`,
          description: `${card.agent.provider} · ${card.status}`,
        })),
    );
    const list = new SelectList(items, 12, selectList, {
      minPrimaryColumnWidth: 20,
      maxPrimaryColumnWidth: 80,
    });
    list.onSelect = (item) => {
      const card = cards?.find((candidate) => candidate.jobId === item.value);
      if (card) openCard(card);
      else restoreEditor();
    };
    list.onCancel = restoreEditor;
    show(list);
  };

  const stop = (threadId: ThreadId) =>
    act("Stopped.", (current) =>
      Effect.gen(function* () {
        yield* current.client[O.dispatchCommand]({
          type: "thread.stop",
          commandId: CommandId.make(yield* (yield* Crypto.Crypto).randomUUIDv4()),
          threadId,
        });
      }),
    );

  const hotkeys = [
    "Enter send, or steer while main works · Alt+Enter queue a follow-up · Shift+Enter new line",
    "Esc stop main, or back to main · Ctrl+C clear, twice to exit · Ctrl+D exit when empty",
    "Ctrl+T show or hide thinking · Ctrl+O expand tool output · Ctrl+G external editor · Ctrl+Z suspend · Alt+Up restore queued messages",
    "/jobs job cards · /attach <path> attach a file · /stop stop · /hotkeys keys · /quit exit",
    "Other /commands go to main: Pi prompt templates, /skill:name and extension commands",
  ].join("\n");

  const redraw = () => {
    for (const row of rows.values()) row.key = "";
    renderConversation();
  };

  const externalEditor = () =>
    run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fs.makeTempDirectory();
        const file = path.join(directory, "message.md");
        yield* fs.writeFileString(file, editor.getText());
        tui.stop();
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        yield* spawner.exitCode(
          ChildProcess.make("sh", ["-c", '${VISUAL:-${EDITOR:-nano}} "$1"', "sh", file], {
            stdin: "inherit",
            stdout: "inherit",
            stderr: "inherit",
          }),
        );
        editor.setText((yield* fs.readFileString(file)).replace(/\n$/, ""));
        yield* fs.remove(directory, { recursive: true });
      }).pipe(
        Effect.catchCause((cause) => Effect.sync(() => notice(errorLine(cause), "red"))),
        Effect.ensuring(
          Effect.sync(() => {
            tui.start();
            tui.requestRender(true);
          }),
        ),
      ),
    );

  const dequeue = () => {
    const queued = projection?.runs.filter((run) => run.status === "queued") ?? [];
    if (queued.length === 0) return;
    const texts = queued.map(
      (run) => projection?.messages.find((message) => message.id === run.userMessageId)?.text ?? "",
    );
    editor.setText([editor.getText(), ...texts].filter(Boolean).join("\n\n"));
    act("", (current) =>
      Effect.forEach(
        queued,
        (run) =>
          Effect.gen(function* () {
            yield* current.client[O.dispatchCommand]({
              type: "queued-run.cancel",
              commandId: CommandId.make(yield* (yield* Crypto.Crypto).randomUUIDv4()),
              threadId: view.threadId,
              runId: run.id,
            });
          }),
        { discard: true },
      ),
    );
  };

  const submit = (raw: string, steer: boolean) => {
    const text = raw.trim();
    if (!text) return;
    if (text.startsWith("/")) {
      const [command, ...rest] = text.slice(1).split(" ");
      const argument = rest.join(" ").trim();
      if (command === "jobs") return openJobs();
      if (command === "stop") return stop(view.threadId);
      if (command === "quit") return run(Deferred.succeed(done, undefined));
      if (command === "attach" && argument) {
        files = [...files, argument];
        return renderStatus();
      }
      if (command === "hotkeys") return notice(hotkeys);
    }
    editor.addToHistory(text);
    const attached = files;
    files = [];
    renderStatus();
    act("", (current) =>
      send(
        current,
        { text, thread: Option.some(view.threadId), files: attached },
        steer ? "active" : false,
      ),
    );
  };

  editor.onSubmit = (text) => submit(text, true);
  tui.addInputListener((data) => {
    if (is("app.message.followUp", data) && area.children[0] === editor) {
      const text = editor.getText();
      editor.setText("");
      submit(text, false);
      return { consume: true };
    }
    if (is("app.clear", data)) {
      if (area.children[0] !== editor) restoreEditor();
      else if (editor.getText()) editor.setText("");
      else if (performance.now() - lastCtrlC < 1000) run(Deferred.succeed(done, undefined));
      else {
        lastCtrlC = performance.now();
        notice("Press Ctrl+C again to exit.");
      }
      tui.requestRender();
      return { consume: true };
    }
    if (area.children[0] === editor && is("app.message.dequeue", data)) {
      dequeue();
      return { consume: true };
    }
    if (area.children[0] === editor && is("app.thinking.toggle", data)) {
      showThinking = !showThinking;
      redraw();
      return { consume: true };
    }
    if (area.children[0] === editor && is("app.tools.expand", data)) {
      expandTools = !expandTools;
      redraw();
      return { consume: true };
    }
    if (area.children[0] === editor && is("app.exit", data) && !editor.getText()) {
      run(Deferred.succeed(done, undefined));
      return { consume: true };
    }
    if (area.children[0] === editor && is("app.editor.external", data)) {
      externalEditor();
      return { consume: true };
    }
    if (is("app.suspend", data)) {
      tui.stop();
      process.once("SIGCONT", () => {
        tui.start();
        tui.requestRender(true);
      });
      process.kill(process.pid, "SIGTSTP");
      return { consume: true };
    }
    if (
      is("app.interrupt", data) &&
      area.children[0] === editor &&
      !editor.isShowingAutocomplete()
    ) {
      if (view.threadId !== OZI_MAIN_THREAD_ID && !editor.getText()) open(OZI_MAIN_THREAD_ID, "");
      else if (view.threadId === OZI_MAIN_THREAD_ID && active()) stop(view.threadId);
      else return undefined;
      return { consume: true };
    }
    return undefined;
  });

  if (appearance.name === "system") {
    tui.onTerminalColorSchemeChange((scheme) => {
      useTheme(builtinThemes[scheme]!);
      tui.invalidate();
      redraw();
      renderStatus();
      tui.requestRender(true);
    });
    tui.setTerminalColorSchemeNotifications(true);
  }
  tui.start();
  start();
  renderStatus();
  yield* Deferred.await(done);
  stopLoader();
  if (session) yield* Fiber.interrupt(session);
  tui.stop();
});
