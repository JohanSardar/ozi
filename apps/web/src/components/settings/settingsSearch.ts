import type { KeybindingCommand } from "@t3tools/contracts";

const labels = {
  "cli-command": "Terminal command",
  "connections-environment": "This machine",
  "github-routing": "GitHub sharing",
  "hold-webhooks-while-offline": "Hold webhooks while offline",
  keybindings: "Keybindings",
  "load-balancing": "Load balancing",
  "local-environment": "Local environment",
  "network-access": "Network access",
  "provider-health-check-interval": "Health check interval",
  providers: "Providers",
  "remote-environments": "Environments",
  "tailscale-https": "Tailscale HTTPS",
  "usage-providers": "Usage providers",
  "wsl-backend": "WSL backend",
} as const;

export function keybindingSearchAnchorId(command: KeybindingCommand) {
  return `keybinding-${command}`;
}

export function searchableSetting(id: keyof typeof labels) {
  return { id, title: labels[id] };
}
