import { describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import type { Thread } from "../types";
import { makeThreadFixture } from "../test-fixtures";
import {
  buildThreadActionItems,
  filterPinnedBrowseEntries,
  filterCommandPaletteGroups,
  reduceCommandPaletteUiState,
  createCommandPaletteSearchState,
  reduceCommandPaletteSearchState,
  type CommandPaletteUiState,
} from "./CommandPalette.logic";

describe("linked pull request thread navigation", () => {});

describe("reduceCommandPaletteUiState", () => {
  it("opens PR search from another overlay and replaces an earlier search", () => {
    const first = reduceCommandPaletteUiState(
      { open: true, mode: "files", openIntent: null, session: 0 },
      {
        _tag: "OpenSearch",
        query: "https://github.com/acme/web/pull/7",
      },
    );
    expect(first).toEqual({
      open: true,
      mode: "command",
      openIntent: { kind: "search", query: "https://github.com/acme/web/pull/7" },
      session: 1,
    });
    const second = reduceCommandPaletteUiState(first, {
      _tag: "OpenSearch",
      query: "https://github.com/acme/web/pull/8",
    });
    expect(second.openIntent).toEqual({
      kind: "search",
      query: "https://github.com/acme/web/pull/8",
    });
    // The second intent starts a new session, so the open palette starts over from it.
    expect(second.session).toBe(2);
    expect(
      reduceCommandPaletteUiState(second, { _tag: "SetOpen", open: false }).openIntent,
    ).toBeNull();
  });
});

const LOCAL_ENVIRONMENT_ID = EnvironmentId.make("environment-local");

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return makeThreadFixture({
    id: ThreadId.make("thread-1"),
    environmentId: LOCAL_ENVIRONMENT_ID,
    title: "Thread",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    runtime: null,
    messages: [],
    proposedPlans: [],
    createdAt: "2026-03-01T00:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
    updatedAt: "2026-03-01T00:00:00.000Z",
    latestRun: null,
    workingDirectory: null,
    ...overrides,
  });
}

describe("buildThreadActionItems", () => {
  it("keeps threads apart when two environments share a thread ID", async () => {
    const local = makeThread();
    const remote = makeThread({ environmentId: EnvironmentId.make("remote-copy") });
    const runThread = vi.fn(async () => {});
    const items = buildThreadActionItems({
      threads: [local, remote],
      activeThread: remote,
      icon: null,
      runThread,
    });
    expect(new Set(items.map((item) => item.value)).size).toBe(2);
    const remoteItem = items.find((item) => item.description === "Remote project · Current thread");
    await remoteItem?.run();
    expect(runThread).toHaveBeenCalledWith(remote);
  });

  it("lists message matches last, once, without moving the title matches above them", () => {
    const threads = [
      makeThread({ id: ThreadId.make("title"), title: "Disable Convex schema validation" }),
      makeThread({ id: ThreadId.make("message"), title: "Fix schema validation" }),
    ];
    const items = buildThreadActionItems({
      threads,
      icon: null,
      runThread: async () => undefined,
    });
    const filter = (threadMessageItems: typeof items) =>
      filterCommandPaletteGroups({
        activeGroups: [],
        query: "convex",
        isInSubmenu: false,
        threadSearchItems: items,
        threadMessageItems,
      }).map((group) => [group.label, group.items.map((item) => item.value)]);

    const before = filter([]);
    // The server matched both; the title match stays where it was.
    const after = filter([items[0]!, items[1]!].toReversed());
    expect(before).toEqual([["Threads", ["thread:environment-local:title"]]]);
    expect(after).toEqual([
      ["Threads", ["thread:environment-local:title"]],
      ["In messages", ["thread:environment-local:message"]],
    ]);
  });

  it("keeps an active thread first while its title is typed, above settings and actions", () => {
    const now = Date.parse("2026-10-23T00:00:00.000Z");
    const action = (value: string, title: string, searchTerms: string[] = [title]) => ({
      kind: "action" as const,
      value,
      searchTerms,
      title,
      icon: null,
      run: async () => undefined,
    });
    const threadSearchItems = buildThreadActionItems({
      threads: [
        makeThread({
          title: "Compaction prompt timing and cache age",
          latestUserMessageAt: "2026-10-11T00:00:00.000Z",
        }),
      ],
      icon: null,
      runThread: async () => undefined,
    });
    const firstGroup = (query: string) =>
      filterCommandPaletteGroups({
        activeGroups: [
          { value: "actions", label: "Actions", items: [action("action:copy", "Copy thread ID")] },
        ],
        query,
        isInSubmenu: false,
        settingsSearchItems: [
          action("setting:compact", "Compact idle threads"),
          action("setting:providers", "Providers", ["Providers", "compatibility"]),
        ],
        threadSearchItems,
        now,
      })[0]?.label;

    for (const query of ["comp", "compa", "compac", "compact", "compacti", "compaction"]) {
      expect(firstGroup(query), query).toBe("Threads");
    }
  });

  it("orders groups by their best match, so a strong thread is not under a weak action", () => {
    const action = (value: string, title: string) => ({
      kind: "action" as const,
      value,
      searchTerms: [title],
      title,
      icon: null,
      run: async () => undefined,
    });
    const threadSearchItems = buildThreadActionItems({
      threads: [makeThread({ title: "Upgrade to pnpm 12" })],
      icon: null,
      runThread: async () => undefined,
    });
    const labels = (query: string) =>
      filterCommandPaletteGroups({
        activeGroups: [
          { value: "actions", label: "Actions", items: [action("action:upload", "Upload file")] },
        ],
        query,
        isInSubmenu: false,
        threadSearchItems,
      }).map((group) => group.label);

    expect(labels("upgrade")).toEqual(["Threads"]);
    expect(labels("upl")).toEqual(["Actions"]);
    // A short query still finds a command by a keyword it equals.
    const prGroups = filterCommandPaletteGroups({
      activeGroups: [
        {
          value: "actions",
          label: "Actions",
          items: [
            {
              kind: "action",
              value: "action:open-prs",
              searchTerms: ["Open pull requests", "pr", "prs", "review"],
              title: "Open pull requests",
              icon: null,
              run: async () => undefined,
            },
            action("action:project", "Project settings"),
          ],
        },
      ],
      query: "pr",
      isInSubmenu: false,
      threadSearchItems: [],
    });
    expect(prGroups.flatMap((group) => group.items.map((item) => item.value))).toEqual([
      "action:open-prs",
      "action:project",
    ]);
    expect(labels("up")).toEqual(["Actions", "Threads"]);
    expect(labels("pnpm up")).toEqual(["Threads"]);
  });

  it("runs the command for its whole name over a thread with that title, and lists the open thread last", () => {
    const threads = [
      makeThread({ id: ThreadId.make("thread-new"), title: "New thread" }),
      makeThread({ id: ThreadId.make("thread-open"), title: "New thread layout" }),
      makeThread({ id: ThreadId.make("thread-other"), title: "New thread button" }),
    ];
    const threadSearchItems = buildThreadActionItems({
      threads,
      activeThread: threads[1]!,
      icon: null,
      runThread: async () => undefined,
    });
    const groups = filterCommandPaletteGroups({
      activeGroups: [
        {
          value: "actions",
          label: "Actions",
          items: [
            {
              kind: "action",
              value: "action:new-thread",
              searchTerms: ["New thread in ozi"],
              title: "New thread in ozi",
              icon: null,
              run: async () => undefined,
            },
          ],
        },
      ],
      query: "new thread",
      isInSubmenu: false,
      threadSearchItems,
    });
    expect(groups.map((group) => group.label)).toEqual(["Actions", "Threads"]);
    expect(groups[1]?.items.at(-1)?.title).toBe("New thread layout");
  });

  it("lists a project above threads that only hold its name when the name is typed", () => {
    const threadSearchItems = buildThreadActionItems({
      threads: [makeThread({ title: "Lakebed performance gains" })],
      icon: null,
      runThread: async () => undefined,
    });
    const labels = (query: string) =>
      filterCommandPaletteGroups({
        activeGroups: [],
        query,
        isInSubmenu: false,
        threadSearchItems,
      }).map((group) => group.label);
    expect(labels("lakebed")).toEqual(["Projects", "Threads"]);
    expect(labels("lake")).toEqual(["Threads", "Projects"]);
  });

  it("keeps a command first over a thread in daily use that matches as well", () => {
    const now = Date.parse("2026-10-23T00:00:00.000Z");
    const threadSearchItems = buildThreadActionItems({
      threads: [
        makeThread({
          title: "New onboarding flow",
          latestUserMessageAt: "2026-10-22T00:00:00.000Z",
          opens: { openedAt: Date.parse("2026-10-22T00:00:00.000Z"), score: 7, picks: [] },
        }),
      ],
      icon: null,
      runThread: async () => undefined,
    });
    const groups = filterCommandPaletteGroups({
      activeGroups: [
        {
          value: "actions",
          label: "Actions",
          items: [
            {
              kind: "action",
              value: "action:new-thread",
              searchTerms: ["new thread", "chat"],
              title: "New thread",
              icon: null,
              run: async () => undefined,
            },
          ],
        },
      ],
      query: "new",
      isInSubmenu: false,
      threadSearchItems,
      now,
    });
    expect(groups.map((group) => group.label)).toEqual(["Actions", "Threads"]);
  });

  it("ranks an order-independent setting title match above a split context match", () => {
    const settingsSearchItems = [
      {
        kind: "action" as const,
        value: "setting:context-match",
        searchTerms: ["Pairing settings", "remote backend"],
        title: "Context match",
        icon: null,
        run: async () => undefined,
      },
      {
        kind: "action" as const,
        value: "setting:remote-pairing",
        searchTerms: ["Remote pairing", "connections"],
        title: "Remote pairing",
        icon: null,
        run: async () => undefined,
      },
    ];

    const groups = filterCommandPaletteGroups({
      activeGroups: [],
      query: "pairing remote",
      isInSubmenu: false,
      settingsSearchItems,
      threadSearchItems: [],
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.value).toBe("settings-search");
    expect(groups[0]?.items.map((item) => item.value)).toEqual([
      "setting:remote-pairing",
      "setting:context-match",
    ]);
  });

  it("searches a styled command title by its plain text", () => {
    const groups = filterCommandPaletteGroups({
      activeGroups: [
        {
          value: "actions",
          label: "Actions",
          items: [
            {
              kind: "action",
              value: "action:new-thread",
              searchTerms: ["new thread", "chat"],
              // Styled: not a string, so only `searchTitle` holds its words.
              title: ["New thread in ", "ozi"],
              searchTitle: "New thread in ozi",
              icon: null,
              run: async () => undefined,
            },
          ],
        },
      ],
      query: "> new ozi",
      isInSubmenu: false,
      threadSearchItems: [],
    });
    expect(groups.flatMap((group) => group.items.map((item) => item.value))).toEqual([
      "action:new-thread",
    ]);
  });

  it("forgives a typo in a setting name when nothing matches exactly", () => {
    const groups = filterCommandPaletteGroups({
      activeGroups: [],
      query: "keybindngs",
      isInSubmenu: false,
      threadSearchItems: [],
      settingsSearchItems: [
        {
          kind: "action",
          value: "setting:keybindings",
          title: "Keybindings",
          searchTerms: ["Keybindings", "General", "shortcuts"],
          icon: null,
          run: async () => undefined,
        },
      ],
    });
    expect(groups.flatMap((group) => group.items.map((item) => item.value))).toEqual([
      "setting:keybindings",
    ]);
  });

  it("normalizes case independently of the host locale", () => {
    const toLocaleLowerCase = String.prototype.toLocaleLowerCase;
    const localeLowerCase = vi
      .spyOn(String.prototype, "toLocaleLowerCase")
      .mockImplementation(function (this: string) {
        return toLocaleLowerCase.call(this, "tr");
      });
    try {
      const groups = filterCommandPaletteGroups({
        activeGroups: [],
        query: "GIT",
        isInSubmenu: false,
        threadSearchItems: [],
        settingsSearchItems: [
          {
            kind: "action",
            value: "setting:version-control",
            title: "Version control",
            searchTerms: ["git"],
            icon: null,
            run: async () => undefined,
          },
        ],
      });
      expect(groups.flatMap((group) => group.items.map((item) => item.value))).toEqual([
        "setting:version-control",
      ]);
    } finally {
      localeLowerCase.mockRestore();
    }
  });

  it("surfaces threads when the query is their ID, without outranking title matches", () => {
    const idThread = makeThread({
      id: ThreadId.make("thread-alpha-1234"),
      title: "Unrelated work",
      updatedAt: "2026-03-05T00:00:00.000Z",
    });
    const titleThread = makeThread({
      id: ThreadId.make("thread-other-9999"),
      title: "Fix thread-alpha-1234 flakes",
      updatedAt: "2026-03-04T00:00:00.000Z",
    });
    const items = buildThreadActionItems({
      threads: [idThread, titleThread],
      icon: null,
      runThread: async (_thread) => undefined,
    });

    const groups = filterCommandPaletteGroups({
      activeGroups: [],
      query: "  THREAD-ALPHA-1234  ",
      isInSubmenu: false,
      settingsSearchItems: [],
      threadSearchItems: items,
    });

    expect(groups.flatMap((group) => group.items)).toEqual([
      expect.objectContaining({ value: `thread:${LOCAL_ENVIRONMENT_ID}:${titleThread.id}` }),
      expect.objectContaining({ value: `thread:${LOCAL_ENVIRONMENT_ID}:${idThread.id}` }),
    ]);
  });

  it("hides subagent threads but keeps forks", () => {
    const parentId = ThreadId.make("parent");
    const items = buildThreadActionItems({
      threads: [
        makeThread({ id: parentId, title: "Parent" }),
        makeThread({
          id: ThreadId.make("subagent"),
          title: "Subagent",
          lineage: {
            rootThreadId: parentId,
            parentThreadId: parentId,
            relationshipToParent: "subagent",
          },
        }),
        makeThread({
          id: ThreadId.make("fork"),
          title: "Fork",
          lineage: {
            rootThreadId: parentId,
            parentThreadId: parentId,
            relationshipToParent: "fork",
          },
        }),
      ],
      icon: null,
      runThread: async () => undefined,
    });

    expect(items.map((item) => item.value).toSorted()).toEqual([
      "thread:environment-local:fork",
      "thread:environment-local:parent",
    ]);
  });

  it("ranks word-start title matches above newer mid-word matches", () => {
    const items = buildThreadActionItems({
      threads: [
        makeThread({
          id: ThreadId.make("mid-word"),
          title: "Fix oauth redirect",
          updatedAt: "2026-03-20T00:00:00.000Z",
        }),
        makeThread({
          id: ThreadId.make("word-start"),
          title: "Clean up auth tokens",
          updatedAt: "2026-03-02T00:00:00.000Z",
        }),
        makeThread({
          id: ThreadId.make("branch-word-start"),
          title: "Refactor login",
          updatedAt: "2026-03-01T00:00:00.000Z",
        }),
      ],
      icon: null,
      runThread: async () => undefined,
    });

    const groups = filterCommandPaletteGroups({
      activeGroups: [],
      query: "auth",
      isInSubmenu: false,
      threadSearchItems: items,
    });

    expect(groups[0]?.items.map((item) => item.value)).toEqual([
      "thread:environment-local:word-start",
      "thread:environment-local:branch-word-start",
      "thread:environment-local:mid-word",
    ]);
  });

  it("breaks ties between equal matches by latest user message", () => {
    const items = buildThreadActionItems({
      threads: [
        makeThread({
          id: ThreadId.make("prefix-stale"),
          title: "Auth refactor",
          updatedAt: "2026-03-20T00:00:00.000Z",
          latestUserMessageAt: "2025-09-01T00:00:00.000Z",
        }),
        makeThread({
          id: ThreadId.make("word-fresh"),
          title: "Fix auth refresh",
          updatedAt: "2026-03-10T00:00:00.000Z",
          latestUserMessageAt: "2026-03-10T00:00:00.000Z",
        }),
      ],
      icon: null,
      runThread: async () => undefined,
    });

    const groups = filterCommandPaletteGroups({
      activeGroups: [],
      query: "auth",
      isInSubmenu: false,
      threadSearchItems: items,
      now: Date.parse("2026-03-20T00:00:00.000Z"),
    });

    expect(groups[0]?.items.map((item) => item.value)).toEqual([
      "thread:environment-local:word-fresh",
      "thread:environment-local:prefix-stale",
    ]);
  });
});

describe("filterPinnedBrowseEntries", () => {
  it("matches an existing pinned destination without Windows casing", () => {
    const windowsEntries = [
      { name: "Repo", fullPath: "C:\\projects\\Repo" },
      { name: "work", fullPath: "C:\\projects\\work" },
    ];
    expect(
      filterPinnedBrowseEntries({
        browseEntries: windowsEntries,
        filterQuery: "repo",
        pinnedDirectoryName: "repo",
        caseSensitive: false,
      }),
    ).toEqual({
      visibleEntries: windowsEntries,
      exactEntry: windowsEntries[0],
    });
  });
});

describe("command palette search return", () => {
  const picker = { addonIcon: null, groups: [] };

  it("restores each parent query when backing out of nested pickers", () => {
    let state = createCommandPaletteSearchState(">new thread");
    state = reduceCommandPaletteSearchState(state, { type: "push", view: picker });
    expect(state.query).toBe("");
    state = reduceCommandPaletteSearchState(state, { type: "query", query: "remote project" });
    state = reduceCommandPaletteSearchState(state, {
      type: "push",
      view: { ...picker, initialQuery: "~/" },
    });
    expect(state.query).toBe("~/");

    state = reduceCommandPaletteSearchState(state, { type: "query", query: "" });
    state = reduceCommandPaletteSearchState(state, { type: "back" });
    expect(state.query).toBe("remote project");
    expect(state.views).toHaveLength(1);
    state = reduceCommandPaletteSearchState(state, { type: "back" });
    expect(state.query).toBe(">new thread");
    expect(state.views).toHaveLength(0);
  });

  it("cannot return to an old picker after a new search replaces it", () => {
    let state = reduceCommandPaletteSearchState(createCommandPaletteSearchState("old"), {
      type: "push",
      view: picker,
    });
    state = reduceCommandPaletteSearchState(state, { type: "reset", query: "fresh" });
    state = reduceCommandPaletteSearchState(state, { type: "back" });
    expect(state.query).toBe("fresh");
    expect(state.views).toHaveLength(0);
  });
});

describe("returning from file and content search", () => {
  const root: CommandPaletteUiState = {
    open: true,
    mode: "command",
    openIntent: null,
    session: 0,
  };
  const query = "https://github.com/acme/web/pull/7";
  const context = {
    query,
    linkedThreadSearch: {
      kind: "search" as const,
      query,
      linkedThreads: {
        environmentId: EnvironmentId.make("remote"),
        threads: [
          {
            id: ThreadId.make("linked-thread"),
            title: "Completed work",
            archivedAt: "2026-09-01T00:00:00.000Z",
          },
        ],
      },
    },
  };

  it.each(["files", "content"] as const)(
    "Escape from %s restores the query and linked-thread results",
    (mode) => {
      const child = reduceCommandPaletteUiState(root, { _tag: "OpenChildSearch", mode, context });
      expect(child.mode).toBe(mode);
      const returned = reduceCommandPaletteUiState(child, { _tag: "BackToCommand" });
      expect(returned).toEqual({ ...root, restoredSearch: context });
      expect(reduceCommandPaletteUiState(returned, { _tag: "BackToCommand" })).toEqual(returned);
    },
  );

  it("closing a child search discards its return context before reopening", () => {
    const child: CommandPaletteUiState = { ...root, mode: "files", parentSearch: context };
    const closed = reduceCommandPaletteUiState(child, { _tag: "SetOpen", open: false });
    expect(closed).toEqual({ open: false, mode: "files", openIntent: null, session: 0 });
    expect(reduceCommandPaletteUiState(closed, { _tag: "BackToCommand" })).toEqual(closed);
    expect(reduceCommandPaletteUiState(closed, { _tag: "SetOpen", open: true })).toEqual(root);
  });
});
