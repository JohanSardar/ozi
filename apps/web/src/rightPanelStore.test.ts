import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { useClosedViewStore } from "./closedViewStore";
import {
  migratePersistedRightPanelState,
  selectActiveRightPanelSurface,
  selectThreadRightPanelState,
  useRightPanelStore,
} from "./rightPanelStore";

const refA = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-A"));

beforeEach(() => {
  useClosedViewStore.setState({ entries: [] });
  useRightPanelStore.setState({
    byThreadKey: {},
    threadPanelVisibilityByThreadKey: {},
    userActionRevisionByThreadKey: {},
    closeRevisionByThreadKey: {},
  });
});

describe("rightPanelStore", () => {
  it("does not save an incidental Files replacement when opening an existing file", () => {
    const store = useRightPanelStore.getState();
    store.openFile(refA, "src/app.ts");
    store.open(refA, "files");
    store.openFile(refA, "src/app.ts");

    expect(useClosedViewStore.getState().entries).toEqual([]);
  });

  it("ignores session tabs without browser snapshots and records the empty browser tab", () => {
    const store = useRightPanelStore.getState();
    store.openBrowser(refA, "tab-1");
    store.closeSurface(refA, "browser:tab-1");
    expect(useClosedViewStore.getState().entries).toEqual([]);
    store.openBrowser(refA, null);
    store.closeSurface(refA, "browser:new");
    expect(useClosedViewStore.getState().entries).toMatchObject([
      { kind: "panel-tab", surface: { id: "browser:new", resourceId: null } },
    ]);
  });

  it("restores a saved maximized panel during migration", () => {
    const migrated = migratePersistedRightPanelState({
      byThreadKey: {
        "env-1:thread-A": {
          isOpen: true,
          activeSurfaceId: "browser:new",
          surfaces: [{ id: "browser:new", kind: "preview", resourceId: null }],
          maximized: true,
        },
      },
    });
    expect(selectThreadRightPanelState(migrated.byThreadKey, refA).maximized).toBe(true);
  });

  it("drops the legacy singleton terminal surface during migration", () => {
    expect(
      migratePersistedRightPanelState({
        byThreadKey: {
          "env-1:thread-A": {
            activeSurfaceId: "terminal",
            surfaces: [
              { id: "browser:tab-a", kind: "preview", resourceId: "tab-a" },
              { id: "terminal", kind: "terminal" },
            ],
          },
        },
      }),
    ).toEqual({
      byThreadKey: {
        "env-1:thread-A": {
          isOpen: false,
          activeSurfaceId: null,
          surfaces: [{ id: "browser:tab-a", kind: "preview", resourceId: "tab-a" }],
        },
      },
      threadPanelVisibilityByThreadKey: {},
    });
  });

  it("upgrades saved single-session terminal surfaces to split-capable surfaces", () => {
    expect(
      migratePersistedRightPanelState({
        byThreadKey: {
          "env-1:thread-A": {
            isOpen: true,
            activeSurfaceId: "terminal:term-1",
            surfaces: [{ id: "terminal:term-1", kind: "terminal", resourceId: "term-1" }],
          },
        },
      }),
    ).toEqual({
      byThreadKey: {
        "env-1:thread-A": {
          isOpen: true,
          activeSurfaceId: "terminal:term-1",
          surfaces: [
            {
              id: "terminal:term-1",
              kind: "terminal",
              resourceId: "term-1",
              terminalIds: ["term-1"],
              activeTerminalId: "term-1",
            },
          ],
        },
      },
      threadPanelVisibilityByThreadKey: {},
    });
  });

  it.each([
    { kind: "plan", isOpen: true },
    { kind: "agents", isOpen: true },
    { kind: "agents", isOpen: false },
  ])("drops $kind with isOpen=$isOpen and falls back", ({ kind, isOpen }) => {
    expect(
      migratePersistedRightPanelState({
        byThreadKey: {
          "env-1:thread-A": {
            isOpen,
            activeSurfaceId: kind,
            surfaces: [{ id: kind, kind }],
          },
          "env-1:thread-B": {
            isOpen,
            activeSurfaceId: kind,
            surfaces: [
              { id: kind, kind },
              { id: "diff", kind: "diff" },
            ],
          },
        },
      }),
    ).toEqual({
      byThreadKey: {
        "env-1:thread-A": {
          isOpen: false,
          activeSurfaceId: null,
          surfaces: [],
        },
        "env-1:thread-B": {
          isOpen,
          activeSurfaceId: "diff",
          surfaces: [{ id: "diff", kind: "diff" }],
        },
      },
      threadPanelVisibilityByThreadKey: {},
    });
  });

  it("persists inline preference without restoring an open popover", () => {
    expect(
      migratePersistedRightPanelState({
        threadPanelVisibilityByThreadKey: {
          "env-1:thread-A": { inlineOpen: false, popoverOpen: true },
          "env-1:thread-B": { inlineOpen: true, popoverOpen: true },
        },
      }),
    ).toEqual({
      byThreadKey: {},
      threadPanelVisibilityByThreadKey: {
        "env-1:thread-A": { inlineOpen: false, popoverOpen: false },
      },
    });
  });

  it("opens workspace-root links as the singleton files explorer", () => {
    const store = useRightPanelStore.getState();
    store.openFile(refA, "README.md");
    store.openFile(refA, ".");
    store.openFile(refA, ".");
    const state = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA);
    expect(state.activeSurfaceId).toBe("files");
    expect(state.surfaces.map((surface) => surface.id)).toEqual(["file:README.md", "files"]);
    store.closeSurface(refA, "files");
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA).activeSurfaceId,
    ).toBe("file:README.md");
    store.openFile(refA, ".");
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA).activeSurfaceId,
    ).toBe("files");
  });

  it("walks a folder browser up and back down in one tab", () => {
    const store = useRightPanelStore.getState();
    const state = () =>
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA);
    store.openFile(refA, "README.md");
    store.openFile(refA, "apps/web/src");

    store.navigateFolder(refA, "file:apps/web/src", "apps", "apps/web/src");
    expect(state().activeSurfaceId).toBe("file:apps");
    expect(state().surfaces).toEqual([
      expect.objectContaining({ id: "file:README.md" }),
      expect.objectContaining({
        id: "file:apps",
        relativePath: "apps",
        folderTrail: "apps/web/src",
      }),
    ]);

    store.navigateFolder(refA, "file:apps", "", "apps/web/src");
    expect(state().surfaces.map((surface) => surface.id)).toEqual(["file:README.md", "files"]);
    expect(state().surfaces[1]).toEqual({
      id: "files",
      kind: "files",
      folderTrail: "apps/web/src",
    });

    store.navigateFolder(refA, "files", "apps/web/src", "apps/web/src");
    expect(state().activeSurfaceId).toBe("file:apps/web/src");
    expect(state().surfaces[1]).toEqual({
      id: "file:apps/web/src",
      kind: "file",
      relativePath: "apps/web/src",
      revealLine: null,
      revealRequestId: 1,
    });
  });

  it("switches to a tab that already shows the folder instead of replacing it", () => {
    const store = useRightPanelStore.getState();
    store.openFile(refA, "apps");
    store.openFile(refA, "apps/web/src", 12);

    store.navigateFolder(refA, "file:apps/web/src", "apps", "apps/web/src");
    const state = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA);
    expect(state.activeSurfaceId).toBe("file:apps");
    expect(state.surfaces).toEqual([
      { id: "file:apps", kind: "file", relativePath: "apps", revealLine: null, revealRequestId: 1 },
    ]);
  });

  it("keeps a file's tab when walking up from it, and comes back to it", () => {
    const store = useRightPanelStore.getState();
    const state = () =>
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA);
    store.openFile(refA, "src/app.ts", 40);

    store.navigateFolder(refA, "file:src/app.ts", "src", "src/app.ts", true);
    expect(state().activeSurfaceId).toBe("file:src");
    expect(state().surfaces).toEqual([
      {
        id: "file:src/app.ts",
        kind: "file",
        relativePath: "src/app.ts",
        revealLine: 40,
        revealRequestId: 1,
      },
      expect.objectContaining({ id: "file:src", folderTrail: "src/app.ts" }),
    ]);

    store.navigateFolder(refA, "file:src", "src/app.ts", "src/app.ts");
    expect(state().activeSurfaceId).toBe("file:src/app.ts");
    expect(state().surfaces).toEqual([
      {
        id: "file:src/app.ts",
        kind: "file",
        relativePath: "src/app.ts",
        revealLine: 40,
        revealRequestId: 1,
      },
    ]);
  });

  // regression: #15045 breadcrumb navigation from a closed tab must not resurrect it
  it("ignores navigation from a tab that was closed", () => {
    const store = useRightPanelStore.getState();
    store.openFile(refA, "apps");
    const before = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA);
    store.navigateFolder(refA, "file:gone", "", "gone");
    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toBe(
      before,
    );
  });

  it("replaces the standalone explorer with peer file surfaces", () => {
    useRightPanelStore.getState().open(refA, "files");
    useRightPanelStore.getState().openFile(refA, "src/index.ts");
    useRightPanelStore.getState().openFile(refA, "src/index.ts");
    useRightPanelStore.getState().openFile(refA, "README.md");

    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      isOpen: true,
      activeSurfaceId: "file:README.md",
      surfaces: [
        {
          id: "file:src/index.ts",
          kind: "file",
          relativePath: "src/index.ts",
          revealLine: null,
          revealRequestId: 2,
        },
        {
          id: "file:README.md",
          kind: "file",
          relativePath: "README.md",
          revealLine: null,
          revealRequestId: 1,
        },
      ],
    });
  });

  it.each([
    ["generated\\", "generated"],
    ["notes/meeting ", "notes/meeting"],
    [" notes/meeting", "notes/meeting"],
  ])("keeps %j and %j in separate file tabs", (firstPath, secondPath) => {
    useRightPanelStore.getState().openFile(refA, firstPath);
    useRightPanelStore.getState().openFile(refA, secondPath);

    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA).surfaces,
    ).toMatchObject([
      { id: `file:${firstPath}`, relativePath: firstPath },
      { id: `file:${secondPath}`, relativePath: secondPath },
    ]);
  });

  it("keeps attachment and workspace file ids disjoint", () => {
    useRightPanelStore.getState().openFile(refA, "attachment:shared-id");
    useRightPanelStore.getState().openAttachment(refA, {
      type: "file",
      id: "shared-id",
      name: "report.pdf",
      mimeType: "application/pdf",
      sizeBytes: 42,
    });

    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA).surfaces.map(
        (surface) => surface.id,
      ),
    ).toEqual(["file:attachment:shared-id", "attachment:shared-id"]);
  });

  it("updates line reveal requests when reopening a file surface", () => {
    useRightPanelStore.getState().openFile(refA, "src/index.ts", 42);
    useRightPanelStore.getState().openFile(refA, "src/index.ts", 87);

    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      isOpen: true,
      activeSurfaceId: "file:src/index.ts",
      surfaces: [
        {
          id: "file:src/index.ts",
          kind: "file",
          relativePath: "src/index.ts",
          revealLine: 87,
          revealRequestId: 2,
        },
      ],
    });

    useRightPanelStore.getState().openFile(refA, "src/index.ts");

    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      isOpen: true,
      activeSurfaceId: "file:src/index.ts",
      surfaces: [
        {
          id: "file:src/index.ts",
          kind: "file",
          relativePath: "src/index.ts",
          revealLine: null,
          revealRequestId: 3,
        },
      ],
    });
  });

  it("keeps attachment previews when their workspace is unavailable", () => {
    const attachment = {
      type: "file" as const,
      id: "thread-A-attachment-pdf",
      name: "report.pdf",
      mimeType: "application/pdf",
      sizeBytes: 42,
    };
    useRightPanelStore.getState().openFile(refA, "README.md");
    useRightPanelStore.getState().openAttachment(refA, attachment);

    useRightPanelStore.getState().reconcileFileSurfaces(refA, false);

    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      isOpen: true,
      activeSurfaceId: "attachment:thread-A-attachment-pdf",
      surfaces: [
        {
          id: "attachment:thread-A-attachment-pdf",
          kind: "file",
          relativePath: "report.pdf",
          revealLine: null,
          revealRequestId: 0,
          attachment,
        },
      ],
    });
  });

  it("tracks split panes and the active pane within a terminal surface", () => {
    useRightPanelStore.getState().openTerminal(refA, "term-1");
    useRightPanelStore.getState().splitTerminal(refA, "terminal:term-1", "term-2");

    expect(selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      id: "terminal:term-1",
      kind: "terminal",
      resourceId: "term-1",
      terminalIds: ["term-1", "term-2"],
      activeTerminalId: "term-2",
    });

    useRightPanelStore.getState().activateTerminal(refA, "terminal:term-1", "term-1");
    useRightPanelStore.getState().closeTerminal(refA, "terminal:term-1", "term-1");
    expect(selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      id: "terminal:term-1",
      kind: "terminal",
      resourceId: "term-1",
      terminalIds: ["term-2"],
      activeTerminalId: "term-2",
    });
  });

  it("closing the final terminal pane removes its surface and closes the panel", () => {
    useRightPanelStore.getState().openTerminal(refA, "term-1");
    useRightPanelStore.getState().closeTerminal(refA, "terminal:term-1", "term-1");

    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      isOpen: false,
      activeSurfaceId: null,
      surfaces: [],
    });
  });

  it("closing the active surface activates a neighboring surface", () => {
    useRightPanelStore.getState().openBrowser(refA, "tab-a");
    useRightPanelStore.getState().openTerminal(refA, "term-1");
    useRightPanelStore.getState().closeSurface(refA, "terminal:term-1");

    expect(selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, refA)?.id).toBe(
      "browser:tab-a",
    );
  });

  it("closing surfaces to the right activates the selected surface when active was removed", () => {
    useRightPanelStore.getState().openBrowser(refA, "tab-a");
    useRightPanelStore.getState().openFile(refA, "src/index.ts");
    useRightPanelStore.getState().openTerminal(refA, "term-1");

    useRightPanelStore.getState().closeSurfacesToRight(refA, "browser:tab-a");

    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      isOpen: true,
      activeSurfaceId: "browser:tab-a",
      surfaces: [{ id: "browser:tab-a", kind: "preview", resourceId: "tab-a" }],
    });
  });

  it("does not replace a stale surface with a hidden tab, but preserves explicit opens", () => {
    const store = useRightPanelStore.getState();
    store.openBrowser(refA, "stale-tab");
    store.reconcileBrowserSurfaces(refA, ["hidden-tab"], new Set(["hidden-tab"]));
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA),
    ).toMatchObject({
      activeSurfaceId: null,
      surfaces: [],
    });

    store.openBrowser(refA, "hidden-tab");
    store.reconcileBrowserSurfaces(
      refA,
      ["hidden-tab", "other-tab"],
      new Set(["hidden-tab", "other-tab"]),
    );
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA),
    ).toMatchObject({
      isOpen: true,
      activeSurfaceId: "browser:hidden-tab",
      surfaces: [{ id: "browser:hidden-tab", kind: "preview", resourceId: "hidden-tab" }],
    });
  });
});
