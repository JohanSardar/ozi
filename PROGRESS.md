# Progress

Milestone: 3 (Completion) in progress. M1 and M2 fake-agent E2E pass; their real-agent runs are blocked (below).

## Done

- Fork pinned at T3 v0.1.1 (`fe27e8e`); `origin` = github.com/JohanSardar/ozi (public, not pushed yet).
- Data root `~/ozi` (git): `prompt.md` verbatim, `protected/`, `skills/`. Pi upgraded to 1.4.0.
- SPEC.md, features.yaml, `scripts/features.ts` (check + HTML).
- M1: other providers, mobile and marketing cut (2,079 files, −442K lines). Main = Pi `claude-opus-5-5`, thinking high, fast off, no built-in tools/extensions/skills/context files, verbatim data-root prompt, 24 orchestration MCP tools + `read_skill`; default worker Codex gpt-6.1-sol xhigh Fast; effective loadout on each thread. `ozi` CLI (serve, service, pair, status, say, steer, stop, thread, wait; `--json`). Fake-agent harness: fake pi/codex/claude speak native protocols from scripts and call real MCP.
- **M1 fake-agent E2E: 14/14**; `features.ts check 1` ok. E2E setup always rebuilds the web bundle (a stale bundle had hidden a fix).
- M2: one main conversation (T3 thread list, projects, drafts and the 16K-line ChatView/composer replaced by a 477-line Conversation with queue/steer, stop, attachments, markdown, HTML renders, MCP apps), JobPanel per the mockup, worker drawer. Jobs: `jobId`/`visibility`/`handledEventId` on threads, cards via `ozi.jobs.get|subscribe|handle`, CLI `jobs`, `job`, `answer`, `close`, `wait job`.
- **M2 fake-agent E2E: 26/26 with M1**; `features.ts check 2` ok.
- macOS desktop build pipeline proven on the build Mac (arm64 DMG, unsigned).
- `chore/ci` branch: one Ozi CI workflow (typecheck, lint, fake-agent E2E, feature graph) replacing T3's 13 workflows.

## Blocked

- Pi/Opus main: Pi runs Opus 5.5 on the Claude login, but Anthropic answers "out of extra usage". Needs extra usage on the Claude account (or an Anthropic API key); no credits bought.
- Desktop on the laptop: SSH (Remote Login) is off.
- GitHub push: gh token lacks the `workflow` scope and T3's history contains workflow files; needs `gh auth refresh -h github.com -s workflow`.

## Next

- M3 Completion, M4 information-in and M5 Repair running in parallel; M4 cuts after M3 lands; then M6.
- Once pushing works: push main, PR `chore/ci`, then PR per slice.
- Real-agent runs for each milestone once the blockers clear.
