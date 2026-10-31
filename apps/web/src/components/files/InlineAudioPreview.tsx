import type { AssetResource, EnvironmentId } from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";

import { useAssetUrlState } from "~/assets/assetUrls";

import { AudioStrip } from "../media/AudioStrip";

export function InlineAudioPreview(props: {
  readonly name: string;
  readonly environmentId?: EnvironmentId;
  readonly resource?: AssetResource;
  readonly src?: string;
  readonly copyMarkdown?: string;
}) {
  const container = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const asset = useAssetUrlState(
    visible ? (props.environmentId ?? null) : null,
    visible ? (props.resource ?? null) : null,
  );
  const src = visible ? (asset._tag === "Success" ? asset.url : props.src) : undefined;
  const failed = asset._tag === "Failure" || (src !== undefined && failedSrc === src);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- IntersectionObserver defers loading the audio until the element scrolls into view
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <span ref={container} data-markdown-copy={props.copyMarkdown} className="block">
      <AudioStrip
        name={props.name}
        src={src ?? ""}
        failed={failed}
        onError={() => setFailedSrc(src ?? null)}
      />
    </span>
  );
}
