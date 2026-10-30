import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  completeConfirmDialogClose,
  readConfirmDialogState,
  requestConfirmDialog,
  resetConfirmDialogForTests,
  respondToConfirmDialog,
  subscribeConfirmDialogHost,
} from "./confirmDialog";

const mountHost = () => subscribeConfirmDialogHost(() => {});

function requireConfirmation(confirmation: Promise<boolean> | undefined): Promise<boolean> {
  if (!confirmation) {
    throw new Error("Expected a registered confirmation host.");
  }
  return confirmation;
}

describe("confirm dialog coordinator", () => {
  beforeEach(() => {
    resetConfirmDialogForTests();
  });

  it("has no host until one subscribes", () => {
    expect(requestConfirmDialog("Continue?")).toBeUndefined();
    const unsubscribe = mountHost();
    expect(requestConfirmDialog("Continue?")).toBeDefined();
    unsubscribe();
    expect(requestConfirmDialog("Continue?")).toBeUndefined();
  });

  it("ignores responses after the active dialog has been closed", () => {
    const unregister = mountHost();
    const confirmation = requireConfirmation(requestConfirmDialog("Continue?"));

    respondToConfirmDialog(true);
    respondToConfirmDialog(false);
    completeConfirmDialogClose();

    expect(readConfirmDialogState()).toEqual({ status: "idle" });
    unregister();
    return expect(confirmation).resolves.toBe(true);
  });
});
