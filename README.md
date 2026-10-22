# Ozi

Talk to one main agent. It delegates real work to Codex, Claude or Pi workers. Every job stays on a card until handled. Mistakes get tested fixes.

Requires Linux, Node.js 24+, pnpm, Git and bubblewrap (`bwrap`). Install and authenticate the Pi CLI with Anthropic access for main, and Codex or Claude CLIs for workers.

Install from source:

```sh
git clone https://github.com/JohanSardar/ozi.git
cd ozi
pnpm install
pnpm build
npm install --global ./apps/server
mkdir -p ~/ozi/skills ~/ozi/protected
git init ~/ozi
cp e2e/fixtures/data-root/prompt.md ~/ozi/prompt.md
ozi serve --json
```

The data root defaults to `~/ozi`: `prompt.md` is main's prompt (up to 400 words), `skills/` holds skills, and `protected/` holds rules self-repair cannot change. Use `--data-root` or `OZI_DATA_ROOT` to choose another directory. Server state lives separately in `~/.ozi` (`--home` or `OZI_HOME`).

With the server running, use `ozi pair --json` and open its pairing URL in the desktop app. For another machine, run `ozi serve --host 0.0.0.0 --json` and use the server's reachable address in that URL.

Run `ozi --help` for commands. See [SPEC.md](SPEC.md) for behavior.

Based on [T3 Code](https://github.com/pingdotgg/t3code) v0.1.1. [MIT](LICENSE); [Pi and Firstmate notices](THIRD_PARTY_NOTICES.md).
