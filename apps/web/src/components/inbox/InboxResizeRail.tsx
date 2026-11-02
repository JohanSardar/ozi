import * as Schema from "effect/Schema";

import {
  getLocalStorageItem,
  removeLocalStorageItem,
  setLocalStorageItem,
} from "../../hooks/useLocalStorage";
import { useResizeDrag } from "../../hooks/useResizeDrag";

const INBOX_WIDTH_STORAGE_KEY = "ozi_inbox_width";
const INBOX_MIN_WIDTH = 280;
const CHAT_MIN_WIDTH = 420;

const setInboxWidth = (width: number | null) =>
  width === null
    ? document.documentElement.style.removeProperty("--inbox-user-width")
    : document.documentElement.style.setProperty("--inbox-user-width", `${width}px`);

setInboxWidth(getLocalStorageItem(INBOX_WIDTH_STORAGE_KEY, Schema.Finite));

export function InboxResizeRail() {
  const { ref, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onLostPointerCapture } =
    useResizeDrag<HTMLDivElement>((event) => {
      const panel = event.currentTarget.parentElement;
      if (!panel) return null;
      const sidebar =
        document.querySelector<HTMLElement>("[data-slot='sidebar-container']")?.offsetWidth ?? 0;
      return {
        width: panel.offsetWidth,
        edge: "left",
        bounds: {
          min: INBOX_MIN_WIDTH,
          max: Math.max(INBOX_MIN_WIDTH, window.innerWidth - sidebar - CHAT_MIN_WIDTH),
        },
        resize(width) {
          setInboxWidth(width);
          return width;
        },
        finish(width) {
          setLocalStorageItem(INBOX_WIDTH_STORAGE_KEY, width, Schema.Finite);
        },
      };
    });
  return (
    <div
      ref={ref}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize inbox"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onLostPointerCapture}
      onDoubleClick={() => {
        removeLocalStorageItem(INBOX_WIDTH_STORAGE_KEY);
        setInboxWidth(null);
      }}
      className="-translate-x-1/2 absolute inset-y-0 left-0 z-20 w-4 cursor-col-resize after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] hover:after:bg-sidebar-border"
    />
  );
}
