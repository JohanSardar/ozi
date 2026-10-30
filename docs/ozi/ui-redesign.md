# UI redesign

Ozi splits into a GUI that runs any harness and the Ozi harness. The GUI moves to T3 Code v0.1.5's interface with an Ozi inbox. A clickable prototype with fake data comes first; the real build follows it.

## Repositories

- **GUI, `ozi`**: a fresh fork of T3 Code v0.1.5 with the desktop app, web app, server, `ozi` CLI and terminal app. It keeps every T3 provider, including ACP agents; any chat can use any harness, and Ozi is the default. Its MCP server gives every harness the same tools: HTML replies, the shared browser, threads, delegation, schedules, attachments and the inbox.
- **Harness, `ozi-harness`**: this repository, renamed. Ozi's main agent is Pi plus an Ozi package with `system.md`, `adhd.md`, skills, self-repair, completion checks and delegation behaviour. Harness-only commands are `ozi-harness …`. The GUI runs it through T3's Pi adapter; an ACP entry point comes later.
- The split is the first step of the rebuild. The live server keeps the current build until the new one matches it.

## Base

- Port the client onto T3 Code v0.1.5's own components: sidebar, chat view, work log, composer, attachments (images, video, files), queued runs, settings window, themes. Copy their code; remove projects, git, worktrees, diffs and devices.
- Rename `t3` to `ozi` in the MCP server name, tool names (`t3_thread_*`, `t3_queue_*`, …) and descriptions, which also lose T3 examples and project wording.
- Nothing may sit under the macOS window buttons; the sidebar header keeps their native 90-point inset clear, including after zoom and reload. Desktop automation runs under Xvfb on Linux with Playwright Electron; the macOS layout is forced there for verification. Test-only keychain switches stay in the dev launcher.
- No pills, coloured dots or monospace capital labels. Working shows as a thin spinner; labels are plain sentence case.

## Layout

Three columns: chats, conversation, inbox.

### Chats (left)

- Search, New chat, then sections Needs you, Working, Pinned and Recent; each chat appears once, in the first that fits. Rows show the title and the time, or a spinner while working.
- No folders, projects or bots. Settings and the avatar sit at the bottom.

### Conversation (center)

- As T3: user messages are bubbles on the right; assistant text is plain and full width, centered in a 46rem column.
- The top bar shows the chat title and, while it works, a spinner with the elapsed time.
- Tool work folds into one "Worked for 1m 20s" row; it expands to steps, and each step to its details.
- A delegated job shows as a line "↳ ‹job› · waiting on you" that opens its ticket.
- Hovering or selecting assistant text offers Reply; the quote sits above the composer and goes with the message.
- Composer as T3: one composer for new and existing chats, attachments, model and thinking picker. While the agent works, Enter steers and ⌘Enter queues; Stop shows when the composer is empty. Queued messages sit right-aligned above the composer with send now, edit and remove.

### Sessions (C3)

- Chats are T3 threads. Sessions in the chat header offers New chat, Clone, Fork, Reload, Pi import/export and a searchable resume list. New chat retains the current model and options with no history. Clone copies the conversation; Fork selects a user message, keeps the history before it and puts its text in the new composer's draft. The source stays unchanged.
- Resume opens an existing thread and unarchives it. Reload releases an idle provider session; the next message resumes its native history. Clone, fork, reload and export require an idle chat.
- Pi imports upload file content and copy it into server-owned storage. They display the active branch and resume its full native context, including tool history. JSONL export preserves Pi's file; HTML export uses Pi. Downloads and CLI output files are written on the client.
- `ozi session new|list|show|clone|fork|resume|import|export|reload` exposes the same operations with `--json`. `fork <id> <message-id>` gets IDs from `session show`. `new` and `import` accept `--thread <id>` to inherit a chat's model, or paired `--provider` and `--model` flags. Without either they use the configured default model.
- Session and print commands prefer a live local server, then the paired remote. Remote sessions require full-access pairing and use a session-only endpoint; restricted and peer credentials cannot use it. Import reads and export writes files on the client.
- `ozi -p`, `ozi --print` and `ozi print` send prompts sequentially and print each run's last reply. `--thread` selects a chat; otherwise the latest chat is used, creating one if needed. Piped stdin joins the first prompt. `@file` and repeated `--file` attach files to that prompt. `--json` prints `{threadId, runId, status, text}`; `--mode json` streams stored events before each result. Failed, interrupted, cancelled or question-blocked runs exit nonzero; a question names the `ozi answer` command. The GUI has no fixed main thread; C2 owns terminal navigation.

### Inbox (right)

- One inbox for every chat, with Inbox and Archive tabs.
- Tickets are grouped under Decide (questions and approvals), Do (things only the user can do, such as a BankID login), Review (finished work) and Read (nothing to do), each with a count. The heading is the only type marker; rows carry no icons.
- A row shows the ticket title and its chat and age, and opens in place: one bold line saying what the user needs to do, the context, numbered choices (keys 1–3) when there is a choice, a reply box, Got it and Open details. The first ticket starts open; clearing one opens the next.
- Open details shows the ticket in a window over the app, like T3's settings: the full context, details, choices, the session transcript and job, and a reply box at the bottom. Clicking outside closes it; sending closes it.
- Running jobs sit in a collapsed Working section at the bottom.

## Tickets

- Every agent the GUI runs, main and workers, always has `ticket_create`, `ticket_update`, `ticket_close` and `ticket_list` from the GUI's MCP server, with descriptions saying when to use them, and may file tickets at any time. The GUI stores and displays tickets and never creates one itself; tickets are structured data, not HTML.
- A ticket has a visible part (group Decide, Do, Review or Read; a short title; one line saying what the user needs to do; a 2–4 line summary), a clickable part (up to about four choices, each a label and a one-line detail) and an in-depth part (full markdown detail, attachments and HTML pages). The GUI attaches the session transcript, chat, job, worker and message IDs from the calling session itself.
- A ticket is anything that needs the user's answer or acknowledgement: a question, an approval, something only the user can do, a finished result, a failure, or something the user should see. Small talk gets none.
- An inbox plugin per harness adds a stop hook. When an agent ends a turn, the hook forks its session on the same harness and model with full context and prompts the fork: file a ticket, with everything in it, for anything from this turn that needs the user's answer or acknowledgement; close the listed open tickets the user's last message acknowledged; file nothing if nothing fits. The main session's history and behaviour are untouched and the user can reply at once; tickets appear when the fork finishes. Forks do not run the hook. Claude Code uses its Stop hook with `--resume --fork-session`, Codex its `stop` hook with `thread/fork`, and Pi a turn-end extension with `--fork`; the Ozi harness ships the plugin in its package. Harnesses without hooks use the tools without the check. The check shows as one quiet "Inbox check · 1 filed" step in the work log.
- Choosing an option answers the asking agent directly and adds a one-line note to the chat.
- A typed reply, from the row, the window or the archive, always goes into the chat the user is in, never an old thread. It shows a "↩ ticket" quote. The agent receives the ticket text, a fuller summary of its origin, a link to that session's transcript and the IDs it needs to read more.
- A ticket clears when answered, replied to, acknowledged with Got it, or closed by an agent after the user acknowledged it in chat; the chat then shows "✓ Closed: ‹title›".
- Cleared tickets go to the archive with what cleared them. The archive is searchable and replyable.
- New tickets raise a desktop notification and a dock badge; both can be turned off in Settings → General.
- The old build's read-only external to-dos are not carried over: a scheduled chat that uses that MCP source files Do tickets instead.

## Look

- T3's design, slightly squarer: 6–8px corners.
- T3's light and dark modes, preset themes and advanced theme editor (background, surface, raised surface, overlay, text, muted text, border, input, accent, message surface, sidebar colors, status colors).
- Settings is T3's overlay window with search, keeping General, Appearance, Chat, Keybindings, Agents (Providers, Browser, Scheduled tasks), Connections (Environments, Sharing & access), Maintenance and About.

## Later

Multiple bots (personas, each its own harness) in the sidebar, an animated bot avatar, mobile layout.

## F1 foundation

The GUI uses the public `ozi` command, `OZI_` environment variables and `~/.ozi` (`OZI_HOME`). Desktop names are Ozi Beta / Ozi Dev, app IDs com.ozi.app / com.ozi.app.dev, profiles and schemes ozi / ozi-dev. No T3 homes, environment variables or profiles are read or migrated. T3 Code's MIT notice and “Forked from T3 Code” credit remain. Internal `@t3tools/*` package names remain. MCP names stay upstream-named until G2.

`pnpm dev` resolves every git checkout to its own `.ozi`, derives ports from the checkout path and never seeds from installed state. The GUI stores runtime data beneath `.ozi/userdata`; the harness's separate data repository is outside F1. CI runs typecheck and lint only; release and deployment workflows are removed.

## C4 remote hosting

Direct pairing, Tailscale HTTPS and desktop-managed SSH reuse T3's connection
transports. `ozi connect <pairing-url> --json` exchanges a one-time link and saves
an owner-only MCP bearer session through the existing OAuth flow; `disconnect`
removes it. `--access` can restrict the CLI to read-only pairing scopes. Thread commands use a live
local server first, otherwise the saved remote. The terminal and inbox CLI arrive
in C2. Revoked or expired sessions require pairing again.

`ozi service install|status|restart|uninstall` accepts `--json` and a Linux
`--unit <name.service>` for separate installs. `install --current-runtime` keeps
the current executable or checkout as the service runtime and preserves the
installer's PATH. macOS tests service contracts without starting any service;
the opt-in Linux E2E uses a unique temporary unit and data home. See [headless Linux](headless-linux.md) for
source deployment, direct network, Tailscale and SSH recipes.

## I1 ticket storage

Tickets live in the GUI server's existing SQLite database. `tickets.create`, `tickets.update`, `tickets.close`, `tickets.get`, `tickets.list` and `tickets.subscribe` use shared contracts; reads require orchestration read access and mutations require orchestration operate access. Subscriptions send an initial filtered snapshot and fresh snapshots after committed changes. Reconnecting starts with the persisted current state. Lists default to open tickets; `status: "archived"` or `"all"`, `chatId` and case-insensitive literal `search` filter the archive and inbox. Search covers title, need, summary and markdown.

Content includes up to four labelled choices and reuses T3 attachment references for files and HTML pages. The create caller supplies its thread and, when available, its provider session and message IDs; the store validates those associations, follows worker ancestry to the chat, resolves the delegated-task ID, and attaches the existing authenticated transcript route. Omitted session and message IDs resolve to the latest bound session and local message, or null before either exists. Content updates cannot change provenance.

Closing records the time and an answered choice, reply message, Got it acknowledgement or agent acknowledgement message. Message references must exist in their recorded thread; answered choices must exist on the ticket. Repeated closes preserve the first clearance. Archived content is immutable. Delivering replies and adding chat closure notes belong to I5–I7; MCP caller authentication and tools belong to I2.

The `ozi ticket` CLI exposes those six operations with `--input '<json>' --json`; `subscribe` emits newline-delimited snapshots.

## H2B harness integration

The default chat provider is **Ozi**, a named Pi instance loading `@ozi/pi` from the merged harness PR #81. Pi 1.4 and the harness package ship with the server; no global Pi installation or checkout path is needed. Ozi starts on Claude Opus 5.5, high thinking, fast off, through `pi-claude-bridge` and the user's Claude subscription (`claude auth login`), never an Anthropic API key. Other T3 providers and ordinary Pi remain selectable per chat.

Ozi keeps Pi state under `<OZI_HOME>/agents/ozi` and defaults its data root to `<OZI_HOME>/harness`. An empty root receives the initial delegation prompt and skills directory; existing roots are preserved. The Pi instance's Ozi data root setting accepts an absolute alternate root. The harness rereads `system.md` and optional `adhd.md` each turn and discovers that root's skills. T3's Pi adapter supplies the GUI MCP tools; background text helpers retain the Ozi extension and disable tools. Inbox hooks, self-repair and completion checks remain separate tickets.

## G1 progress

Simulator and emulator support is removed across the server, contracts, providers, web and mobile clients. Browser streaming remains independent of devices. All providers, including ACP, remain available. Diffs, pull requests, source control, Git and worktree management are removed across clients, server, tools, settings and packages. File viewing and editing, terminals and conversation rewind remain. Projects and their folder-bound chat model are removed across the web, mobile, desktop, server, contracts, MCP tools, settings and CLI. Chats form a flat list within their environments and start without selecting a folder. Each chat may keep a working directory; existing chats retain their previous project directory during migration. File search, viewing and editing, terminals, archives, scheduling, delegation and all providers, including ACP, remain. `ozi thread start` takes a message directly; `--cwd` selects an optional working directory, and `ozi thread stop` stops a chat and its delegated work.

## I3 inbox panel

The inbox is a fixed right column beside every chat from 1024px wide (340px, 404px from 1280px); top-right workspace controls move left by its width. It reads `tickets.subscribe` live: open tickets in group order, then by most recent update. The row's chat is the origin chat's title and its age is the creation time. The open ticket stays open until it clears, then the ticket that takes its place opens; clicking an open row closes it. Got it closes the ticket as acknowledged. Choices, keys 1–4 (one per shown choice, outside text fields) and the reply box (Enter) call hooks that I6 and I5 implement. Working lists each chat's pending subagent tasks and opens the worker. The archive subscribes with the server's search and shows how each ticket cleared, its chat and the clearance age.

## I4 ticket window

Open details, and any archive row, opens the ticket in T3's dialog over the app (760px wide, up to 86% of the height). The header shows the group, or Archived with how it cleared, then its chat and age. The body shows the title, the bold need, What happened (summary), Details (the markdown), Pick one (open tickets only), Files (HTML pages open in T3's HTML dialog, other attachments in a new tab) and Sources: Session transcript opens the calling thread and Job opens the worker. The footer names the chat the reply goes to (the current chat, or New chat) above a reply box with Send, and Got it for open tickets. Clicking outside, Esc, sending, choosing, Got it or a source link closes it; while it is open the inbox's number keys are off. Inbox rows carry no icons.

## L1 chats sidebar

Needs you holds chats with open tickets, by origin chat, and chats waiting on an approval or answer. Working, Pinned and Recent follow; settled and snoozed chats sit at the end of Recent. Rows are one line: title, then the time or a thin spinner. The footer shows a neutral avatar with "You" and the environment, any update or undo notice, and Settings; Usage stays in the command palette.

## L5 handoff line

Each job the main agent delegates shows in its chat as one line: the job title, then "waiting on you" while the job has an open ticket, else its state (queued, working, waiting, idle, done, failed, stopped). The line stays visible when the turn folds. Clicking it switches the inbox to its ticket and opens it, or opens the worker when there is no open ticket. The worker's completion notice adds no second line. Provider-native subagents keep T3's rows inside the work log.

## I2 ticket tools

The shared MCP server registers `ticket_create`, `ticket_update`, `ticket_close` and `ticket_list` for every provider, including delegated workers. Create accepts ticket content; update accepts its ID and content changes; close accepts its ID. No tool accepts origin or clearance IDs. The server derives the thread from its authenticated MCP credential, the provider session from its bound provider thread, and the latest user message in its active run (or its last run with background work). Queued messages are excluded. I1 resolves chat, job, worker and transcript links. Content updates preserve that origin; close records an agent clearance using the caller's user message. Agents decide which acknowledgement warrants closure.

List accepts the I1 status, search and chat filters. All four tools require an in-app thread credential; writes also require that provider to own a live run or background task. Pi exposes all four ticket tools directly, including through the Claude subscription bridge; other providers use their existing MCP discovery. Other MCP tools and the server name remain unchanged until G2.

## I6 ticket choices

`tickets.choose` and `ozi ticket choose --input '{"id":"…","choiceIndex":0,"chatId":"…"}' --json` answer the ticket's originating thread through T3's normal send path, preserving its provider and active-turn delivery. Choice indices are zero-based. The answer includes the ticket title, need, summary and chosen label and detail. Clicks in the inbox and ticket window and keys 1–4 use this operation; text fields and open windows keep the inbox shortcuts off.

A passive, persisted `Answered: ‹title›: ‹choice›` line appears in the current chat without starting its agent. Without a current chat, it goes to the ticket's origin chat. The ticket archives with the selected index and originating answer message. Duplicate submissions preserve the first clearance and do not send again; invalid choices or missing or archived threads leave it open. Answer and note commands have stable IDs for retries.

## I5 ticket replies

A reply from a row, the window or the archive goes into the chat shown behind the inbox, through T3's turn start with the default follow-up behaviour (steer or queue while the agent works). On a new chat it starts that chat, titled after the ticket. The message carries a `ticket` context record: the bubble shows a quiet quote, "↩ ‹title› · ‹need›", above the reply. The agent receives the ticket's title, group, need, summary, choices, details and files, who filed it (chat, or worker for a chat) and when, whether it is still open, an absolute transcript link, and the ticket, thread, chat, worker, job, session and message IDs, with a note to read the filing session with `t3_thread_read`. Once the message is accepted, the reply clears an open ticket (I7).

## C1 schedules and webhooks

Scheduled tasks target an existing chat and queue prompts using its current agent and model. Settings → Scheduled tasks selects the chat, with interval (at least one minute), local time and weekday, and webhook schedules. No run creates a new chat. Pause, run now, delete, URL rotation and delivery inspection use T3's scheduled-task service.

`ozi schedule add --chat <id> --prompt <text>` takes exactly one of `--every <duration>`, `--at HH:MM [--days 0-6,…]`, or `--webhook`. Durations use `ms`, `s`, `m`, `h`, `d` or `w`. Webhooks keep URL tokens, optional raw-byte HMAC-SHA256 (`--secret-ref`), repeated JSON `--filter`, seven-day `--replay-key` retention and fixed `--coalesce-key` / `--coalesce-window` windows. External senders POST; the GUI runs no watchers. `ozi schedules`, `schedule pause`, `resume`, `run` and `rm` support `--json`.

`serve --public-url` overrides `OZI_PUBLIC_URL`. An HTTP(S) base URL produces `<base>/api/hooks/<id>/<token>`; without it, agent and CLI results omit `webhookUrl`. Settings can copy the directly reachable server URL and explain how to configure a public one. Signing secrets stay write-only. Dispatch success records delivery, not completion of the agent's work.

Only explicit `OZI_TEST_CLOCK=<ISO instant>` enables the isolated scheduler clock and hidden `test-clock --advance <duration>` CLI endpoint. Normal servers use the local clock.

## I7 ticket clearing

Every clearance goes through `tickets.close` (and `ozi ticket close`), `tickets.choose` or the agents' `ticket_close`: a reply clears the ticket as replied with its message, Got it as acknowledged, a choice as answered, and an agent's close as an agent acknowledgement of the caller's latest user message. The first clearance archives the ticket and adds a passive, persisted "✓ Closed: ‹title›" line without starting an agent: in the reply's chat, the chat Got it was pressed in (else the ticket's chat), after the `Answered` line for choices, or in the closing agent's thread. Repeated closes add no second line. The archive shows how each ticket cleared: Replied, Got it, Answered: ‹choice› or Closed from chat.
