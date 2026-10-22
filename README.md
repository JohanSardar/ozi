# Ozi

An agent runtime with desktop and web clients. Talk to one main agent; it delegates work and keeps every job on a card.

Providers: Pi, Claude and Codex.

Main runs Pi with `claude-bridge/claude-opus-5-5`, high thinking and fast mode off, using the user's Claude subscription through Claude Code and the Claude Agent SDK. Ozi includes pinned [pi-claude-bridge](https://github.com/elidickinson/pi-claude-bridge) (MIT, © 2026 Eli Dickinson); no `pi install` step is needed. Main sees only Ozi's MCP tools. User Claude hooks, MCP servers, skills and CLAUDE.md are excluded.

- [Product specification](SPEC.md)
- [Requirements and milestones](features.yaml)
- [Repository rules](AGENTS.md)
- [Development guide](docs/operations/development.md)

Forked from T3 Code v0.1.1. [MIT](LICENSE).
