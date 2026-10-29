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

## Verifying a new feature

1. **E2E**: the feature's scenarios in one test file, with fake providers.
2. **Real behaviour**: open the dev app in a browser, pair, and give real Ozi (Pi with Opus on the subscription) the scenario through the composer. Check the reply, the inbox and the workers against what the scenario expects, take screenshots, and attach them to the PR. Agents use T3's shared browser tools (open, click, type, screenshot, read the page; one tab per agent, watchable in the browser panel) or Playwright.
3. **Second look**: for bigger features, another agent reruns the scenario before merging.
4. **Desktop-only details** (window buttons, dock badge): the GUI repo's T3 v0.1.5 desktop dev mode under a virtual display, driven by Playwright's Electron support; the Mac gives the final look. Not yet verified: today's repo has no desktop dev mode.

F1 isolation and CLI scenarios: `vp test run --root e2e`. They use temporary git checkouts and worktrees, with ambient live-home sentinels. No provider transport is needed for identity checks.

## CI

Typecheck and lint only.

## F1 baseline evidence

The foundation scenarios in `e2e/f1.foundation.test.ts` pass against real temporary git checkouts and a real isolated server. They cover checkout and worktree home selection, the public CLI identity, and JSON pairing with a temporary T3-home sentinel left untouched. The focused run took 7.9 seconds. Workspace typecheck passed all 36 packages; lint passed with four inherited warnings.

The dev app was paired in the shared browser and a real Claude Opus 5.5 turn replied “Ozi is ready.” These screenshots preserve the rebuild's initial baseline: [paired chat](screenshots/f1-chat.png) and [About with upstream credit](screenshots/f1-about.png). The Ozi Pi harness default arrives in H2. Production and desktop bundles were not built.
