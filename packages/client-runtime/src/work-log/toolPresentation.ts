import type { ToolActivityIcon, ToolActivitySource, ToolActivitySurface } from "@t3tools/contracts";

export interface ExtractedToolActivityPresentation {
  readonly viewedImagePath?: string;
  readonly toolSurface?: ToolActivitySurface;
  readonly toolIcon?: ToolActivityIcon;
  readonly toolSource?: ToolActivitySource;
}
