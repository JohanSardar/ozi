import type { SnapShotSource } from "@t3tools/contracts";

import type { MediaActionSource } from "../media/MediaActions";

export interface ExpandedImageItem {
  src: string | null;
  name: string;
  mimeType?: string;
  type?: "video";
  /** The preview created this object URL and must revoke it; other blob URLs belong to the timeline. */
  ownsSrc?: boolean;
  source?: SnapShotSource;
  autoPlay?: boolean;
  originalUrl?: string;
  srcFragment?: string;
  actionsSource?: MediaActionSource;
}

export interface ExpandedImagePreview {
  images: ExpandedImageItem[];
  index: number;
}
