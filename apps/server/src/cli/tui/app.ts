import {
  CombinedAutocompleteProvider,
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
import { HttpClient } from "effect/http";
import { answerRequest, connect, send, type Connection } from "../client.ts";
import { bg, editor as editorTheme, fg, markdown, selectList } from "./theme.ts";

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

type Env = Crypto.Crypto | FileSystem.FileSystem | HttpClient.HttpClient | Path.Path;
type Row = { container: Container; body: Markdown | Text; note: Text; key: string };

export const runTui = Effect.fn("ozi.tui")(function* (baseDir: Option.Option<string>) {
  const context = yield* Effect.context<Env>();
  const run = Effect.runForkWith(context);
  const done = yield* Deferred.make<void>();
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
  let session: Fiber.Fiber<unknown, unknown> | null = null;
  const rows = new Map<string, Row>();

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
    const place =
      view.threadId === OZI_MAIN_THREAD_ID ? "main" : `job: ${view.title} · esc returns to main`;
    footer.setText(
      [
        fg("dim", `${where}${files.length ? ` · ${files.length} attached` : ""}`),
        fg("dim", `${place} · `) +
          fg(cards?.some((card) => card.column === "needs_you") ? "yellow" : "dim", counts),
      ].join("\n"),
    );
    tui.requestRender();
  };

  const renderConversation = () => {
    if (!projection) return;
    const seen = new Set<string>();
    for (const { item } of projection.visibleTurnItems) {
      let text: string | null = null;
      let note = "";
      let user = false;
      if (item.type === "user_message" || item.type === "assistant_message") {
        user = item.type === "user_message";
        text = [
          item.text,
          ...(item.attachments ?? []).map((file) => `_attached ${file.name}_`),
        ].join("\n\n");
        if (
          !user &&
          projection.runs.find((run) => run.id === item.runId)?.completionCheck?.state ===
            "checking"
        )
          note = fg("dim", "unchecked");
      } else if (
        item.type === "dynamic_tool" &&
        (htmlRenderFromToolItem(item) || mcpAppFromToolItem(item))
      )
        note = fg("muted", "Open the desktop app to see this reply.");
      else if (item.type === "error") note = fg("red", item.failure.message);
      else continue;
      seen.add(item.id);
      const key = `${text ?? ""}\u0000${note}`;
      const existing = rows.get(item.id);
      if (existing) {
        if (existing.key !== key) {
          if (text !== null) existing.body.setText(user ? text : text.trim());
          existing.note.setText(note);
          existing.key = key;
        }
        continue;
      }
      const container = new Container();
      const body =
        text === null
          ? new Text("", 0, 0)
          : user
            ? new Markdown(text, 1, 1, markdown, {
                color: (content) => fg("text", content),
                bgColor: (content) => bg("userBg", content),
              })
            : new Markdown(text.trim(), 1, 0, markdown);
      const noteText = new Text(note, 1, 0);
      container.addChild(new Spacer(1));
      container.addChild(body);
      container.addChild(noteText);
      rows.set(item.id, { container, body, note: noteText, key });
      chat.addChild(container);
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
    const list = new SelectList(items, 12, selectList);
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
      return notice(`Unknown command: /${command}`, "red");
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
    if (matchesKey(data, "alt+enter") && area.children[0] === editor) {
      const text = editor.getText();
      editor.setText("");
      submit(text, false);
      return { consume: true };
    }
    if (matchesKey(data, "ctrl+c")) {
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
    if (matchesKey(data, "escape") && area.children[0] === editor && !editor.getText()) {
      if (view.threadId !== OZI_MAIN_THREAD_ID) open(OZI_MAIN_THREAD_ID, "");
      else if (active()) stop(view.threadId);
      return { consume: true };
    }
    return undefined;
  });

  tui.start();
  start();
  renderStatus();
  yield* Deferred.await(done);
  stopLoader();
  if (session) yield* Fiber.interrupt(session);
  tui.stop();
});
