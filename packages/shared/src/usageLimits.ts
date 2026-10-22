import type { ServerProvider } from "@t3tools/contracts";

export const CHATGPT_USAGE_URL = "https://chatgpt.com/#settings/Usage";

export function usesChatGptSharing(provider: ServerProvider | null | undefined): boolean {
  return provider?.auth.status === "authenticated" && provider.auth.subscriptionSharing === true;
}
