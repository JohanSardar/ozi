import { describe, expect, it } from "vite-plus/test";

import { getProviderRowLabel } from "./providerIconUtils";

describe("getProviderRowLabel", () => {
  it("keeps the provider name when a model has no sub-provider", () => {
    expect(getProviderRowLabel("Claude", undefined)).toBe("Claude");
  });
});

describe("getDisplayModelName", () => {});
