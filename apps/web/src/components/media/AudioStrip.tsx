import { PauseIcon, PlayIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "../../lib/utils";
import { mediaTime, seekFromPointer, toggleMedia, useMediaState } from "./VideoControls";

const BARS = 64;

function useWaveform(src: string) {
  const [peaks, setPeaks] = useState<readonly number[] | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- decodes the audio file once to draw its waveform
  useEffect(() => {
    if (!src) return;
    let cancelled = false;
    const context = new OfflineAudioContext(1, 1, 44_100);
    void fetch(src)
      .then((response) => response.arrayBuffer())
      .then((bytes) => context.decodeAudioData(bytes))
      .then((buffer) => {
        const data = buffer.getChannelData(0);
        const size = Math.max(1, Math.floor(data.length / BARS));
        const raw = Array.from({ length: BARS }, (_, bar) => {
          let peak = 0;
          for (let i = bar * size; i < (bar + 1) * size && i < data.length; i++)
            peak = Math.max(peak, Math.abs(data[i] ?? 0));
          return peak;
        });
        const top = Math.max(...raw, 0.0001);
        if (!cancelled) setPeaks(raw.map((peak) => Math.max(0.08, peak / top)));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [src]);
  return peaks;
}

function Strip(props: { audio: HTMLAudioElement; src: string; name: string }) {
  const { playing, time, duration } = useMediaState(props.audio);
  const peaks = useWaveform(props.src);
  const progress = duration > 0 ? time / duration : 0;
  return (
    <>
      <button
        type="button"
        aria-label={playing ? `Pause ${props.name}` : `Play ${props.name}`}
        onClick={() => toggleMedia(props.audio)}
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform hover:scale-105"
      >
        {playing ? (
          <PauseIcon className="size-4.5 fill-current" />
        ) : (
          <PlayIcon className="ms-0.5 size-4.5 fill-current" />
        )}
      </button>
      <span className="min-w-0 flex-1">
        <span className="mb-1 flex items-baseline justify-between gap-3 text-xs">
          <span className="truncate font-medium">{props.name}</span>
          <span className="shrink-0 text-muted-foreground tabular-nums">
            {mediaTime(time)} / {mediaTime(duration)}
          </span>
        </span>
        <span
          role="slider"
          aria-label={`Seek ${props.name}`}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration || 0)}
          aria-valuenow={Math.round(time)}
          tabIndex={0}
          onPointerDown={(event) => seekFromPointer(event, props.audio)}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight") props.audio.currentTime += 5;
            if (event.key === "ArrowLeft") props.audio.currentTime -= 5;
          }}
          className="flex h-8 cursor-pointer items-center gap-[2px]"
        >
          {(peaks ?? Array.from({ length: BARS }, () => 0.06)).map((peak, index) => (
            <span
              key={index}
              className={cn(
                "min-w-0 flex-1 rounded-full transition-colors",
                index / BARS < progress ? "bg-primary" : "bg-foreground/20",
              )}
              style={{ height: `${Math.round(peak * 100)}%` }}
            />
          ))}
        </span>
      </span>
    </>
  );
}

export function AudioStrip(props: {
  src: string;
  name: string;
  failed?: boolean;
  onError?: () => void;
  className?: string;
}) {
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);
  return (
    <span
      className={cn(
        "my-1 flex w-full max-w-xl items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5",
        props.className,
      )}
    >
      {props.failed ? (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <TriangleAlertIcon className="size-3.5" />
          Audio unavailable · {props.name}
        </span>
      ) : (
        <>
          <audio
            ref={setAudio}
            src={props.src || undefined}
            preload="metadata"
            aria-label={props.name}
            onError={props.onError}
          />
          {audio ? <Strip audio={audio} src={props.src} name={props.name} /> : null}
        </>
      )}
    </span>
  );
}
