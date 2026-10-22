import type { AssetResource, ThreadId } from "@t3tools/contracts";

import { type MediaReference } from "./mediaReference.ts";

export type MediaSourceResource = Extract<AssetResource, { readonly _tag: "media-file" }>;

export type ResolvedMediaSource = {
  readonly kind: "image" | "video";
  readonly mimeType: string;
  readonly name: string;
  readonly reference?: MediaReference;
  readonly srcFragment: string;
} & (
  | {
      readonly access: "direct";
      readonly uri: string;
    }
  | {
      readonly access: "environment";
      readonly resource: MediaSourceResource;
    }
  | {
      readonly access: "unavailable";
    }
);

export interface ResolveMediaSourceInput {
  readonly threadId: ThreadId | undefined;
  readonly workspaceRoot?: string | null | undefined;
  readonly resolvedFilePath?: string | undefined;
  /** Image syntax can target an endpoint without a recognizable extension. */
  readonly imageEmbed?: boolean | undefined;
}
