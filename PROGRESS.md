# Progress

Milestone: 3 (Completion) complete. Combined fake-agent E2E: 56/56; real-agent runs remain blocked (below). M4 cuts and M6 remain.

## Done

- Fork pinned at T3 v0.1.1 (`fe27e8e`); `origin` = github.com/JohanSardar/ozi (public, not pushed yet).
- Data root `~/ozi` (git): `prompt.md` verbatim, `protected/`, `skills/`. Pi upgraded to 1.4.0.
- SPEC.md, features.yaml, `scripts/features.ts` (check + HTML).
- M1: other providers, mobile and marketing cut (2,079 files, −442K lines). Main = Pi `claude-opus-5-5`, thinking high, fast off, no built-in tools/extensions/skills/context files, verbatim data-root prompt, 24 orchestration MCP tools + `read_skill`; default worker Codex gpt-6.1-sol xhigh Fast; effective loadout on each thread. `ozi` CLI (serve, service, pair, status, say, steer, stop, thread, wait; `--json`). Fake-agent harness: fake pi/codex/claude speak native protocols from scripts and call real MCP.
- **M1 fake-agent E2E: 14/14**; `features.ts check 1` ok. E2E setup always rebuilds the web bundle (a stale bundle had hidden a fix).
- M2: one main conversation (T3 thread list, projects, drafts and the 16K-line ChatView/composer replaced by a 477-line Conversation with queue/steer, stop, attachments, markdown, HTML renders, MCP apps), JobPanel per the mockup, worker drawer. Jobs: `jobId`/`visibility`/`handledEventId` on threads, cards via `ozi.jobs.get|subscribe|handle`, CLI `jobs`, `job`, `answer`, `close`, `wait job`.
- **M2 fake-agent E2E: 26/26 with M1**; `features.ts check 2` ok.
- M3 Completion: automatic atomic claims and outbox, isolated native checks for Pi/Codex/Claude, evidence-verified progress, durable recovery and supersession, per-round misses and token cost, `ozi checks` and `wait check`, exact report acceptance/verification/close. Checkpoint/diff capture, rollback, inactivity/PR auto-settle and finalization services cut with their contracts, UI, CLI and replay helpers. All 15 M3 scenarios pass; `features.ts check 3` ok. Completion cleanup follows Repair's migration for upgrades.
- M4 information-in merged: schedules (interval, time of day, webhook) bound to main; scheduled/webhook messages count as requests; quiet jobs surface only human needs or checked useful findings. Webhooks use a self-hosted base URL (`--public-url`); test clock; external to-dos from one MCP source (`ozi todos`, panel section, stale/unavailable states). All 6 information-in scenarios pass, including `m4.useful-card` and routine reports remaining quiet across restart.
- M5 Repair merged: `log_mistake` (one `ozi_mistakes` row, deduped), repair only on correction or repeat, frozen case replay (baseline must reproduce, candidate must pass, observer must agree), real bwrap with no network (inference via a trusted proxy socket), `protected/` read-only, publisher rejects protected changes/path escapes, user-only override. All 9 M5 scenarios pass in the combined 56/56 suite. Gap: proxy forwards API keys only; OAuth logins fail closed (fix in progress).
- macOS desktop build pipeline proven on the build Mac (arm64 DMG, unsigned).
- `chore/ci` branch: one Ozi CI workflow (typecheck, lint, fake-agent E2E, feature graph) replacing T3's 13 workflows.

## Blocked

- Pi/Opus main: Pi runs Opus 5.5 on the Claude login, but Anthropic answers "out of extra usage". Needs extra usage on the Claude account (or an Anthropic API key); no credits bought.
- Desktop on the laptop: SSH (Remote Login) is off.
- GitHub push: gh token lacks the `workflow` scope and T3's history contains workflow files; needs `gh auth refresh -h github.com -s workflow`.

## Next

- Running: M6 publish/undo and repair proxy OAuth fix. Next: M4 cuts + branding, then the M6 audit.
- Once pushing works: push main, PR `chore/ci`, then PR per slice.
- Real-agent runs for each milestone once the blockers clear.
