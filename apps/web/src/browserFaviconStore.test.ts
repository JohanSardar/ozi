import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const metadata = vi.hoisted(() => ({
  httpBaseUrl: null as string | null,
}));

vi.mock("~/state/entities", () => ({
  useQuietThreadShell: () => null,
}));
vi.mock("~/state/session", () => ({
  usePreparedConnection: () => ({ _tag: "None" }),
  readPreparedConnection: () =>
    metadata.httpBaseUrl ? { httpBaseUrl: metadata.httpBaseUrl } : null,
}));

import { useComposerDraftStore } from "./composerDraftStore";
import {
  lookupFavicon,
  lookupFaviconForThread,
  recordFaviconForEnvironment,
  recordFaviconForThread,
  resetBrowserFaviconsForTests,
  resolveBrowserFaviconStorage,
  useBrowserFaviconStore,
} from "./browserFaviconStore";

const environmentId = EnvironmentId.make("env-1");
const projectRef = environmentId;
const threadRef = { environmentId, threadId: ThreadId.make("thread-1") };
const PNG = "data:image/png;base64,AAAA";
const favicon = (pageUrl: string, capturedAt: number, dataUrl = PNG) => ({
  pageUrl,
  capturedAt,
  dataUrl,
});

describe("browser favicon store", () => {
  beforeEach(() => {
    resetBrowserFaviconsForTests();
    metadata.httpBaseUrl = null;
    useComposerDraftStore.setState({ draftThreadsByThreadKey: {} });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("finds a persisted environment icon after shell hydration without a live connection", () => {
    recordFaviconForEnvironment(
      projectRef,
      favicon("http://192.168.64.2:3000/app", 5),
      "192.168.64.2",
    );
    const byKey = useBrowserFaviconStore.getState().byKey;
    expect(lookupFavicon(byKey, null, "http://localhost:3000/app", null)).toBeNull();
    expect(lookupFavicon(byKey, projectRef, "http://localhost:3000/app", null)).toBe(PNG);
    expect(lookupFavicon(byKey, projectRef, "http://192.168.64.2:3000/app", null)).toBe(PNG);
    expect(lookupFavicon(byKey, projectRef, "http://192.168.64.3:3000/app", null)).toBeNull();
    expect(lookupFavicon(byKey, projectRef, "https://192.168.64.2:3000/app", null)).toBeNull();
    expect(lookupFavicon(byKey, projectRef, "http://192.168.64.2:3001/app", null)).toBeNull();
    expect(
      lookupFavicon(byKey, EnvironmentId.make("env-2"), "http://192.168.64.2:3000/app", null),
    ).toBeNull();
  });

  it("persists unambiguous loopback captures while the environment is offline", () => {
    expect(recordFaviconForThread(threadRef, favicon("http://localhost:3000/", 1))).toBe(true);
    expect(useBrowserFaviconStore.getState().byKey).toEqual({
      "env-1:project-1 http://localhost:3000": { dataUrl: PNG, capturedAt: 1 },
    });

    expect(recordFaviconForThread(threadRef, favicon("http://192.168.64.2:5173/", 2))).toBe(false);
    expect(Object.values(useBrowserFaviconStore.getState().pendingByThreadKey)[0]).toBeDefined();
  });

  it("shows a newer pending capture over the stored favicon for the same origin", () => {
    const NEWER = "data:image/png;base64,BBBB";
    metadata.httpBaseUrl = "http://192.168.64.2:3773";
    expect(recordFaviconForThread(threadRef, favicon("http://192.168.64.2:5173/", 1))).toBe(true);

    metadata.httpBaseUrl = null;
    expect(recordFaviconForThread(threadRef, favicon("http://192.168.64.2:5173/", 2, NEWER))).toBe(
      false,
    );
    expect(
      lookupFaviconForThread(
        useBrowserFaviconStore.getState(),
        scopedThreadKey(threadRef),
        projectRef,
        "http://192.168.64.2:5173/",
        "192.168.64.2",
      ),
    ).toBe(NEWER);
  });

  it("keeps the memory shadow authoritative after an asymmetric primary write failure", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: vi.fn(() => "stale"),
        setItem: vi.fn(() => {
          throw new Error("quota exceeded");
        }),
        removeItem: vi.fn(() => {
          throw new Error("remove blocked");
        }),
      },
    });
    const storage = resolveBrowserFaviconStorage();

    storage.setItem("key", "fresh");
    expect(storage.getItem("key")).toBe("fresh");
    storage.removeItem("key");
    expect(storage.getItem("key")).toBeNull();
  });
});
