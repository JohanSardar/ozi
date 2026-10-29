# Rebuild tickets

The work in `ui-redesign.md`, split into tickets. A ticket starts when everything under **Needs** has merged; tickets in the same wave run in parallel. Every ticket is done when its E2E file passes and a real Ozi check in the dev GUI passes, with screenshots in the PR (`building-and-verifying.md`). Repo: **GUI** is `ozi`, **H** is `ozi-harness`.

| ID  | Ticket                                                                                                                              | Repo   | Needs      | Wave |
| --- | ----------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- | ---- |
| F1  | GUI repo: fresh T3 Code v0.1.5 fork, Ozi names, icons and app IDs, MIT notices, isolated dev loop, CI typecheck and lint            | GUI    | —          | 0    |
| H1  | Rename this repo to `ozi-harness`; remotes, deploy folder, docs                                                                     | H      | —          | 0    |
| G1  | Remove projects, git, worktrees, diffs, pull requests and devices; keep every provider including ACP                                | GUI    | F1         | 1    |
| G3  | Desktop dev mode under a virtual display with Playwright; nothing under the macOS window buttons                                    | GUI    | F1         | 1    |
| L2  | Top bar spinner and elapsed time; Reply on any assistant text                                                                       | GUI    | F1         | 1    |
| L3  | Composer: steer, queue, stop and attachments (images, video, files) behave as in T3                                                 | GUI    | F1         | 1    |
| L4  | Look: 6–8px corners; no pills, coloured dots or monospace capitals; themes and theme editor                                         | GUI    | F1         | 1    |
| I1  | Ticket store and contracts: groups, visible, clickable and in-depth parts, automatic links, clearing record, archive                | GUI    | F1         | 1    |
| C1  | Schedules and webhooks on the GUI                                                                                                   | GUI    | F1         | 1    |
| C3  | Sessions: new, fork, clone, resume, import, export, print mode                                                                      | GUI    | F1         | 1    |
| C4  | Remote pairing, Tailscale, systemd service, deploy recipe                                                                           | GUI    | F1         | 1    |
| H2  | Ozi harness Pi package (`system.md`, `adhd.md`, skills, delegation); the GUI runs it as the default "Ozi"                           | H      | H1, F1     | 1    |
| G2  | Rename `t3` to `ozi` in MCP server and tool names and descriptions; drop T3 examples and project wording                            | GUI    | G1         | 2    |
| G4  | Settings window trimmed to the agreed sections                                                                                      | GUI    | G1         | 2    |
| L1  | Sidebar: search, New chat, Needs you, Working, Pinned, Recent, spinners                                                             | GUI    | G1, I1     | 2    |
| I3  | Inbox panel: groups, rows that open in place, choices 1–3, reply box, Got it, Archive tab with search, Working section              | GUI    | I1         | 2    |
| H4  | Self-repair in the harness; `ozi-harness` mistakes, replays, fixes, undo                                                            | H      | H2         | 2    |
| C5  | Migrate the live install: main history, sessions, schedules, secrets, data root                                                     | GUI, H | H2, C1, C3 | 2    |
| I2  | Ticket tools `ticket_create`, `ticket_update`, `ticket_close`, `ticket_list` for every agent; IDs attached from the calling session | GUI    | I1, G2     | 3    |
| I4  | Ticket window (Open details) over the app; click outside or send to close                                                           | GUI    | I3         | 3    |
| I8  | Desktop notification and dock badge, with settings                                                                                  | GUI    | I1, G4     | 3    |
| L5  | Handoff line "↳ job · waiting on you" opens its ticket                                                                              | GUI    | I3         | 3    |
| I5  | Typed replies go into the current chat with a "↩ ticket" quote and the ticket's context                                             | GUI    | I2, I3     | 4    |
| I6  | Choosing an option answers the asking agent and notes it in the chat                                                                | GUI    | I2, I3     | 4    |
| P1  | Inbox plugin for Claude Code: Stop hook forks with `--resume --fork-session`; "Inbox check" step in the work log                    | GUI    | I2         | 4    |
| P2  | Inbox plugin for Codex: `stop` hook forks with `thread/fork`                                                                        | GUI    | I2         | 4    |
| P3  | Inbox plugin for Pi: turn-end extension forks with `--fork`                                                                         | GUI    | I2         | 4    |
| H5  | Completion checks in the harness: main checks worker claims before filing Review tickets                                            | H      | H2, I2     | 4    |
| C2  | `ozi` CLI and terminal app on the new server, including the inbox                                                                   | GUI    | I2         | 4    |
| I7  | Clearing: answered, replied, Got it, or closed by an agent after a chat acknowledgement; "✓ Closed" in the chat                     | GUI    | I5, I6     | 5    |
| H3  | The harness ships the Pi inbox plugin                                                                                               | H      | H2, P3     | 5    |
| C6  | Real-agent parity run against the current build, then cutover of the live server                                                    | GUI, H | all        | 6    |

F1 implementation: Ozi identities, isolated checkout dev homes with no live-state seeding, neutral blue icons, inherited notices, Ozi agent rules, and a single typecheck/lint workflow. Internal packages and MCP namespaces stay upstream-named; MCP renaming belongs to G2.

L4 implementation: the radius scale tops out at 8px; pills became 6–8px rectangles; status dots became spinners or plain labels; forced capitals became sentence case. `e2e/l4.look.test.ts` checks the radius tokens and fails on pills, coloured dots and forced capitals anywhere in the web app. Screenshots: [working](screenshots/l4-working-dark.png), [chat dark](screenshots/l4-chat-dark.png), [chat light](screenshots/l4-chat-light.png), [settings](screenshots/l4-settings-dark.png), [theme editor](screenshots/l4-theme-editor-light.png).

L3 implementation: the composer keeps T3's steer, queue, stop and attachment behaviour with the prototype's look. While a turn runs, the placeholder reads "Steer, or ⌘Enter to queue…", a hint shows which key steers and which queues, and the stop button is the dark square shown when the composer is empty. Queued messages are dashed, right-aligned bubbles with a Queued label, Send now, Edit and remove. `e2e/l3.composer.test.ts` drives the web client against a real server and a fake Pi through steer, queue, stop, send now and image, video and file attachments. Screenshots: [working with a queued message](screenshots/l3-working-queued.png), [attachments while steering](screenshots/l3-attachments-steer.png).

Open: the current build's external to-dos (M4) are not in the redesign spec.

I1 implementation: structured ticket contracts, migration 73 in T3's SQLite database, automatic thread/chat/task/worker/session/message provenance, immutable clearance records, archive search, authorized RPC and live snapshots. `ozi ticket create|update|close|get|list|subscribe --input '<json>' --json` provides the CLI boundary. E2E: `e2e/i1.tickets.test.ts`. UI and MCP tools remain I3 and I2.

H2B implementation (GUI half of H2): bundled Pi 1.4 loads the pinned `@ozi/pi` package from harness PR #81 as the default **Ozi** provider, with the Claude subscription bridge, isolated Pi state and a configurable data root. All existing providers remain. `e2e/h2b.ozi.test.ts` exercises real Pi, Claude Code, the server and CLI against a fake provider transport: default routing, prompt/ADHD reload, MCP round trip, high thinking, fast off and API-key exclusion. The paired dev GUI also completed a real subscription turn and switched provider tabs. Screenshots: [Ozi reply](screenshots/h2b-ozi-chat.png), [provider picker](screenshots/h2b-ozi-picker.png).

G1 progress: simulator/emulator panels, hosts, streams, RPCs, MCP tools, settings, provider instructions, models and dedicated tests are removed. Browser streaming uses its own access contract. Every provider remains, including ACP; device-code authentication and machine-level provider overrides remain. Projects, git, worktrees, diffs, pull requests and project-bound chats still remain; G1 is not complete.
