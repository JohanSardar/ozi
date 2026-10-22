# Progress

Milestone 6 passed. Fake-agent E2E for M1–M6 passes on `main` (98 tests, CI sharded across three runners; `node scripts/features.ts check 6` ok: every requirement has a feature, all 24 features passing). Real-agent runs R1–R6 passed on the Ubuntu server under systemd with the desktop app on the MacBook Pro.

## Done

- Fork pinned at T3 v0.1.1 (`fe27e8e`); `origin` = github.com/JohanSardar/ozi (public). Work lands as small PRs merged on green CI.
- Data root `~/ozi` (git): `prompt.md` verbatim, `protected/`, `skills/`. Pi 1.4.0.
- SPEC.md, features.yaml, `scripts/features.ts` (check + HTML; reads all `e2e/results*.json`).
- M1: other providers, mobile and marketing cut. Main = Pi + Opus 5.5 on the user's Claude subscription through `pi-claude-bridge` (Claude Agent SDK; `--provider claude-bridge --model claude-opus-5-5`, thinking high, fast off), no built-in tools, verbatim data-root prompt, Ozi MCP tools only; default worker Codex gpt-6.1-sol xhigh Fast. `ozi` CLI with `--json`. Fake-agent harness plus real-binary checks (real Pi, real bridge, pinned Claude Code against a fake Anthropic endpoint). Fresh installs seed the data root.
- M2: one main conversation, JobPanel per the mockup, worker drawer; Jobs cards via `ozi.jobs.get|subscribe|handle`; CLI `jobs`, `job`, `answer`, `close`, `wait job`.
- M3: every claim checked by an isolated native fork against the originating request; continue/needs_user/blocked; exact disposition; checkpoints/finalization/settlement cut.
- M4: schedules and webhooks bound to main, quiet jobs, self-hosted webhook URL, test clock, external to-dos from one MCP source; devices, simulators, terminal, source control, pull requests, T3 Connect/cloud/relay, analytics, onboarding, quotas, launch workflows and self-updates cut.
- M5: mistake log, explicit server-verified correction references, replay in real bwrap (no network; trusted inference proxy using the host's OAuth logins), protected rules, user-only override.
- M6: publish as one data-root commit activated on the next turn, recurrence undo and manual undo with crash-safe journal; gardener audit (E2E-only tests, Knip clean, no retired imports/settings/instructions/comments, no T3 identity); public-ready README, LICENSE and third-party notices (T3 Code, Pi, Firstmate, pi-claude-bridge, Claude Agent SDK) with a tracked-file privacy check.
- Desktop: own identity (`~/.ozi`, `ozi` shim, Electron profile `ozi`, app id `com.ozi.app`); picks the saved remote server; Linux desktop E2E under Xvfb.

## Real-agent runs (Ubuntu server under systemd, real Opus main on the subscription, real workers)

- R1 (M1): main answered directly, delegated to real Codex, Claude and Pi workers; attachment, steer, queue and stop. Fixed: unusable Pi `default` model, duplicate card on retry, stopped job shown as Checking.
- R2 (M2): a real worker asked a question → card Needs you → `ozi answer` → the owning worker resumed → Ready.
- R3 (M3): real checks on every claim (done, superseded, needs_user; cost recorded); exact close → Done; stale close rejected as one-line `StaleEvent`.
- R4 (M4): a real schedule woke main, which delegated quietly and reported nothing; a real webhook POST woke main, which reported. Fixed: checker now judges usefulness against the originating request.
- R5 (M5): the user corrected an answer format; main logged it with the correction reference; the repair replayed the frozen case in bwrap, passed and shipped one data-root commit (`fix: repair …`).
- R6 (M6): the next turn answered in the repaired format ("Aconcagua (6,961 m)"); manual undo reverted the commit cleanly.
- Desktop (MacBook Pro, final build): the app paired with the Ubuntu server with the local environment off and showed main and the job cards. A message sent from the Pro made main delegate to a real Codex worker, which asked a multiple-choice question; answering on the card resumed it, the check passed, the card went Ready, main reported, and closing it moved it to Done. Fixed from this run: long briefs hid the job transcript, card reports showed raw markdown and overflowed on long code lines, the no-server screen was unstyled.

## Limits

- The Pro's outbound Tailscale TCP fails (two Tailscale daemons run there), so its app reaches the server through an SSH tunnel over Tailscale via the Air.
- Once during the Pro run, main's conversation stayed scrolled to the top after a job report; three further attempts (plain turn, server restart, delegated job) did not reproduce it.
- External to-dos are verified with fake MCP sources; the real Apple Reminders source on the Air returned an empty list.
