import type { OrchestrationV2TurnItem } from "@t3tools/contracts";

export type SecretRequestItem = Extract<
  OrchestrationV2TurnItem,
  { readonly type: "secret_request" }
>;

export type SecretRequestDisplay =
  | { readonly kind: "pending" }
  | { readonly kind: "pending-elsewhere"; readonly label: string }
  | {
      readonly kind: "answered";
      readonly outcome: "saved" | "declined" | "ended";
      readonly label: string;
    };
