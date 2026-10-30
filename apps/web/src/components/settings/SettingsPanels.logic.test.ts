import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { getChangedBrowserSettingLabels } from "./SettingsPanels.logic";

describe("background activity settings restore", () => {});

describe("getChangedBrowserSettingLabels", () => {
  it("counts a retained custom search URL so restore clears it", () => {
    expect(
      getChangedBrowserSettingLabels({
        ...DEFAULT_UNIFIED_SETTINGS,
        browserCustomSearchUrl: "https://search.example/?q=%s",
      }),
    ).toEqual(["Search engine"]);
  });
});
