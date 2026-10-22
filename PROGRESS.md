# Progress

Milestone: 1 (Connection), in progress.

## Done

- Fork pinned at T3 v0.1.1 (`fe27e8e`); `origin` = github.com/JohanSardar/ozi (public, not pushed yet).
- Data root `~/ozi` (git): `prompt.md` verbatim, `protected/`, `skills/`.
- Pi upgraded to 1.4.0 (`@earendil-works/pi-coding-agent`).
- SPEC.md, features.yaml, `scripts/features.ts` (check + HTML).
- M1 main agent merged: Pi `claude-opus-5-5`, thinking high, fast off, no built-in tools/extensions/skills/context files; verbatim data-root prompt; 24 orchestration MCP tools + `read_skill`; default worker Codex gpt-6.1-sol xhigh Fast; effective loadout on each thread.

- M1 cut merged: Cursor, Grok, OpenCode, Muse, Antigravity, ACP, mobile and marketing removed (2,079 files, −442K lines); all packages typecheck.
- M1 `ozi` CLI (serve, service, pair, status, say, steer, stop, thread, wait; `--json`) and fake-agent E2E harness (fake pi/codex/claude speaking native protocols, scripted, calling real MCP) merged.
- **M1 fake-agent E2E: 14/14 pass** (`vp test run --root e2e`, 420 s); `features.ts check 1` ok. E2E setup now always rebuilds the web bundle (a stale bundle had hidden a fix).
- M2 UI merged: one main conversation (T3 thread list, projects, drafts, ChatView/composer replaced by a 477-line Conversation keeping queue/steer, stop, attachments, markdown, HTML renders, MCP apps), JobPanel per the mockup, worker drawer.
- macOS desktop build pipeline proven on the Air (arm64 DMG, unsigned; needs `SDKROOT` = macOS 26.5 SDK for the native resource monitor until that is cut). Ready to install on the MacBook Pro once SSH is on.
- Jobs wire contract (`OziJobCard`, evidence, errors, RPC names) in contracts.

## Blocked (real-agent runs)

- Pi/Opus main: Pi runs Opus 5.5 on the Claude login, but Anthropic answers "out of extra usage". Needs extra usage on the Claude account; no credits bought.
- Desktop on the MacBook Pro: SSH (Remote Login) is off.

## Next

- M1 build: cut providers/mobile/marketing/coding instructions; `ozi` CLI; restricted Pi main; fake-agent E2E harness and M1 scenarios.
