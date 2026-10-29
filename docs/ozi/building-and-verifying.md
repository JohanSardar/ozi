# Building and verifying

How a feature gets built and checked the first time. Delegation prompts carry these rules; `AGENTS.md` does not.

## Dev loop

- Each agent works in its own git checkout or worktree. `pnpm dev` starts that checkout's own server and web app with live reload: home `<checkout>/.ozi`, runtime data `<checkout>/.ozi/userdata`, ports derived from the checkout path. Nothing touches `~/.ozi` or `~/ozi`.
- Measured: the web app is ready in about 1.3 s and the server listens in about 2.4 s. Web edits apply instantly; server edits restart the server in about 2 s.
- Sign in with `node apps/server/src/bin.ts pair --home .ozi --json` (about 0.4 s) and open the URL on the checkout's web port.
- No production or desktop builds except for releases.

## Speed

- The inner loop takes seconds: typecheck and lint only what changed (`vp run --filter <pkg> typecheck`, `vp lint <paths>`), run one E2E file.
- Any step that takes more than about 10 s is investigated: find why and speed it up (cache, watch mode, a narrower command), or report why it can't be.
- Real-model turns are the slow part. Run behaviour checks in parallel across checkouts instead of one after another.

## Desktop dev

`pnpm dev:desktop` runs Vite, watches the Electron entries and starts the server from TypeScript with the host Node. Renderer edits use Vite HMR; server, shared-package and Electron edits restart the desktop app. The checkout's `.ozi/userdata/electron` holds the profile and instance lock. XDG config, data and cache stay beneath `.ozi/desktop`. `HOME` is preserved.

Drive Electron only on the Linux server under Xvfb; never launch it on a Mac. Install Xvfb, xauth, Electron's GTK, NSS, ALSA, GBM and X11 libraries, plus a compiler, pkg-config and `libsecret-1-dev`.

```sh
OZI_DESKTOP_TEST=1 xvfb-run --auto-servernum -s '-screen 0 1440x1000x24' pnpm dev:desktop
```

`OZI_DESKTOP_TEST=1` adds `--password-store=basic` and `--ozone-platform=x11` on Linux, or `--use-mock-keychain` on macOS. Only the dev launcher reads this flag; the production launcher and packaged main process do not add these switches.

For Playwright, also set `OZI_DESKTOP_AUTOMATION=1`. The `[desktop-dev] ready` JSON line supplies `cwd`, `electronPath`, `args` and `env` for `_electron.launch`. Merge that environment with the caller's and remove `ELECTRON_RUN_AS_NODE`. Playwright owns Electron's lifecycle; the dev runner keeps Vite and the Electron compiler watching. Renderer edits apply to the running app; after server or Electron edits, close and relaunch Electron with the same launch configuration.

```sh
OZI_G3_MEASURE=1 OZI_G3_SCREENSHOT_DIR=/tmp/ozi-g3-screenshots ~/ozi-fleet/heavy.sh xvfb-run --auto-servernum -s '-screen 0 1440x1000x24' node_modules/.bin/vp test run --root e2e g3.desktop-dev.test.ts
```

`G3.desktop-dev` runs only on Linux, with a real Electron app, server, SQLite and temporary `OZI_HOME`. It completes onboarding, clicks Settings, edits a renderer source file, awaits HMR and restores the file. It checks the Electron profile and unchanged `HOME`.

To verify the macOS inset without a Mac, the test sets `OZI_DESKTOP_TEST_PLATFORM=darwin`. The watched dev preload then uses the actual macOS inset code; Playwright sets `navigator.platform` to `MacIntel` before reload to select the actual macOS renderer layout. Production compilation ignores this override. At 80%, 100% and 150% zoom, before and after reload, both the sidebar brand and toggle must start beyond the native 90-point controls area. The compact layout is also checked at 150%. Screenshots show the forced layout, without native macOS buttons.

## G3 evidence

On Linux x64 under `xvfb-run --auto-servernum`, the final focused scenario passed in 46.57 s. From spawning the dev runner, preparation took 4.407 s and the first visible app screen took 19.237 s; Electron launch through that screen took 14.828 s. A renderer source edit appeared through HMR in 0.867 s, measured before capturing its screenshot. `OZI_G3_MEASURE=1` enables these measurements and writes `g3-timings.json` beside the screenshots; timings never determine pass/fail.

Startup exceeds the 10 s target: dev mode loads the source backend and transforms the unbundled renderer rather than using release artifacts. The full scenario also captures seven screenshots and exercises six zoom/reload combinations plus the compact sidebar. Warm Vite and watched Electron compilation keep renderer edits below a second. Fleet resource-lock waits are outside these measurements. Desktop, web and scripts targeted typechecks and lint passed. The E2E project uses the repository's 60 s ceiling; host-platform reads and opt-in benchmarking have file-scoped lint exceptions. Existing unit fixtures were aligned with the profile path; the new coverage is E2E only.

Screenshots: [Linux desktop](screenshots/g3-desktop.png), [Settings click](screenshots/g3-settings.png), [live reload](screenshots/g3-live-reload.png), forced macOS layout at [80%](screenshots/g3-macos-layout-0.8.png), [100%](screenshots/g3-macos-layout-1.png), [150%](screenshots/g3-macos-layout-1.5.png), and [compact](screenshots/g3-macos-layout-compact.png). The brand and sidebar toggle clear `90 / zoom` CSS pixels before and after reload. No app was launched on a Mac, and no production or release build was run. All dev processes were stopped.

## Verifying a new feature

1. **E2E**: the feature's scenarios in one test file, with fake providers.
2. **Real behaviour**: open the dev app in a browser, pair, and give real Ozi (Pi with Opus on the subscription) the scenario through the composer. Check the reply, the inbox and the workers against what the scenario expects, take screenshots, and attach them to the PR. Agents use T3's shared browser tools (open, click, type, screenshot, read the page; one tab per agent, watchable in the browser panel) or Playwright.
3. **Second look**: for bigger features, another agent reruns the scenario before merging.
4. **Desktop-only details** (window buttons, dock badge): use desktop dev mode under Xvfb on the Linux server, driven by Playwright's Electron support. Force the macOS title-bar layout there to check its inset; never launch the app on a Mac.

F1 isolation and CLI scenarios: `vp test run --root e2e`. They use temporary git checkouts and worktrees, with ambient live-home sentinels. No provider transport is needed for identity checks.

Web-client scenarios start Vite, a real server and Chromium; one run takes 20–30 seconds on the shared machine, so the E2E timeout is 60 seconds.

## CI

Typecheck and lint only.

## F1 baseline evidence

The foundation scenarios in `e2e/f1.foundation.test.ts` pass against real temporary git checkouts and a real isolated server. They cover checkout and worktree home selection, the public CLI identity, and JSON pairing with a temporary T3-home sentinel left untouched. The focused run took 7.9 seconds. Workspace typecheck passed all 36 packages; lint passed with four inherited warnings.

The dev app was paired in the shared browser and a real Claude Opus 5.5 turn replied “Ozi is ready.” These screenshots preserve the rebuild's initial baseline: [paired chat](screenshots/f1-chat.png) and [About with upstream credit](screenshots/f1-about.png). The Ozi Pi harness default arrives in H2. Production and desktop bundles were not built.

## I1 baseline evidence

`e2e/i1.tickets.test.ts` uses a real isolated server, SQLite, CLI and WebSocket clients. It covers structured content, two subscribers, transcript access, caller validation, delegated-task provenance, all clearance types, archive search and server restart. No provider turn is needed: the worker is created through T3's real delegation command and fails workspace preparation before provider startup. Each scenario uses the standard E2E timeout. The complete file takes about a minute because each CLI invocation starts the Effect runtime; individual package checks and lint take seconds.

The dev app was paired in the shared browser, and its authenticated WebSocket client received the initial `tickets.subscribe` snapshot. [Paired app](screenshots/i1-paired.png). I1 has no inbox UI or MCP tools; those checks arrive with I3 and I2. The dev server was stopped after the check.

## H2B evidence

The focused H2B E2E scenario passed in 21.6 seconds. It starts real server, Pi and Claude Code processes and invokes the CLI for both turns; startup and those process boundaries account for the time beyond the inner-loop target. Only the Anthropic transport is faked. Typechecks passed for contracts, provider-pi, server, web and scripts; lint passed on the changed code.

In the shared browser, a newly paired dev app selected Ozi by default. A real Claude subscription turn replied “I'm Ozi, your one point of contact” and described delegation and verification. The composer showed high effort; the picker offered Ozi alongside Codex, Claude and an ACP instance, and switching tabs worked. [Chat](screenshots/h2b-ozi-chat.png), [picker](screenshots/h2b-ozi-picker.png). Fleet lock contention delayed checks before execution. No production or desktop builds were run.

## G1 device checkpoint

`e2e/g1.removal.test.ts` starts an isolated real server and uses the public CLI and ACP stdio bridge to verify that orchestration tools remain while device tools are absent. The scenario passed in 4.7 seconds. Targeted checks covered contracts, client runtime, server, web, mobile, provider core, ACP, Cursor, Muse, OpenCode, scripts and evals. The paired dev GUI loaded Browser settings without console errors: [devices removed](screenshots/g1-browser-without-devices.png). The rest of G1 remains unfinished.

## I3 baseline evidence

`e2e/i3.inbox.test.ts` starts the checkout's dev runner in a temporary home, creates chats and tickets over the authenticated WebSocket and drives the web client with Playwright Chromium. It covers groups and counts with a live arrival, the first row open with need, summary, numbered choices and actions, Got it archiving and opening the next, and archive search. The file takes about 25 seconds: setup is dev server start and Vite's first transform of the web app; each `ozi` CLI call costs about 2.6 seconds of runtime start, so setup uses only `auth` and `pair`, in parallel. The E2E hook ceiling equals the 30-second test ceiling. Running jobs need a live provider, so Working was checked in the dev app: a real Claude turn delegated a worker that showed under Working until its task ended. Inbox, Got it and archive search were also used there by hand.

## C4 baseline evidence

The remote E2E uses a real server, SQLite and separate client homes. It covers
single-use pairing, owner-only session storage, remote thread reads, expiry,
revocation, reconnect, restricted scopes, disconnect and local-server precedence.
The file takes about a minute because each CLI call starts the Effect runtime.
Server startup is its own scenario under the standard E2E timeout.
The initial remote run passed all five scenarios. After rebasing, startup and
pairing passed; later scenarios hit process deadlines under host load. An
independent `ozi --help` took 33.9 seconds with 4.5 seconds of CPU time.
The Linux acceptance run must refresh the complete remote result.
The 56 service and Tailscale contract tests passed on macOS using temporary files
and injected host/process boundaries; no live service manager was invoked.

The dev web client paired with a second isolated backend and showed it as
Connected in [Environments](screenshots/c4-remote.png). Both servers were stopped
afterward. Live Linux lifecycle and two-machine routes remain the orchestrator's
acceptance check in [the deployment recipe](headless-linux.md).
