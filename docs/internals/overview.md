# Architecture

T3 Code keeps execution in the environment that owns the workspace. Web, desktop, and mobile
clients control it over authenticated RPC. A remote client must never substitute its own filesystem,
provider credentials, or machine state for the environment's. The desktop app bundles a server,
but its renderer follows the same boundary.

## Ownership boundaries

Provider processes, terminals, Git, and project files belong to the server. Shared connection and
domain state belongs in `packages/client-runtime`; clients supply platform services and UI.
Keeping that logic shared prevents reconnect and multi-environment behavior from diverging between
web and mobile. See [connection runtime](./connection-runtime.md) and
[remote environments](./remote.md).

The [RPC contract](../../packages/contracts/src/rpc.ts) is the boundary between independently
versioned clients and servers. Subscriptions send the state a client needs, so a client viewing one
thread does not pay for every thread's history. Authentication of a socket does not authorize every
method on it. See [environment auth](./environment-auth.md).

### Pull request linking compatibility

Web, desktop, mobile, and environments upgrade independently. Negotiate linking through the
environment descriptor, never through a client version or an assumed coordinated release:

| Environment capability                | Client behavior                                                                                                   |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `threadPullRequests: true`            | Use persisted `pullRequests[]`, multi-link commands, stack UI, and reverse thread lookup.                         |
| Only `threadPullRequestLinking: true` | Use `linkedPullRequest` and the existing `thread.meta.update` single-link operation. Do not call multi-link RPCs. |
| Neither flag                          | Hide linking actions; existing branch-discovered PR display remains available.                                    |

New environments continue advertising the legacy flag, accepting legacy metadata commands, and
emitting the derived `linkedPullRequest` field for older clients. That hostless field includes only
links in the thread project's own repository; cross-host and cross-repository links require the
multi-link protocol. New clients accept snapshots that
omit `pullRequests`. Retain the legacy wire fields, projection column, and replay support; this feature
does not schedule their removal. Missing new capabilities must also override cached multi-link data
after an environment downgrade.

Provider-specific behavior belongs behind an adapter. Orchestration works with normalized commands
and events, so adding a provider should not require branches throughout the domain or clients.
See [provider constraints](./providers.md).

## Settings ownership

Client preferences stay in the current client; environment defaults and project overrides stay
on their owning server. The web and desktop settings target is URL state, resolved against current
connections and project membership. An unavailable target must not fall back to another environment.
**All environments** is an explicit bulk edit of connected, loaded servers, not a durable global
default or a promise to synchronize offline or future environments. Project-group targets similarly
select known environment-local checkouts; the group itself does not store inherited defaults.

## Durable intent and side effects

The event log is the source of truth for orchestration state. The
[v2 orchestrator](../../apps/server/src/orchestration-v2/Orchestrator.ts) serializes commands and
decides events without performing provider or filesystem work.
[EventSink](../../apps/server/src/orchestration-v2/EventSink.ts) commits events, persisted projections,
the accepted command receipt, and outbox effects in one database transaction. Subscribers receive
events after that commit. This keeps command retries idempotent and prevents a persisted projection
from getting ahead of the event log.

The [effect worker](../../apps/server/src/orchestration-v2/EffectWorker.ts) performs side effects
after intent has been recorded, then feeds results back into orchestration. A command acknowledgement
therefore means the intent committed, not that the provider or other follow-up work
finished. Keep external I/O out of command decisions and the database transaction. Effects tied to
a lost provider process cannot simply replay; recovery retires them before admitting new work.

Persisted events must remain decodable on replay. Changing a schema affects old environments at
startup as well as live RPC traffic. Compatibility work must account for stored history, not just
what the newest client sends.

## Completion checks

[Completion](../../apps/server/src/ozi/Completion.ts) commits each settled claim and its check
outbox effect together. An internal native fork checks the outcome with evidence-only tools.
The source accepts input throughout and releases queued work as soon as its fork exists.
Checked outcomes become Ready; missing work continues, and human blockers surface immediately.
Three unsuccessful rounds without verified progress become Blocked. Steering supersedes late
verdicts. [Jobs](../../apps/server/src/ozi/Jobs.ts) records exact-event disposition and reopens
cards when new obligations arrive. Checkpoints and automatic thread settlement are removed.

## Waiting for asynchronous work

Tests use [drainable workers](../../packages/shared/src/DrainableWorker.ts) to wait until both the
queue and its current item have finished. An empty queue alone does not prove the worker is idle.

V2 tests also drain the effect worker or await a specific persisted event or receipt. Test signals
are separate from the durable command receipts that make dispatch idempotent. Production behavior
must use persisted state and events, not test instrumentation or assumptions about elapsed time.

The Electron shell acquires `DesktopPreReadyPlatform.layer` synchronously before asynchronous
services. On Linux this sets the desktop-entry identity and global-shortcut portal flags before
Chromium initializes its portal connection. Setting the identity later in `DesktopAppIdentity`
is too late: Chromium caches the first registration, including failures. The identity must match
the installed entry managed by `DesktopLinuxUrlHandler`. Pre-ready setup also refreshes that entry's
`Exec` path before portal registration: AppImage updates can remove the previous executable, which
makes the old entry invalid even though its filename is correct. The later URL handler avoids
rewriting an identical entry while the portal may be reading it. On Wayland, Electron's synchronous
shortcut-registration result only confirms submission; it does not confirm desktop consent or
an active binding.

Native modules never load in the Electron main process on the startup path, and the two the
snapshot feature keeps are isolated: `@crowecawcaw/xa11y` runs only in forked Node-mode children
(`SnapShotAccessibilityWorker`, `RegionSnapShotWorker`) and a worker thread, and `ffi-rs` loads
lazily inside `WindowsForeground.ts` for a handful of Win32 calls. macOS window lookup shells out
to `osascript` instead of a native addon. A crash or stall in any of these must not take the app
down, so new native capability goes in a child with a deadline, not an `import` in main.

See the [glossary](./glossary.md) for shared terms and the
[development runbook](../operations/development.md) for setup and checks.
