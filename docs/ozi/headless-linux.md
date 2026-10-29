# Headless Linux server

Run the GUI server on Linux with systemd user services. Agents, provider logins,
files and conversations stay on that server. Clients pair directly; no cloud
account or relay is required.

## Install the rebuild

Install Git, Node 26.12.1, pnpm 12.14.0 and Claude Code. Run `claude auth login`
as the service user for the default Ozi agent's Claude subscription. Other
providers are selectable in the client and need their own CLI login. Check
that the provider CLI works in a non-interactive login shell. Keep this checkout
in place while its service runs.

```sh
git clone https://github.com/JohanSardar/ozi.git ozi-gui
cd ozi-gui
pnpm install --frozen-lockfile
sudo loginctl enable-linger "$(id -un)"
mkdir -p "$HOME/.ozi-headless"
printf 'OZI_PORT=3773\nOZI_HOST=127.0.0.1\n' > "$HOME/.ozi-headless/service.env"
chmod 600 "$HOME/.ozi-headless/service.env"
node apps/server/src/bin.ts service install --home "$HOME/.ozi-headless" --unit ozi-headless.service --current-runtime --json
node apps/server/src/bin.ts service status --home "$HOME/.ozi-headless" --unit ozi-headless.service --json
```

`--current-runtime` runs this checkout through the existing service launcher;
it does not download a release. It also works with an installed Ozi executable.
The named unit keeps this install separate from any existing `ozi.service`.
`--home` selects state and `service.env`; it does not select the unit. Pass the
same home and unit to every service command. Run Ozi as your normal user.
The systemd unit retains the installer's PATH so user-installed provider CLIs
remain available after logout. Run install again after changing that PATH.
Custom unit names require Linux; they cannot select a macOS launch agent.
Install and uninstall refuse a unit belonging to another Ozi home. Choose a
separate unit name and home for each install.

For the rebuild's web client, run `pnpm dev` in a separate checkout using its
own home and ports, then add this server in **Settings → Connections →
Environments → Add environment**. Packaged clients can use the same pairing
URL. The source-only server has no compiled web assets; use the dev web client
or a packaged desktop client rather than opening its backend port as a web app.

## Choose a route

### Direct network

Set `OZI_HOST` in `service.env` to the server's reachable LAN or VPN address,
then restart the named service. Allow its port through the firewall only for
the intended network. All clients still need a pairing token. For access over
an untrusted network, use Tailscale HTTPS or SSH below.

```sh
node apps/server/src/bin.ts service restart --home "$HOME/.ozi-headless" --unit ozi-headless.service --json
node apps/server/src/bin.ts pair --home "$HOME/.ozi-headless" --json
```

Paste `pairingUrl` into the receiving client's Add environment dialog. On a CLI
client with the rebuild installed, use `ozi connect '<pairing-url>' --json`.
Run `ozi thread list --project <server-workspace> --json` to check the saved connection. A live local server
under that client's home takes precedence; otherwise thread commands use the
saved remote. C2 adds the terminal app and inbox commands.

### Tailscale HTTPS

Join server and client to the same tailnet, enable MagicDNS and HTTPS certificates,
and authorize the service user to run Tailscale Serve. Keep the backend bound
to loopback. For a running server:

```sh
node apps/server/src/bin.ts pair --home "$HOME/.ozi-headless" --tailscale --json
```

This publishes a persistent, tailnet-only HTTPS route. If HTTPS port 443 already
serves another application, pass `--tailscale-serve-port 8443`; Ozi refuses to
replace another environment's responding endpoint. Removing Ozi's user service
does not remove Tailscale's route. Remove the port you configured explicitly:

```sh
tailscale serve --https=8443 off
```

### SSH port forward

Keep the backend bound to loopback. From the client machine:

```sh
ssh -N -L 4773:127.0.0.1:3773 user@server.example
```

Create a fresh pairing URL on the server with `ozi pair --json`. Replace only
its origin with `http://127.0.0.1:4773`, preserving `/pair#token=…`, then use
`ozi connect` or the desktop Add environment dialog. Keep the SSH process running.
For a web client using HTTPS, use the Tailscale HTTPS route to avoid mixed content.
The desktop's existing SSH connection option also manages remote server startup
and a tunnel; the manual forward above reuses your named service.

## Manage access and the service

Pairing links expire after five minutes by default and exchange once. Use a new
link for each client. The CLI saves its bearer session in `<client-home>/remote.json`
with mode 0600. It never saves the pairing token or prints the session secret.
An expired or revoked session requires `ozi connect` with a fresh link.
The CLI uses the server's MCP OAuth flow. Its default `--access full-access`
requires those scopes in the pairing link; use `--access read-only` for a link
created with only `--scope orchestration:read`.

```sh
ozi disconnect --json
node apps/server/src/bin.ts auth session list --home "$HOME/.ozi-headless" --json
node apps/server/src/bin.ts auth session revoke SESSION_ID --home "$HOME/.ozi-headless"
node apps/server/src/bin.ts service restart --home "$HOME/.ozi-headless" --unit ozi-headless.service --json
node apps/server/src/bin.ts service uninstall --home "$HOME/.ozi-headless" --unit ozi-headless.service --json
```

Disconnect forgets the CLI's saved session; revoke it on the server to end its
access. Uninstall disables and stops only the named unit and preserves data and
`service.env`. Status reports the unit path, log path, installed version and
problems such as disabled lingering or a stopped service. Read the reported log
and `journalctl --user -u ozi-headless.service` when startup fails.

After updating this source checkout and installing its locked dependencies,
restart the service to load the new code. Changing `service.env` also requires
a restart. Do not remove the checkout while its service is installed.

## Verification

On macOS, run the remote-client E2E and the service contract tests:

```sh
vp test run --root e2e c4.remote-service.test.ts
vp test run --root apps/server src/cloud/bootService.test.ts src/cli/pair.test.ts src/cli/service.test.ts
```

The service unit tests are an exception to the E2E rule: macOS cannot execute
Linux's systemd user manager. They exercise real temporary files with an
injected Linux host and process runner, never launchd or a live systemd service.
The inherited pairing tests cover Tailscale target selection and route conflicts
without changing the machine's Tailscale configuration.

The Linux orchestrator runs the live lifecycle scenario on a disposable account
with a working systemd user manager and lingering enabled:

```sh
OZI_C4_SYSTEMD_E2E=1 vp test run --root e2e c4.remote-service.test.ts
```

It creates a unique unit and temporary data root, checks install, status,
restart and pairing, then uninstalls only that unit. It is skipped without the
opt-in variable; custom units fail before service access on non-Linux hosts. Direct two-machine, Tailscale and
SSH access still require the orchestrator's Linux check.
