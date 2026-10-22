# Progress

Milestone: 6 in progress. Fake-agent E2E passes for M1–M5 on `main` (CI sharded across three runners). Real-agent runs R1–R4 done with findings being fixed; R5–R6 and the desktop check follow the open fixes.

## Done

- Fork pinned at T3 v0.1.1 (`fe27e8e`); `origin` = github.com/JohanSardar/ozi (public). Work lands as PRs merged on green CI.
- Data root `~/ozi` (git): `prompt.md` verbatim, `protected/`, `skills/`. Pi 1.4.0.
- SPEC.md, features.yaml, `scripts/features.ts` (check + HTML; reads all `e2e/results*.json`).
- M1: other providers, mobile and marketing cut. Main = Pi + Opus 5.5 on the user's Claude subscription through `pi-claude-bridge` (Claude Agent SDK; `--provider claude-bridge --model claude-opus-5-5`, thinking high, fast off), no built-in tools, verbatim data-root prompt, 27 Ozi MCP tools; default worker Codex gpt-6.1-sol xhigh Fast. `ozi` CLI with `--json`. Fake-agent harness plus real-binary checks (real Pi, real bridge, pinned Claude Code against a fake Anthropic endpoint).
- M2: one main conversation, JobPanel per the mockup, worker drawer; Jobs cards via `ozi.jobs.get|subscribe|handle`; CLI `jobs`, `job`, `answer`, `close`, `wait job`.
- M3: every claim checked by an isolated native fork; continue/needs_user/blocked; exact disposition; checkpoints/finalization/settlement cut.
- M4 information-in: schedules and webhooks bound to main, quiet jobs, self-hosted webhook URL, test clock, external to-dos from one MCP source.
- M5: mistake log, replay in real bwrap (no network; trusted inference proxy using the host's OAuth logins), protected rules, user-only override; robust on 2-vCPU runners with specific failure causes.
- Desktop: Ozi has its own identity everywhere (`~/.ozi`, `ozi` shim, Electron profile `ozi`, app id `com.ozi.app`); an audit check forbids T3 identity strings.

## Real-agent runs (Ubuntu server under systemd, real Opus main on the subscription, real workers)

- R1 (M1): main answered "Paris" directly; delegated a file task to a real Codex worker (card Ready after a real check, main reported); Claude worker (kernel version) and Pi worker (CPU count) on request; attachment read correctly; steer, queue and stop work. Findings: Pi's catalog offered an unusable `default` model and the retry made a second card; a stopped job showed "Checking" (fix in progress).
- R2 (M2): a real worker asked "What is your favorite color?" (red/green/blue) → card Needs you → answered with `ozi answer` → the owning worker resumed → Ready.
- R3 (M3): real checks on every claim (11 main checks: 7 done, 3 superseded, 1 needs_user; token cost recorded); exact close → Done; stale close rejected (`StaleEvent`). The CLI printed a stack trace with that error (fix in progress).
- R4 (M4): a real interval schedule woke main, which delegated quietly and reported nothing below threshold; a real webhook POST woke main, which reported the shipment. Finding: the worker's checker marked the routine result useful, so the quiet job surfaced (fix in progress).
- R5 (M5): main logged the user's correction, but repair never started: corrections were recognized only when the user's text contained the internal fingerprint. Fix in progress (explicit, server-verified correction references; Claude Code replays routed through the proxy).
- Desktop: the Ozi app on a second Mac (MacBook Air) paired with the Ubuntu server over Tailscale. Findings: the first build used T3's `~/.t3` state and rewrote the T3 CLI shim on that Mac (restored; fixed and guarded); with the local environment off the app waited forever (fix in progress); a fresh machine had no data root (fix in progress).

## Next

- Merge: M6 publish/undo (#5), M4 removals + branding (stacked PRs), the open real-run fixes.
- Then: M6 audit and public-ready, real runs R5–R6, desktop check on the second Mac.
