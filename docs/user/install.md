# Install Ozi

Forked from T3 Code. Use the source checkout for the GUI rebuild:

```sh
git clone https://github.com/JohanSardar/ozi.git
cd ozi
pnpm install --frozen-lockfile
pnpm dev
node apps/server/src/bin.ts pair --home .ozi --json
```

Open the pairing URL on the web port printed by `pnpm dev`. Every checkout, including the main checkout, keeps its state in its own `.ozi` directory.

The public CLI command is `ozi`; installed state uses `~/.ozi` or `OZI_HOME`. Ozi never reads T3 Code environment variables, homes or browser profiles. Desktop identities are Ozi Beta / Ozi Dev, app IDs com.ozi.app / com.ozi.app.dev, profiles and URL schemes ozi / ozi-dev.

Use this fork's [GitHub releases](https://github.com/JohanSardar/ozi/releases) for distribution artifacts. T3 Code's installers and package-manager entries install the upstream product. Release workflows are disabled during the rebuild.

See [building and verifying](../ozi/building-and-verifying.md) for the development workflow.
