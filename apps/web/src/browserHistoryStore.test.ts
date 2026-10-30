import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, type PreviewSessionSnapshot, ThreadId } from "@t3tools/contracts";

const { readPreparedConnection, entities, settingsHydration } = vi.hoisted(() => ({
  readPreparedConnection: vi.fn<() => { httpBaseUrl: string } | null>(() => null),
  entities: {
    shellProjectId: null as string | null,
  },
  settingsHydration: {
    hydrated: true,
    finish: () => {},
    promise: Promise.resolve(),
  },
}));

vi.mock("~/state/session", () => ({ readPreparedConnection }));
vi.mock("~/state/entities", () => ({
  readThreadShell: () => (entities.shellProjectId ? {} : null),
  useQuietThreadShell: () => null,
}));
vi.mock("./hooks/useSettings", async () => {
  const { DEFAULT_CLIENT_SETTINGS } = await import("@t3tools/contracts/settings");
  return {
    getClientSettings: () => DEFAULT_CLIENT_SETTINGS,
    useClientSettings: () => DEFAULT_CLIENT_SETTINGS,
    isClientSettingsHydrated: () => settingsHydration.hydrated,
    ensureClientSettingsHydrated: () => settingsHydration.promise,
  };
});
vi.mock("~/state/environments", () => ({
  readPrimaryEnvironmentId: () => null,
  usePrimaryEnvironmentId: () => null,
}));

import { useComposerDraftStore } from "./composerDraftStore";
import {
  BROWSER_HISTORY_MAX_ENVIRONMENTS,
  type BrowserHistoryEntry,
  mergeBrowserHistoryState,
  migratePersistedBrowserHistoryState,
  normalizeHistoryUrl,
  recordVisitForThread,
  resetBrowserHistoryForTests,
  startPreviewTitleRecording,
  upsertHistoryEntry,
  useBrowserHistoryStore,
} from "./browserHistoryStore";
import { applyPreviewServerSnapshot, resetPreviewStateForTests } from "./previewStateStore";

function entry(overrides: Partial<BrowserHistoryEntry> = {}): BrowserHistoryEntry {
  return { url: "http://localhost:3000/", lastVisitedAt: 1000, ...overrides };
}

beforeEach(() => {
  readPreparedConnection.mockReturnValue(null);
  entities.shellProjectId = null;
  settingsHydration.hydrated = true;
  settingsHydration.promise = Promise.resolve();
  useComposerDraftStore.setState({ draftThreadsByThreadKey: {} });
});
afterEach(() => vi.restoreAllMocks());

describe("normalizeHistoryUrl", () => {
  it("normalizes bare loopback hosts to http and keeps path/query", () => {
    expect(normalizeHistoryUrl("localhost:3000/admin?tab=1")).toBe(
      "http://localhost:3000/admin?tab=1",
    );
  });

  it("preserves hash routes and strips credentials", () => {
    expect(normalizeHistoryUrl("http://localhost:3000/app#/route")).toBe(
      "http://localhost:3000/app#/route",
    );
    expect(normalizeHistoryUrl("https://user:secret@example.com/")).toBe("https://example.com/");
  });

  it("rejects non-http(s), unparseable, and oversized urls", () => {
    expect(normalizeHistoryUrl("ftp://example.com")).toBeNull();
    expect(normalizeHistoryUrl("")).toBeNull();
    expect(normalizeHistoryUrl(`http://localhost/${"a".repeat(2048)}`)).toBeNull();
  });
});

describe("upsertHistoryEntry", () => {
  it("with insertOrdered, replaying an older visit for an existing entry keeps its newer timestamp", () => {
    const existing = [entry({ url: "http://a.test/", lastVisitedAt: 2000 })];
    const next = upsertHistoryEntry(existing, "http://a.test/", 1000, { insertOrdered: true });
    expect(next).toEqual([{ url: "http://a.test/", lastVisitedAt: 2000 }]);
  });
});

describe("migratePersistedBrowserHistoryState", () => {
  it("drops malformed state and invalid entries", () => {
    expect(migratePersistedBrowserHistoryState(null)).toEqual({ byEnvironmentKey: {} });
    expect(migratePersistedBrowserHistoryState({ byEnvironmentKey: 42 })).toEqual({
      byEnvironmentKey: {},
    });
    const migrated = migratePersistedBrowserHistoryState({
      byEnvironmentKey: {
        good: [
          { url: "http://a.test/", lastVisitedAt: 100, title: "A" },
          { url: "", lastVisitedAt: 100 },
          { url: "ftp://ghost.test/", lastVisitedAt: 100 },
          { url: "http://b.test/", lastVisitedAt: Number.NaN },
          "junk",
        ],
        bad: "junk",
      },
    });
    expect(migrated.byEnvironmentKey["good"]).toEqual([
      { url: "http://a.test/", lastVisitedAt: 100, title: "A" },
    ]);
    expect(migrated.byEnvironmentKey["bad"]).toBeUndefined();
  });

  it("restores MRU ordering, deduplicates normalized urls, and enforces project bounds", () => {
    const byEnvironmentKey = Object.fromEntries(
      Array.from({ length: BROWSER_HISTORY_MAX_ENVIRONMENTS + 1 }, (_, index) => [
        `project-${index}`,
        [{ url: `http://project-${index}.test/`, lastVisitedAt: index }],
      ]),
    );
    byEnvironmentKey["project-1"] = [
      { url: "a.test/", lastVisitedAt: 1 },
      { url: "http://newer.test/", lastVisitedAt: 3 },
      { url: "https://a.test/", lastVisitedAt: 2 },
    ];

    const migrated = migratePersistedBrowserHistoryState({ byEnvironmentKey });

    expect(Object.keys(migrated.byEnvironmentKey)).toHaveLength(BROWSER_HISTORY_MAX_ENVIRONMENTS);
    expect(migrated.byEnvironmentKey["project-0"]).toBeUndefined();
    expect(migrated.byEnvironmentKey["project-1"]).toEqual([
      { url: "http://newer.test/", lastVisitedAt: 3 },
      { url: "https://a.test/", lastVisitedAt: 2 },
    ]);
  });
});

const threadRef = {
  environmentId: EnvironmentId.make("env-1"),
  threadId: ThreadId.make("thread-1"),
};

let settledAt = 0;

function settle(url: string, title: string, tabId = "tab_a", ref = threadRef): void {
  settledAt += 1;
  const snapshot: PreviewSessionSnapshot = {
    threadId: ref.threadId,
    tabId,
    navStatus: { _tag: "Success", url, title },
    canGoBack: false,
    canGoForward: false,
    updatedAt: new Date(settledAt).toISOString(),
  };
  applyPreviewServerSnapshot(ref, snapshot);
}

function resetStores(): () => void {
  resetBrowserHistoryForTests();
  resetPreviewStateForTests();
  return startPreviewTitleRecording();
}

describe("useBrowserHistoryStore", () => {
  beforeEach(resetStores);

  it("titles only pages already in history when they settle", () => {
    useBrowserHistoryStore.getState().registerThreadEnvironment(threadRef, "proj-a");
    settle("http://a.test/", "Should not create");
    expect(useBrowserHistoryStore.getState().byEnvironmentKey).toEqual({});
    recordVisitForThread(threadRef, "http://a.test/#/settings", 1);
    settle("http://a.test/#/settings", "My App");
    expect(useBrowserHistoryStore.getState().byEnvironmentKey["proj-a"]?.[0]?.title).toBe("My App");
  });

  it("titles a visit recorded after its page already settled", () => {
    useBrowserHistoryStore.getState().registerThreadEnvironment(threadRef, "proj-a");
    recordVisitForThread(threadRef, "http://other.test/", 1);
    settle("http://a.test/", "My App");
    recordVisitForThread(threadRef, "http://a.test/", 2);
    expect(useBrowserHistoryStore.getState().byEnvironmentKey["proj-a"]?.[0]).toMatchObject({
      url: "http://a.test/",
      title: "My App",
    });
  });

  it("keeps the newest title when another tab shows the same url", () => {
    useBrowserHistoryStore.getState().registerThreadEnvironment(threadRef, "proj-a");
    recordVisitForThread(threadRef, "http://a.test/", 1);
    settle("http://a.test/", "Old", "tab_a");
    settle("http://a.test/", "Old", "tab_b");
    settle("http://a.test/", "New", "tab_a");
    expect(useBrowserHistoryStore.getState().byEnvironmentKey["proj-a"]?.[0]?.title).toBe("New");
  });

  it("keeps another thread's newer title when an unrelated tab settles", () => {
    const otherThreadRef = { ...threadRef, threadId: ThreadId.make("thread-2") };
    const store = useBrowserHistoryStore.getState();
    store.registerThreadEnvironment(threadRef, "proj-a");
    store.registerThreadEnvironment(otherThreadRef, "proj-a");
    recordVisitForThread(threadRef, "http://a.test/", 1);
    settle("http://a.test/", "Old", "tab_a", threadRef);
    settle("http://a.test/", "New", "tab_a", otherThreadRef);
    settle("http://b.test/", "Unrelated", "tab_b", threadRef);
    expect(
      useBrowserHistoryStore
        .getState()
        .byEnvironmentKey["proj-a"]?.find((e) => e.url === "http://a.test/")?.title,
    ).toBe("New");
  });

  it("keeps another thread's newer title when this thread records a different visit", () => {
    const otherThreadRef = { ...threadRef, threadId: ThreadId.make("thread-2") };
    const store = useBrowserHistoryStore.getState();
    store.registerThreadEnvironment(threadRef, "proj-a");
    store.registerThreadEnvironment(otherThreadRef, "proj-a");
    recordVisitForThread(threadRef, "http://a.test/", 1);
    settle("http://a.test/", "Old", "tab_a", threadRef);
    settle("http://a.test/", "New", "tab_a", otherThreadRef);
    recordVisitForThread(threadRef, "http://b.test/", 2);
    expect(
      useBrowserHistoryStore
        .getState()
        .byEnvironmentKey["proj-a"]?.find((e) => e.url === "http://a.test/")?.title,
    ).toBe("New");
  });

  it("keeps another thread's newer title when this thread's unchanged tab is re-sent", () => {
    const otherThreadRef = { ...threadRef, threadId: ThreadId.make("thread-2") };
    const store = useBrowserHistoryStore.getState();
    store.registerThreadEnvironment(threadRef, "proj-a");
    store.registerThreadEnvironment(otherThreadRef, "proj-a");
    recordVisitForThread(threadRef, "http://a.test/", 1);
    settle("http://a.test/", "Old", "tab_a", threadRef);
    settle("http://a.test/", "New", "tab_a", otherThreadRef);
    // A resize or a list reconcile replaces the session without a new page load.
    settle("http://a.test/", "Old", "tab_a", threadRef);
    expect(useBrowserHistoryStore.getState().byEnvironmentKey["proj-a"]?.[0]?.title).toBe("New");
  });

  it("keeps another thread's newer title when this thread revisits the same url", () => {
    const otherThreadRef = { ...threadRef, threadId: ThreadId.make("thread-2") };
    const store = useBrowserHistoryStore.getState();
    store.registerThreadEnvironment(threadRef, "proj-a");
    store.registerThreadEnvironment(otherThreadRef, "proj-a");
    recordVisitForThread(threadRef, "http://a.test/", 1);
    settle("http://a.test/", "Old", "tab_a", threadRef);
    settle("http://a.test/", "New", "tab_a", otherThreadRef);
    recordVisitForThread(threadRef, "http://a.test/", 2);
    expect(useBrowserHistoryStore.getState().byEnvironmentKey["proj-a"]?.[0]?.title).toBe("New");
  });

  it("sets a title against a settled url that differs from the stored one only by a trailing slash", () => {
    useBrowserHistoryStore.getState().registerThreadEnvironment(threadRef, "proj-a");
    recordVisitForThread(threadRef, "http://a.test/community", 1);
    settle("http://a.test/community/", "Community");
    expect(useBrowserHistoryStore.getState().byEnvironmentKey["proj-a"]?.[0]).toMatchObject({
      url: "http://a.test/community",
      title: "Community",
    });

    useBrowserHistoryStore.setState({ byEnvironmentKey: {} });
    recordVisitForThread(threadRef, "http://a.test/community/", 1);
    settle("http://a.test/community", "Community");
    expect(useBrowserHistoryStore.getState().byEnvironmentKey["proj-a"]?.[0]).toMatchObject({
      url: "http://a.test/community/",
      title: "Community",
    });
  });

  it("matches a requested localhost URL to the resolved environment host", () => {
    useBrowserHistoryStore.getState().registerThreadEnvironment(threadRef, "proj-a");
    recordVisitForThread(threadRef, "http://localhost:5173/app", 1);
    readPreparedConnection.mockReturnValue({ httpBaseUrl: "http://192.168.64.2:3773" });
    settle("http://192.168.64.2:5173/app", "Local App");
    expect(useBrowserHistoryStore.getState().byEnvironmentKey["proj-a"]?.[0]?.title).toBe(
      "Local App",
    );
  });

  it("deduplicates loopback aliases and the resolved environment host", () => {
    readPreparedConnection.mockReturnValue({ httpBaseUrl: "http://192.168.64.2:3773" });
    useBrowserHistoryStore.getState().registerThreadEnvironment(threadRef, "proj-a");
    recordVisitForThread(threadRef, "http://localhost:5173/app", 1);
    recordVisitForThread(threadRef, "http://127.0.0.1:5173/app", 2);
    recordVisitForThread(threadRef, "http://192.168.64.2:5173/app", 3);
    expect(useBrowserHistoryStore.getState().byEnvironmentKey["proj-a"]).toEqual([
      { url: "http://localhost:5173/app", lastVisitedAt: 3 },
    ]);

    useBrowserHistoryStore.setState({ byEnvironmentKey: {} });
    recordVisitForThread(threadRef, "http://192.168.64.2:5173/app", 4);
    recordVisitForThread(threadRef, "http://localhost:5173/app", 5);
    expect(useBrowserHistoryStore.getState().byEnvironmentKey["proj-a"]).toEqual([
      { url: "http://localhost:5173/app", lastVisitedAt: 5 },
    ]);
  });
});

describe("pendingVisitsByThreadKey", () => {
  beforeEach(resetStores);

  it("queues a visit recorded before registration and drains it in order on registration", () => {
    recordVisitForThread(threadRef, "http://a.test/", 1);
    recordVisitForThread(threadRef, "http://b.test/", 2);
    expect(useBrowserHistoryStore.getState().byEnvironmentKey).toEqual({});
    useBrowserHistoryStore.getState().registerThreadEnvironment(threadRef, "proj-a");
    expect(useBrowserHistoryStore.getState().byEnvironmentKey["proj-a"]?.map((e) => e.url)).toEqual(
      ["http://b.test/", "http://a.test/"],
    );
    expect(useBrowserHistoryStore.getState().byEnvironmentKey["proj-a"]?.[0]?.lastVisitedAt).toBe(
      2,
    );
    expect(useBrowserHistoryStore.getState().byEnvironmentKey["proj-a"]?.[1]?.lastVisitedAt).toBe(
      1,
    );
    expect(useBrowserHistoryStore.getState().pendingVisitsByThreadKey).toEqual({});
  });

  it("slots a replayed visit by timestamp instead of hoisting it above a newer live visit", () => {
    const otherThreadRef = {
      environmentId: EnvironmentId.make("env-1"),
      threadId: ThreadId.make("thread-2"),
    };
    useBrowserHistoryStore.getState().registerThreadEnvironment(otherThreadRef, "proj-a");
    recordVisitForThread(otherThreadRef, "http://newer.test/", 2000);
    recordVisitForThread(threadRef, "http://older.test/", 1000);
    useBrowserHistoryStore.getState().registerThreadEnvironment(threadRef, "proj-a");

    const entries = useBrowserHistoryStore.getState().byEnvironmentKey["proj-a"];
    expect(entries?.map((e) => e.url)).toEqual(["http://newer.test/", "http://older.test/"]);
    expect(entries?.[0]?.lastVisitedAt).toBe(2000);
  });
});

describe("titles before registration", () => {
  beforeEach(resetStores);

  it("applies a settled page's title once the matching visit drains", () => {
    recordVisitForThread(threadRef, "http://a.test/", 1);
    settle("http://a.test/", "My App");
    expect(useBrowserHistoryStore.getState().byEnvironmentKey).toEqual({});

    useBrowserHistoryStore.getState().registerThreadEnvironment(threadRef, "proj-a");

    const entries = useBrowserHistoryStore.getState().byEnvironmentKey["proj-a"];
    expect(entries?.[0]).toMatchObject({ url: "http://a.test/", title: "My App" });
  });

  it("keeps another thread's title when a queued visit to the same url drains", () => {
    const otherThreadRef = { ...threadRef, threadId: ThreadId.make("thread-2") };
    recordVisitForThread(threadRef, "http://a.test/", 1);
    settle("http://a.test/", "Old", "tab_a", threadRef);
    useBrowserHistoryStore.getState().registerThreadEnvironment(otherThreadRef, "proj-a");
    recordVisitForThread(otherThreadRef, "http://a.test/", 2);
    settle("http://a.test/", "New", "tab_a", otherThreadRef);

    useBrowserHistoryStore.getState().registerThreadEnvironment(threadRef, "proj-a");

    expect(useBrowserHistoryStore.getState().byEnvironmentKey["proj-a"]?.[0]?.title).toBe("New");
  });
});

describe("mergeBrowserHistoryState", () => {
  it("sanitizes same-version corrupt persisted data and preserves actions", () => {
    const current = useBrowserHistoryStore.getState();
    const merged = mergeBrowserHistoryState(
      {
        byEnvironmentKey: {
          a: [{ url: "ftp://bad.test/", lastVisitedAt: 1 }],
          b: [{ url: "http://ok.test/", lastVisitedAt: 5 }],
        },
        environmentKeyByThreadKey: { good: "b", stale: "a", malformed: 42 },
      },
      current,
    );
    expect(merged.byEnvironmentKey).toEqual({
      b: [{ url: "http://ok.test/", lastVisitedAt: 5 }],
    });
    expect(typeof merged.recordVisit).toBe("function");
    expect(merged.environmentKeyByThreadKey).toEqual({ good: "b" });
    expect(merged.pendingVisitsByThreadKey).toEqual({});
  });
});
