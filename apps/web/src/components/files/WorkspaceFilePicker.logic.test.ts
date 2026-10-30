import { assert, describe, it } from "vite-plus/test";

import { getWorkspaceFilePickerMatches } from "./WorkspaceFilePicker.logic";

function pathsForQuery(
  entries: Parameters<typeof getWorkspaceFilePickerMatches>[0],
  query: string,
) {
  return getWorkspaceFilePickerMatches(entries, query).map(({ name, path }) => ({ name, path }));
}

describe("getWorkspaceFilePickerMatches", () => {
  it("matches ordered characters while allowing skipped characters", () => {
    const fuzzyEntries = [
      { kind: "file", path: "src/TestFlags.tsx" },
      { kind: "file", path: "src/SubtestFlow.tsx" },
      { kind: "file", path: "src/useSubtestFlags.ts" },
      {
        kind: "file",
        path: "src/useSubtestFlags/useTabActivity.ts",
      },
    ] as const;

    assert.deepEqual(
      pathsForQuery(fuzzyEntries, "testf").map(({ name }) => name),
      ["TestFlags.tsx", "SubtestFlow.tsx", "useSubtestFlags.ts", "useTabActivity.ts"],
    );
    assert.deepEqual(getWorkspaceFilePickerMatches(fuzzyEntries, "tsfl")[0], {
      name: "TestFlags.tsx",
      nameMatchIndices: [0, 2, 4, 5],
      path: "src/TestFlags.tsx",
      pathMatchIndices: [4, 6, 8, 9],
    });
  });

  it("normalizes path prefixes consistently with server search", () => {
    assert.deepEqual(
      getWorkspaceFilePickerMatches([{ kind: "file", path: "src/index.ts" }], "@/src")[0]
        ?.pathMatchIndices,
      [0, 1, 2],
    );
  });
});
