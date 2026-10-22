import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand } from "./runtime.ts";

export function createAttachmentEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    createUploadUrl: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:attachments:create-upload-url",
      tag: WS_METHODS.attachmentsCreateUploadUrl,
    }),
    remove: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:attachments:delete",
      tag: WS_METHODS.attachmentsDelete,
    }),
  };
}

export type PersistedAttachmentVerification =
  | { readonly status: "verified" }
  | { readonly status: "missing" }
  | { readonly status: "failed"; readonly error: unknown };

export interface AttachmentByteUpload {
  readonly done: Promise<void>;
  readonly abort: () => void;
}

export type AttachmentUploadCycleResult =
  | { readonly status: "uploaded"; readonly attachmentId: string }
  | { readonly status: "cancelled"; readonly attachmentId: string | null }
  | {
      readonly status: "failed";
      readonly step: "mint" | "resolve-url" | "transfer";
      readonly attachmentId: string | null;
      readonly error: unknown;
    };
