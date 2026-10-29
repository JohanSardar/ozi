# Ozi

A desktop and web app for agent harnesses. Forked from T3 Code v0.1.5.

Ozi keeps the upstream providers and is being rebuilt around chats, delegation and an inbox. See the [redesign spec](docs/ozi/ui-redesign.md), [tickets](docs/ozi/rebuild-tickets.md) and [verification guide](docs/ozi/building-and-verifying.md).

```sh
pnpm install --frozen-lockfile
pnpm dev
node apps/server/src/bin.ts pair --home .ozi --json
```

Dev state lives in `.ozi` inside each checkout, including the main checkout. Installed Ozi uses `~/.ozi` or `OZI_HOME` and never reads T3 Code state or environment variables. The CLI is `ozi`; desktop identities are `Ozi Beta` / `Ozi Dev`, `com.ozi.app` / `com.ozi.app.dev`, profiles and URL schemes `ozi` / `ozi-dev`.

CI runs `pnpm typecheck` and `pnpm lint`. No release or deployment workflows are enabled.

T3 Code's MIT license and upstream third-party notices are preserved in [LICENSE](LICENSE) and [third-party-licenses](third-party-licenses).
