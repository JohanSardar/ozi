# Progress

Milestone: 1 (Connection), in progress.

## Done

- Fork pinned at T3 v0.1.1 (`fe27e8e`); `origin` = github.com/JohanSardar/ozi (public, not pushed yet).
- Data root `~/ozi` (git): `prompt.md` verbatim, `protected/`, `skills/`.
- Pi upgraded to 1.4.0 (`@earendil-works/pi-coding-agent`).
- SPEC.md, features.yaml, `scripts/features.ts` (check + HTML).
- M1 main agent merged: Pi `claude-opus-5-5`, thinking high, fast off, no built-in tools/extensions/skills/context files; verbatim data-root prompt; 24 orchestration MCP tools + `read_skill`; default worker Codex gpt-6.1-sol xhigh Fast; effective loadout on each thread.

- M1 cut merged: Cursor, Grok, OpenCode, Muse, Antigravity, ACP, mobile and marketing removed (2,079 files, −442K lines); all packages typecheck.
- M1 `ozi` CLI (serve, service, pair, status, say, steer, stop, thread, wait; `--json`) and fake-agent E2E harness (fake pi/codex/claude speaking native protocols, scripted, calling real MCP) merged. First integrated run: 2/14 M1 tests pass (m1.fresh-install, m1.read-skill); integration fix in progress.
- Jobs wire contract (`OziJobCard`, evidence, errors, RPC names) in contracts.

## Blocked (real-agent runs)

- Pi/Opus main: Pi runs Opus 5.5 on the Claude login, but Anthropic answers "out of extra usage". Needs extra usage on the Claude account; no credits bought.
- Desktop on the MacBook Pro: SSH (Remote Login) is off.

## Next

- M1 build: cut providers/mobile/marketing/coding instructions; `ozi` CLI; restricted Pi main; fake-agent E2E harness and M1 scenarios.
