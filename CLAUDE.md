# Ozi

Agent runtime with a desktop app: one main agent the user talks to, which delegates work to workers and keeps every job on a card. Forked from T3 Code v0.1.5. Read `docs/ozi/ui-redesign.md`, `docs/ozi/rebuild-tickets.md` and `docs/ozi/building-and-verifying.md` first.

## Rules

- Minimal: fewest words, least code. No code comments, no TODOs, no placeholders, no disabled code.
- Cutting removes the whole vertical slice: callers, schema, UI, dependencies, tests.
- New tests are E2E only (`e2e/`): real server, SQLite, files, git, web client and `ozi` CLI. Fake only provider transports (`e2e/fakes`), the clock and external MCP. Await observable state, never sleeps. Run a feature's scenarios while building it the first time; CI runs only typecheck and lint. A unit test needs a written reason why E2E can't reach it.
- Name each E2E test by its ticket or spec scenario ID first.
- Keep the redesign spec and rebuild tickets current in the same change as the code. The GUI does not yet have the harness's `SPEC.md`, `features.yaml` or milestone checker.
- Everything goes through the `ozi` CLI (`--json`) where supported. Extend it when a feature needs a missing command; no one-off runtime scripts.
- Correction ladder for every mistake: make it impossible (types, structure), else a lint or check, else prompt or skill text.
- No personal data, paths, accounts or secrets in the repo.
- Keep MIT notices for T3 Code, Pi and Firstmate. Preserve the credit "Forked from T3 Code".

## Safety

- Never kill by pattern (`pkill -f`, `pgrep | kill`). Kill only PIDs you started.
- Never touch `~/.t3`, `~/.ozi` or `~/ozi`: they are live installs. Dev uses `<checkout>/.ozi`; tests use temp homes and temp data roots. Never seed dev state from a live install.
- Never set `VITE_HTTP_URL` or `VITE_WS_URL`.
- No production or desktop builds during development.

## Commands

- `pnpm install --frozen-lockfile`; `vp` is `node_modules/.bin/vp`.
- Dev: `pnpm dev`. Pair: `node apps/server/src/bin.ts pair --home .ozi --json`.
- Targeted typecheck: `vp run --filter <pkg> typecheck`. Lint: `vp lint <paths>`.
- CI: `pnpm typecheck` and `pnpm lint` only.
- E2E files live in `e2e/`; run with `vp test run --root e2e`.
- Server code is Effect. See `docs/internals/effect-services.md` and `.repos/effect-smol/LLMS.md`.
