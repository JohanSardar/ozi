import { MaximizeIcon, PauseIcon, PlayIcon, Volume2Icon, VolumeXIcon } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent } from "react";

import { cn } from "../../lib/utils";

export const mediaTime = (seconds: number) =>
  Number.isFinite(seconds)
    ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`
    : "0:00";

export function seekFromPointer(
  event: PointerEvent<HTMLElement>,
  media: HTMLMediaElement,
  onDone?: () => void,
) {
  const track = event.currentTarget;
  const seek = (clientX: number) => {
    const box = track.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    if (Number.isFinite(media.duration)) media.currentTime = ratio * media.duration;
  };
  seek(event.clientX);
  track.setPointerCapture(event.pointerId);
  const move = (next: globalThis.PointerEvent) => seek(next.clientX);
  const up = () => {
    track.removeEventListener("pointermove", move);
    track.removeEventListener("pointerup", up);
    onDone?.();
  };
  track.addEventListener("pointermove", move);
  track.addEventListener("pointerup", up);
}

export function useMediaState(media: HTMLMediaElement) {
  const [state, setState] = useState(() => ({
    playing: !media.paused,
    time: media.currentTime,
    duration: media.duration,
    muted: media.muted,
  }));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- mirrors the media element's playback events into React state
  useEffect(() => {
    const sync = () =>
      setState({
        playing: !media.paused,
        time: media.currentTime,
        duration: media.duration,
        muted: media.muted,
      });
    const events = [
      "play",
      "pause",
      "ended",
      "timeupdate",
      "durationchange",
      "loadedmetadata",
      "volumechange",
    ];
    for (const name of events) media.addEventListener(name, sync);
    sync();
    return () => {
      for (const name of events) media.removeEventListener(name, sync);
    };
  }, [media]);
  return state;
}

export const toggleMedia = (media: HTMLMediaElement) =>
  media.paused ? void media.play().catch(() => {}) : media.pause();

export function VideoControls(props: { video: HTMLVideoElement; label: string }) {
  const { video } = props;
  const { playing, time, duration, muted } = useMediaState(video);
  const [awake, setAwake] = useState(true);
  const sleep = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wake = () => {
    setAwake(true);
    clearTimeout(sleep.current);
    sleep.current = setTimeout(() => setAwake(false), 2200);
  };
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- clears the hide-controls timer on unmount
  useEffect(() => () => clearTimeout(sleep.current), []);
  const shown = !playing || awake;
  const progress = duration > 0 ? (time / duration) * 100 : 0;
  return (
    <span
      className={cn(
        "absolute inset-0 flex flex-col justify-end overflow-hidden rounded-[inherit] transition-opacity duration-200",
        shown ? "opacity-100" : "cursor-none opacity-0",
      )}
      onPointerMove={wake}
      onPointerLeave={() => playing && setAwake(false)}
    >
      <button
        type="button"
        aria-label={playing ? `Pause ${props.label}` : `Play ${props.label}`}
        onClick={() => toggleMedia(video)}
        className="absolute inset-0 flex items-center justify-center focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      >
        {playing ? null : (
          <span className="flex size-16 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-md transition-transform hover:scale-105">
            <PlayIcon aria-hidden className="ms-1 size-7 fill-current" />
          </span>
        )}
      </button>
      <span className="relative flex items-center gap-1 bg-linear-to-t from-black/75 to-transparent px-2 pt-8 pb-2 text-white">
        <button
          type="button"
          aria-label={playing ? "Pause" : "Play"}
          onClick={() => toggleMedia(video)}
          className="flex size-10 shrink-0 items-center justify-center rounded-lg hover:bg-white/15"
        >
          {playing ? (
            <PauseIcon className="size-5 fill-current" />
          ) : (
            <PlayIcon className="size-5 fill-current" />
          )}
        </button>
        <span className="w-24 shrink-0 text-xs tabular-nums">
          {mediaTime(time)} / {mediaTime(duration)}
        </span>
        <span
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration || 0)}
          aria-valuenow={Math.round(time)}
          tabIndex={0}
          onPointerDown={(event) => seekFromPointer(event, video)}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight") video.currentTime += 5;
            if (event.key === "ArrowLeft") video.currentTime -= 5;
          }}
          className="group/seek relative flex h-10 min-w-0 flex-1 cursor-pointer items-center"
        >
          <span className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/25 transition-[height] group-hover/seek:h-2.5">
            <span className="absolute inset-y-0 start-0 bg-white" style={{ width: `${progress}%` }} />
          </span>
        </span>
        <button
          type="button"
          aria-label={muted ? "Unmute" : "Mute"}
          onClick={() => {
            video.muted = !video.muted;
          }}
          className="flex size-10 shrink-0 items-center justify-center rounded-lg hover:bg-white/15"
        >
          {muted ? <VolumeXIcon className="size-5" /> : <Volume2Icon className="size-5" />}
        </button>
        <button
          type="button"
          aria-label="Full screen"
          onClick={() => void video.parentElement?.requestFullscreen().catch(() => {})}
          className="flex size-10 shrink-0 items-center justify-center rounded-lg hover:bg-white/15"
        >
          <MaximizeIcon className="size-5" />
        </button>
      </span>
    </span>
  );
}
