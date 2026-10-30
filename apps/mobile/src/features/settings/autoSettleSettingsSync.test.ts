import { DEFAULT_SERVER_SETTINGS, EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { planAutoSettleSettingsSync } from "./autoSettleSettingsSync";

const reference = {
  environmentId: EnvironmentId.make("reference"),
  settings: {
    ...DEFAULT_SERVER_SETTINGS,
    sidebarAutoSettleAfterDays: 7,
    sidebarAutoSettleOnMerge: true,
    continueThreadsAfterServerUpdate: false,
  },
};

describe("auto-settle settings sync", () => {
  it("notices different project checkouts on the same environment", () => {
    const projectReference = { ...reference, projectId: ProjectId.make("one") };
    const otherCheckout = {
      environmentId: reference.environmentId,
      projectId: ProjectId.make("two"),
      label: "Other checkout",
      settings: { ...reference.settings, sidebarAutoSettleAfterDays: null },
    };

    expect(planAutoSettleSettingsSync(projectReference, [otherCheckout]).mismatches).toEqual([
      otherCheckout,
    ]);
  });
});
