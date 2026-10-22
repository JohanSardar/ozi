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

- `cards(mainThreadId) → JobCard[]` via existing snapshots/subscriptions.
- `handle({commandId, jobId, eventId, evidence}) → CommandReceipt`. Errors: `UnknownJob`, `WrongJob`, `StaleEvent`, `InvalidEvidence`, no mutation.
- Thread fields only: `jobId`, `visibility`, `handledEventId`. No job tables.
- Column: any unresolved question/approval/secret/login/Blocked in the job → Needs you; else unresolved or unchecked work → Running; checked lead report for current request → Ready; handled → Done. Newer request, actionable event or result reopens.

### Completion (`ozi/Completion.ts`)

- `claim({threadId, runId, requestEventId, reportItemId|null}) → CommandReceipt`; states `checking | continued | checked | needs_user | blocked | superseded`.
- Every claim is checked (main included), except checker runs and stopped work. Check = isolated native fork (Pi `--fork` after `agent_settled`; Claude/Codex native fork), same provider/model, low effort, evidence access only.
- `continue` resumes the original thread. Malformed verdict, missing fork, provider error, deadline → unsuccessful round. Steering supersedes a pending verdict.

### Repair (`ozi/Repair.ts`)

- `logMistake({sourceEventId, beforeUserMessageId?, fingerprint, what, why}) → {id, status}`; statuses `logged | testing | failed | shipped | undone`. Dedupe on source event + fingerprint.
- Repair only on a user correction or a repeat. Replay: original must reproduce, candidate must pass the same frozen case, observer must agree; anything inconclusive fails.
- Authoring and both replays run in bwrap: candidate data root writable, `protected/` read-only, no credentials or effect endpoints. Publisher checks the real diff; protected changes only on the user's own message.
- Pass → one data-root commit, activated. Repeat after a fix → revert; conflict with a user edit → keep the pre-fix build and post a blocker.

### JobPanel (`components/ozi/JobPanel.tsx`)

- `<JobPanel mainThreadId/>`: cards in four columns, questions/approvals/secrets/reports on the card, Close and Stop, drawer with the lead's conversation (lazy), to-dos below jobs labeled with their source. One main composer, always usable. No thread list.

## Retained surface

Only Pi, Claude and Codex providers and desktop and web clients ship. Provider registration, models, settings, usage, packaging and relay APIs follow this boundary.

## Main agent

- Startup creates the sole main thread, `ozi-main`, in a Workspace project rooted at `<home>/workspace`. Main delegates in that workspace.
- Thread projections and shells expose `role: "main" | "main-fork" | "worker"` and `effectiveLoadout: {provider, model, options: [{id, value}], toolNames, systemPromptSha256}`. Tool names describe the injected MCP catalog; the hash covers the server-owned prompt. Main forks retain the restricted loadout with role `main-fork`.
- Main selections are fixed on launch, resume and fork: Pi `anthropic/claude-opus-5-5`, `thinking: high`, `fastMode: false`. Unavailable selections fail. Main cannot change workspace, provider or model, or archive/delete itself.
- Pi main disables built-in tools, extension/skill/context/prompt-template discovery, and loads only the injected MCP bridge. The server checks the role allowlist on tool calls and limits thread targets to main's own descendants.
- Prompt: `prompt.md` from the data root, verbatim, `{{ADHD}}` replaced by `adhd.md` if present, else empty. ≤400 words. Reread at each turn; edits apply on the next turn.
- Tools: delegation, steer/queue/stop, schedules, secrets, job handling, `log_mistake`, `read_skill(name)`. No shell, files, browser or ambient extensions.
- Skills: `read_skill(name)` reads `skills/<name>/SKILL.md` on demand. Unknown names and path or symlink escapes fail.
- Default main delegation: Codex `gpt-6.1-sol`, `reasoningEffort: xhigh`, `serviceTier: priority`. Workers receive one short role instruction to finish their brief, use available tools, handle computer-solvable interactions, ask only for missing decisions or human-only actions, avoid CAPTCHA solvers, and report plainly.

## CLI

One binary, `ozi`. Every command takes `--json`. Client commands find the server from `--home` (default `~/.ozi`) and authenticate with its owner session.

| Command                                                  | Does                                                                                     |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `ozi serve [--home] [--data-root] [--port] [--host]`     | Run the server.                                                                          |
| `ozi service install\|status\|restart\|uninstall`        | systemd user service.                                                                    |
| `ozi pair`                                               | Pairing URL for a new client.                                                            |
| `ozi status`                                             | Server, main thread, effective loadouts (model, options, tools, prompt hash), providers. |
| `ozi say <text> [--file <path>]…`                        | Message main; queues when busy.                                                          |
| `ozi steer <text> [--thread <id>]`                       | Steer the active turn.                                                                   |
| `ozi stop [--thread <id>]`                               | Stop a thread's work.                                                                    |
| `ozi thread <id>`                                        | Transcript, loadout, state.                                                              |
| `ozi jobs`                                               | Cards by column.                                                                         |
| `ozi job <id>`                                           | Card plus lead transcript.                                                               |
| `ozi answer <requestId> <value…>`                        | Answer a question, approval (`allow`/`deny`) or secret.                                  |
| `ozi close <jobId> <eventId>`                            | Handle a card.                                                                           |
| `ozi checks [<threadId>]`                                | Check rounds and verdicts.                                                               |
| `ozi mistakes` / `ozi mistake <id>`                      | Mistake log.                                                                             |
| `ozi replays`                                            | Replay cases and results.                                                                |
| `ozi fixes` / `ozi undo <fixId>`                         | Shipped fixes; manual undo.                                                              |
| `ozi schedules` / `ozi schedule add\|rm\|run`            | Interval, time-of-day and webhook schedules bound to main.                               |
| `ozi todos`                                              | External to-dos with source and freshness.                                               |
| `ozi wait <job\|thread\|check> <id> <state> [--timeout]` | Block until the state holds; non-zero on timeout.                                        |

## E2E

`e2e/` runs the real server (`ozi serve` on a temp home and temp data root), real SQLite, files, git and bwrap, the real web client in Chromium, and the `ozi` CLI. Fakes only: provider transports (`e2e/fakes/{pi,codex,claude}` executables on `PATH`, speaking each native protocol and calling real MCP tools from a scenario script), the clock, and external MCP. Tests await observable state via `ozi wait`, never sleeps.

A milestone passes when its scenarios pass here and its real-agent run passes: real Pi/Opus 5.5 main, Codex and Claude workers, the desktop app on a second machine.

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
- `m1.cli-json`: every `ozi` command returns valid JSON with `--json`.

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
- `m4.useful-card`: a scheduled run with a useful finding makes a card.
- `m4.webhook`: a signed POST wakes main; bad signature rejected; duplicate suppressed; filter applied.
- `m4.base-url`: schedules report webhook URLs on the configured base URL.
- `m4.todos`: external to-dos show labeled; offline/malformed source shows unavailable, not empty; no config hides them.
- `m4.removed`: no relay, device, terminal, PR or diff paths remain.

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
