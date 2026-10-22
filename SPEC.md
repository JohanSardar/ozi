# Ozi spec

Ozi is an agent runtime for anyone. You talk to one main agent; it delegates real work to workers, stays responsive, and keeps every job on a card until it is handled. Forked from T3 Code v0.1.1 (MIT).

## Glossary

- **Main**: the one conversation the user talks to. Pi, Claude Opus 5.5, high effort, fast off. Orchestration tools and `read_skill` only.
- **Worker**: an agent thread main starts. Default Codex `gpt-6.1-sol`, xhigh, Fast; Claude or Pi when better suited.
- **Job**: one outcome. Its **lead** is the first worker thread for it; job ID = lead thread ID. **Helpers** are descendants that inherit the job ID.
- **Card**: the panel view of a job. Columns: **Needs you > Running > Ready > Done**.
- **Report**: a worker's checked outcome for the job's current request.
- **Claim**: an agent turn that ends saying it is done.
- **Check**: an isolated fork of the claiming thread that returns a **verdict**: `done`, `continue(missing, evidence)` or `needs_user(reason)`, plus a useful-finding flag. One check = one **round**.
- **Blocked**: three consecutive rounds without verified progress.
- **Handle**: close a card against the exact event it showed, with evidence `close`, `accepted(userMessageId)` or `verified(checkEventId)`.
- **Mistake**: one SQLite row: what went wrong and why.
- **Replay**: rerun of the user's message before a mistake, on a branch, with stubbed effects, judged by an **observer**.
- **Fix**: a change to the data root that passed replay; one local git commit. **Undo** reverts it.
- **Protected**: `protected/` in the data root. Repair can't change it; the user can, by asking.
- **Data root**: a git repo (`--data-root`, `OZI_DATA_ROOT`, default `~/ozi`) holding `prompt.md`, optional `adhd.md`, `skills/`, `protected/`. Never in the code repo.
- **Home**: server state directory (default `~/.ozi`), holding SQLite.
- **To-do**: a user task from an external MCP source, shown read-only.

## Modules

New code lives in `apps/server/src/ozi/` and `apps/web/src/components/ozi/`. Everything else is T3, trimmed.

### Jobs (`ozi/Jobs.ts`)

- `cards(mainThreadId) → JobCard[]` via authenticated `ozi.jobs.get` and `ozi.jobs.subscribe` (empty payload, stream of card arrays). `ozi.jobs.handle` returns the existing command receipt sequence.
- Cards expose `jobId`, current `eventId`, title, column, agent, short status, `checking`, `checkState`, `requestEventId`, report, requests with owner thread IDs, `handledEventId`, and `updatedAt`. Secret values never enter cards. Reports contain their checked event ID, text and useful-finding flag.
- `handle({commandId, jobId, eventId, evidence}) → CommandReceipt`. Errors: `UnknownJob`, `WrongJob`, `StaleEvent`, `InvalidEvidence`, no mutation.
- Thread fields only: `jobId`, `visibility`, `handledEventId`. No job tables.
- Column: any unresolved question/approval/secret/login/Blocked in the job → Needs you; else unresolved or unchecked work → Running; checked lead report for current request → Ready; handled → Done. Newer request, actionable event or result reopens.
- Close records `job.handled` against the exact displayed event. Automatic acceptance requires an unambiguous user message after that report; verified handling requires its successful check event. Both reject unresolved or newer obligations. Viewing, silence and answers never accept a report. Main reads exact events with `job_cards` and calls `handle_job`; a plain acknowledgement addressed to a Ready lead records acceptance atomically without another agent turn. `ozi close --command-id` retries the same command without closing a newer event. Close leaves active work and requests alone.
- Main alone may pass `jobId` to delegation. Helpers inherit it; related follow-ups use the lead's existing send/queue path. An unavailable worker leaves a lead with its blocker and no agent run. Scheduled jobs inherit quiet visibility; internal threads do not appear in cards.
- The current request follows its source event through lead sends, steering and queued follow-ups; event order, not the clock, identifies it.

### Completion (`ozi/Completion.ts`)

- `claim({threadId, runId, requestEventId, reportItemId|null}) → CommandReceipt`; states `checking | continued | checked | needs_user | blocked | superseded`.
- Scheduled and webhook system messages count as requests. Request order follows the conversation even when clock timestamps are equal. Every settled completion creates a candidate automatically, including main, text-only responses, final responses and completion without prose. Checker, interrupted and stopped runs are excluded. The terminal event, candidate and check outbox effect commit atomically before successful delivery or Ready. Recovery uses the same capture path; storage failures retry.
- Checks use T3's native fork paths: Pi waits for `agent_settled` and starts an isolated `--fork` process; Claude and Codex use `ThreadForkService`/`ContextHandoffService`. The source is held only until its native fork exists, then queued input can start before checker inference. There is no checkpoint wait.
- Checkers have an internal, runtime-owned role, the same provider/model and options with low effort, a fixed non-recursive prompt, and evidence-only tools. Options are checked against a refreshed native catalog. Unsupported options, missing native history, malformed JSON, provider failures and a 120-second deadline consume unsuccessful rounds and never pass.
- Verdicts are `{"verdict":"done","useful":boolean}`, `{"verdict":"continue","missing":string,"evidence":string[],"useful":boolean}` or `{"verdict":"needs_user","reason":string,"useful":boolean}`. Done releases the report and deduplicated delivery; continue resumes its owner. Main continues by delegating missing work and owes coordination/reporting, including while background work remains. Human needs, questions, failures and login requests surface immediately.
- Three consecutive rounds without verified progress become Blocked in Needs you. Workspace content hashes and completed action receipts are verified independently; new evidence or fulfilled actions reset the count. Read-only tool calls, repeated receipts and rewording do not. Each round retains misses, evidence, verdict/error and input/output token cost, or null when unavailable.
- Steering or Stop supersedes pending results. Late checks can record their evidence and cost, but cannot release old reports or resume cancelled work. Drawers mark pending text unchecked.
- `ozi checks [threadId] --json` exposes records; `ozi wait check <id> <state> --json` subscribes to transitions. Each record contains `id`, `eventId`, `threadId`, `runId`, `requestEventId`, `reportItemId|null`, `report`, `state`, `sourceCaptured`, `unsuccessfulRounds`, `evidence`, `rounds`, and timestamps. Rounds contain their number, checker thread ID, verdict/error, misses, verified evidence, tokens and timestamps.
- Retired: `RunFinalizationService`, `ThreadSettlementService`, inactivity/PR auto-settle, checkpoint storage/services, diff capture, rollback commands and their contracts, client state, UI and replay fixtures. SQLite WAL maintenance is retained. Repair uses git directly.

### Repair (`ozi/Repair.ts`)

- `logMistake({sourceEventId, beforeUserMessageId?, fingerprint, what, why}) → {id, status}`; statuses `logged | testing | failed | shipped | undone`. Dedupe on source event + fingerprint.
- Repair only on a user correction or a repeat. Replay: original must reproduce, candidate must pass the same frozen case, observer must agree; anything inconclusive fails.
- Authoring and both replays run in bwrap: candidate data root writable, `protected/` read-only, no credentials or effect endpoints. Publisher checks the real diff; protected changes only on the user's own message.
- Pass → one data-root commit, activated. Repeat after a fix → revert; conflict with a user edit → keep the pre-fix build and post a blocker.

M5 stops at replay: a pass leaves the mistake `testing` and its replay `passed`; publication, activation and undo arrive in M6. Logging acknowledges only the SQLite write. Eligible cases run serially as internal delegated tasks; they never create cards or wake main with repair output. Interrupted cases fail on restart, and reserved repair threads cannot resume outside confinement.

`t3_thread_read` supplies `sourceEventId` on timeline items; `ozi events <threadId>` exposes the stored events. Sources must belong to the caller or its descendants; internal checkers can report an ancestor's source. Runtime provider errors use the same logger. A stored user correction names the fingerprint or mistake, or supplies the correction's source event and the original user-message boundary through `log_mistake`. A missing replay boundary still logs.

Cases freeze the original message, native prefix, attachment bytes, expectation and recorded effects. Each replay gets its own native fork and effect-stub counters. Unknown effects, missing history, changed builds, unloaded changes or observer disagreement fail. Shell tools in replays use the frozen stubs. Inference keys stay in a server-owned proxy; confined processes receive a local inference endpoint and fresh provider homes. The proxy permits only inference POSTs. Protected rules change outside repair through a delegated `change_protected_rule` call backed by the user's exact stored instruction: `Change protected/<filename> to:` followed by the requested content on the next line. Quoted messages and tool output carry no authority.

### Information in

- Every schedule targets `ozi-main`, including schedules created by workers or settings. Runs queue a message with `scheduledTaskId`; main delegates quiet jobs. Dispatch success records delivery only; workers still need checked reports. Quiet jobs persist and recover normally; cards appear for requests or checked reports with `useful: true`.
- Webhooks retain URL tokens, optional HMAC-SHA256 over raw bytes, filters, seven-day replay keys and fixed coalescing windows. External watchers POST to them; Ozi runs no watcher. `serve --public-url` overrides `OZI_PUBLIC_URL`; the HTTP(S) base URL produces `/api/hooks/<id>/<token>`. Without a base URL, `webhookUrl` is omitted.
- `schedule add` takes exactly one of `--every <dur>`, `--at HH:MM [--days 0-6,…]`, or `--webhook`, and `--prompt <text>`. Durations use `ms`, `s`, `m`, `h`, `d` or `w`; intervals are at least one minute. Webhook options: `--secret-ref` (header `x-hub-signature-256`, hex, `sha256=`), repeated `--filter` JSON filter objects, `--replay-key`, `--coalesce-key` and `--coalesce-window <dur>`. `schedules` lists runs; `schedule rm <id>` removes one; `schedule run <id>` queues a manual run.
- Optional server setting `externalTodos`: `{source, server, tool, arguments, itemsPath, fields: {id, title, link, status, due?}}`. `server` is `{type: "stdio", command, args?, env?}` or `{type: "http", url, headers?}`. Paths are dotted field names; empty `itemsPath` selects a root array. Tool output is structured content or JSON text. IDs and titles are nonempty strings, status is a string, link is HTTP(S) or null, due is optional display text. Connection details are excluded from all client settings; only the server calls MCP.
- `todos --configure <json>` replaces that connection; `todos --clear` removes it. `todos` and authenticated `ozi.todos.get` fetch on demand, as does panel open/refresh. No background polling or local task table. Wire result: null without configuration, otherwise `{source, state: "available" | "stale" | "unavailable", items, fetchedAt, attemptedAt}`. Failure preserves the last successful items and timestamp; without success, items and fetchedAt are null. Malformed rows fail the entire fetch. Empty success is distinct from unavailable.
- Only explicit `OZI_TEST_CLOCK=<ISO instant>` enables the scheduler test clock and hidden `test-clock --advance <dur>` CLI command. Advancing triggers scheduler work; production uses the real local clock. Tests observe delivery through `ozi wait`.

### JobPanel (`components/ozi/JobPanel.tsx`)

- The app opens at `/` into `ozi-main`. No thread list, projects, drafts, workspace selectors or branch controls. Settings retain connections, providers, appearance, keybindings, scheduled tasks and licenses. New schedules target main.
- `JobPanel` renders supplied `OziJobCard[]` with answer, handle, stop and open callbacks. Four sections with counts and empty states; Needs you count in the title bar. Questions, approvals, private entry and reports stay on cards. Close and Stop are separate. Status indicators are static.
- Opening a card mounts `JobDrawer`, which loads the lead's brief and conversation on demand. Its composer addresses the lead. The main composer remains mounted and usable. HTML replies, MCP apps and the shared browser remain available. To-dos below jobs, labeled with their source, arrive in M4.
- Client-runtime atoms subscribe to `ozi.jobs.subscribe` with `{}` and send `ozi.jobs.handle`. `useOziJobs` supplies authoritative cards and session freshness. The panel retains its last cards on disconnect, disables mutations until a current snapshot arrives, and surfaces `OziJobError`, including `StaleEvent`. Close preserves its command ID and exact card `eventId`; commands are never acknowledged optimistically. Answers and stop use the existing owner-specific commands.

## Retained surface

Device and simulator support is removed, including its RPC methods, MCP tools, settings, models and tool downloads. Shared browser streaming remains. Terminal sessions, their RPC streams, project setup terminals and sign-in terminal rendering are removed. Desktop and server self-update RPCs, update feeds, IPC and controls are removed. Resource monitoring, product analytics and power/activity reporting are removed. macOS packaging has no Rust prerequisite; Linux capture helpers retain their Rust builds. T3 deployment infrastructure and vendored Alchemy references are removed. The T3 welcome wizard and its stored completion marker are removed; provider setup remains in Settings. All product labels and desktop identifiers use Ozi. Desktop and web share the neutral blue icon; package names remain internal.

Only Pi, Claude and Codex providers and desktop and web clients ship. Provider registration, models, settings, usage and packaging follow this boundary. T3 Connect, cloud accounts, tunnels, relay discovery and signed cloud proofs are removed. Remote pairing over direct network connections, SSH and Tailscale remains. Webhooks use the configured public URL directly.

## Main agent

- Startup creates the sole main thread, `ozi-main`, rooted at `<home>/workspace`. Workers share a per-job scratch directory under `<home>/workspace/jobs/`; execution does not select a project or worktree. One internal workspace record remains for thread persistence and scheduling. Project management, worktree launch, source control, pull requests and review APIs are removed. Repository grouping and asynchronous git metadata enrichment are removed from shell projections.
- Thread projections and shells expose `role: "main" | "main-fork" | "worker"` and `effectiveLoadout: {provider, model, options: [{id, value}], toolNames, systemPromptSha256}`. Tool names describe the injected MCP catalog; the hash covers the server-owned prompt. Main forks retain the restricted loadout with role `main-fork`.
- Main selections are fixed on launch, resume and fork: Pi `anthropic/claude-opus-5-5`, `thinking: high`, `fastMode: false`. Unavailable selections fail. Main cannot change workspace, provider or model, or archive/delete itself.
- Pi main disables built-in tools, extension/skill/context/prompt-template discovery, and loads only the injected MCP bridge. The server checks the role allowlist on tool calls and limits thread targets to main's own descendants.
- Prompt: `prompt.md` from the data root, verbatim, `{{ADHD}}` replaced by `adhd.md` if present, else empty. ≤400 words. Reread at each turn; edits apply on the next turn.
- Tools: delegation, steer/queue/stop, schedules, secrets, job handling, `log_mistake`, `read_skill(name)`. No shell, files, browser or ambient extensions.
- Skills: `read_skill(name)` reads `skills/<name>/SKILL.md` on demand. Unknown names and path or symlink escapes fail.
- Default main delegation: Codex `gpt-6.1-sol`, `reasoningEffort: xhigh`, `serviceTier: priority`. Workers receive one short role instruction to finish their brief, use available tools, handle computer-solvable interactions, ask only for missing decisions or human-only actions, avoid CAPTCHA solvers, and report plainly.

## CLI

One binary, `ozi`. Every command takes `--json`. Client commands find the server from `--home` (default `~/.ozi`) and authenticate with its owner session.

| Command                                                                         | Does                                                                                                   |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `ozi serve [--home] [--data-root] [--port] [--host] [--public-url]`             | Run the server.                                                                                        |
| `ozi service install\|status\|restart\|uninstall`                               | systemd user service.                                                                                  |
| `ozi pair`                                                                      | Pairing URL for a new client.                                                                          |
| `ozi request <RPC-or-path>… [--method GET                                       | POST] [--payload JSON]`                                                                                | Send authenticated requests to the running server and report each RPC result or HTTP status. |
| `ozi status`                                                                    | Server, main thread, effective loadouts (model, options, tools, prompt hash), providers.               |
| `ozi say <text> [--file <path>]…`                                               | Message main; queues when busy.                                                                        |
| `ozi steer <text> [--thread <id>]`                                              | Steer the active turn.                                                                                 |
| `ozi stop [--thread <id>]`                                                      | Stop a thread's work.                                                                                  |
| `ozi thread <id> [--provider <id> --model <model>] [--fork] [--message <text>]` | Transcript, loadout, state; select a worker model, fork the latest stable run, or send to that thread. |
| `ozi jobs`                                                                      | Cards by column.                                                                                       |
| `ozi job <id>`                                                                  | Card plus lead transcript.                                                                             |
| `ozi answer <requestId> <value…>`                                               | Answer a question, approval (`allow`/`deny`) or secret.                                                |
| `ozi close <jobId> <eventId>`                                                   | Handle a card.                                                                                         |
| `ozi checks [<threadId>]`                                                       | Check rounds and verdicts.                                                                             |
| `ozi mistakes` / `ozi mistake <id>`                                             | Mistake log.                                                                                           |
| `ozi replays`                                                                   | Replay cases and results.                                                                              |
| `ozi fixes` / `ozi undo <fixId>`                                                | Shipped fixes; manual undo.                                                                            |
| `ozi schedules` / `ozi schedule add\|rm\|run`                                   | Interval, time-of-day and webhook schedules bound to main.                                             |
| `ozi todos`                                                                     | External to-dos with source and freshness.                                                             |
| `ozi wait <job\|thread\|check\|mistake\|replay> <id> <state> [--timeout]`       | Block until the state holds; non-zero on timeout.                                                      |
| `ozi events <threadId>`                                                         | Stored source events for diagnostics and mistake logging.                                              |

M1 implements `serve`, `service`, `pair`, `status`, `say`, `steer`, `stop`, `thread`, and `wait`. M2 adds `jobs`, `job`, `answer`, `close`, and `wait job`. M3 adds `checks [threadId]` and `wait check`. Other commands arrive with their owning milestones. `--home`/`OZI_HOME` selects server state; `--data-root`/`OZI_DATA_ROOT` selects the data repository. Desktop launchers may use the `--base-dir` alias.

The CLI resolves main by its fixed `ozi-main` ID; worker and fork activity never changes the default target. `status` returns server configuration, the shell snapshot and the complete main projection with its effective loadout; `thread` returns the complete thread projection. `--fork` creates a child from the latest stable run; other thread flags then address the child. Main and main-fork model changes fail. `job` returns `{card, lead}`; `jobs` returns a card array. `answer` routes questions, allow/deny approvals, secret entry and checker blockers to the request's owning thread. `wait thread <id> text:<substring>` waits for transcript text; `wait job` uses `needs_you`, `running`, `ready`, or `done`. JSON errors retain a non-zero exit code. Uploaded text files include their name, saved path and UTF-8 content in main's prompt so main can delegate a complete brief without file tools.

## E2E

`e2e/` runs the real server (`ozi serve` on a temp home and temp data root), real SQLite, files, git and bwrap, the real web client in Chromium, and the `ozi` CLI. Fakes only: provider transports (`e2e/fakes/{pi,codex,claude}` executables on `PATH`, speaking each native protocol and calling real MCP tools from a scenario script), the clock, and external MCP. Tests await observable state via `ozi wait`, never sleeps.

A milestone passes when its scenarios pass here and its real-agent run passes: real Pi/Opus 5.5 main, Codex and Claude workers, the desktop app on a second machine.

Scenario scripts are JSON arrays at `OZI_FAKE_SCRIPT`. Rules match prompt regular expressions, optionally `provider` (`pi`, `codex`, `claude`) and `role` (`main`, `worker`). Matching rules run once in order unless `repeat` is true. Steps are `{"say":"text"}`, `{"tool":{"name":"read_skill","arguments":{"name":"demo"}}}`, `{"ask":"question"}`, `{"approval":"command"}`, `{"wait":true}` or `{"fail":"reason"}`. Tools use the real authenticated MCP endpoint. `$prompt`, `$result` and `$result.field` interpolate the prompt or last tool result. `OZI_FAKE_LOG` records launches, received protocol frames, prompts, tools and results with credentials redacted.

Install Chromium with `pnpm --filter @ozi/e2e exec playwright install chromium` before the first E2E run. The setup builds the web client when its bundle is missing. The harness uses isolated provider homes and kills only its own server process. `OZI_E2E_KEEP=1` preserves temporary artifacts after teardown.

### M1 Connection

- `m1.fresh-install`: fresh home and data root start; `ozi status` shows main and providers pi, claude, codex only.
- `m1.main-loadout`: main is Pi, `claude-opus-5-5`, high, fast off; prompt equals data-root prompt with empty ADHD slot; tools are orchestration + `read_skill`; same after resume and fork.
- `m1.main-cannot-execute`: main has no shell/file/browser tool; a call is rejected.
- `m1.delegate-async`: request → main starts a Codex worker (gpt-6.1-sol, xhigh, Fast), confirms it started, its turn ends; worker result returns to main, which reports.
- `m1.responsive`: while a worker runs, a second message gets an answer.
- `m1.worker-choice`: main starts a Claude worker and a Pi worker when asked.
- `m1.attachments`: a file sent with a message reaches main and the worker brief.
- `m1.steer-queue-stop`: steer main mid-turn; queue a follow-up; stop main; stop a worker.
- `m1.read-skill`: main loads a data-root skill by name; unknown name errors.
- `m1.remote-client`: web client pairs with the server over its network address and chats.
- `m1.cli-json`: every implemented `ozi` command returns valid JSON with `--json`; native forks of Pi, Claude and Codex workers preserve the source conversation.

### M2 Jobs

- `m2.lead-card`: a delegated request shows one Running card at once.
- `m2.helper-same-job`: a worker's helper inherits the job; still one card.
- `m2.second-outcome`: an unrelated request makes a second card.
- `m2.followup-lead`: a related follow-up runs in the lead thread; no new card.
- `m2.question-card`: a helper's question moves the card to Needs you; answering it on the card resumes that helper.
- `m2.approval-card`: a worker approval shows on the card; deny and allow reach the owner.
- `m2.secret-card`: a secret request shows on the card; the value never appears in card data.
- `m2.awaits-check`: a finished worker stays Running (checking), never Ready.
- `m2.drawer`: clicking a card opens the lead conversation in a drawer.
- `m2.no-thread-list`: the UI has no thread list or projects.
- `m2.main-without-worker`: if a worker can't start, a lead thread with the blocker shows in Needs you.
- `m2.restart`: after a server restart, cards and columns are unchanged; retried commands don't duplicate.

### M3 Completion

- `m3.worker-done`: a worker claim is checked; `done` → Ready with the report.
- `m3.continue`: `continue` resumes the worker, which finishes; then Ready.
- `m3.blocked`: three rounds without progress → Blocked in Needs you.
- `m3.progress-resets`: verified progress resets the round count.
- `m3.main-checked`: main's text-only claim is checked; `continue` makes main delegate.
- `m3.no-recursion`: checker runs are never checked.
- `m3.fork-intact`: each provider's fork leaves the source session unchanged and usable.
- `m3.bad-verdict`: malformed verdict or checker error counts as an unsuccessful round.
- `m3.steer-supersedes`: steering during a check discards its verdict.
- `m3.stop-unchecked`: stopped work is not checked.
- `m3.needs-user`: `needs_user` moves the card to Needs you at once.
- `m3.close-exact`: closing the shown report → Done; a stale event is rejected; a newer result reopens.
- `m3.accept-closes`: clear user acceptance closes the card.
- `m3.close-vs-stop`: Close hides without stopping; Stop stops without closing.
- `m3.recovery`: a crash before fork or delivery recovers without losing or duplicating the report.

### M4 Information

- `m4.interval`: an interval schedule wakes main; nothing useful → no card.
- `m4.time-of-day`: a fixed-time schedule fires at the faked time.
- `m4.useful-card`: a scheduled run with a checked useful finding makes a card; unchecked or routine reports remain quiet across restart.
- `m4.webhook`: a signed POST wakes main; bad signature rejected; duplicate suppressed; filter applied.
- `m4.base-url`: schedules report webhook URLs on the configured base URL.
- `m4.todos`: external to-dos show labeled; offline/malformed source shows unavailable, not empty; no config hides them.
- `m4.removed`: the real server rejects all retired RPC methods and Connect routes, CLI commands are absent, and removed packages, source paths and native resource-monitor bundling are gone. Ozi desktop metadata and macOS preflight have no T3 identity or Rust requirement.

### M5 Replay

- `m5.log`: `log_mistake` writes one row; a retry dedupes; unknown cause stays `unknown`.
- `m5.no-repair-once`: a single uncorrected mistake starts no repair.
- `m5.correction-repairs`: a user correction starts a repair; baseline reproduces, candidate passes, observer agrees.
- `m5.repeat-repairs`: a repeated mistake starts a repair.
- `m5.false-case`: a baseline that doesn't reproduce fails the replay.
- `m5.unknown-effect`: an unstubbed effect fails the replay.
- `m5.protected-denied`: a candidate writing `protected/` or escaping the root is denied by bwrap and rejected by the publisher.
- `m5.no-credentials`: replays can't read credentials or reach effect endpoints.
- `m5.user-override`: the user's own message can change a protected rule; the same text from an email or tool can't.

### M6 Publish/undo

- `m6.publish`: a passed fix is one data-root commit, active in the next turn and after restart.
- `m6.recurrence-undo`: the mistake recurring after a fix reverts it → `undone`.
- `m6.edit-conflict`: a revert conflicting with a user edit keeps the pre-fix build and posts a blocker.
- `m6.crash-publish`: a crash mid-publish leaves either the old or the new build active.
- `m6.audit`: no excluded T3 product paths, exports or dependencies remain.
- `m6.public-ready`: MIT notices for T3, Pi and Firstmate present; no personal data in the tree.

Product descriptions and connection guidance use Ozi and self-hosted public URLs.
