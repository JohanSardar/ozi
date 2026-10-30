import type { ComponentProps } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

const state = vi.hoisted(() => ({
  projection: null as unknown,
  workflow: null as unknown,
}));

vi.mock(import("@t3tools/client-runtime/state/thread-workflows"), async (importOriginal) => ({
  ...(await importOriginal()),
  deriveThreadQueueWorkflowState: (() => state.workflow) as never,
}));

vi.mock(import("../../state/entities"), async (importOriginal) => ({
  ...(await importOriginal()),
  useThreadProjection: (() => state.projection) as never,
  useQuietThreadShell: ((target: unknown) =>
    target === null ? null : { title: "Release lead" }) as never,
}));

vi.mock(import("../../state/query"), async (importOriginal) => ({
  ...(await importOriginal()),
  useEnvironmentQuery: (() => ({
    data: { tasks: [{ id: "task:webhook", title: "PR dispatcher" }] },
  })) as never,
}));

vi.mock(import("../../state/use-atom-command"), async (importOriginal) => ({
  ...(await importOriginal()),
  useAtomCommand: (() => async () => undefined) as never,
}));

vi.mock(import("../../assets/assetUrls"), async (importOriginal) => ({
  ...(await importOriginal()),
  useAssetUrls: ((_environmentId: never, resources: ReadonlyArray<{ attachmentId: string }>) =>
    resources.map((resource) => `https://assets.test/${resource.attachmentId}`)) as never,
}));

import "~/index.css";
import { render as renderUi } from "../../../test/render";
import { QueuedRunsControl } from "./QueuedRunsControl";

function setup() {
  state.projection = null;
  state.workflow = null;
}

const baseProps = {
  environmentId: "environment:test" as never,
  optimisticMessages: [],
  threadId: "thread:test" as never,
  editingRunId: null,
  editBlockedReason: null,
  onEditQueuedRun: () => undefined,
  onCancelEdit: () => undefined,
  timestampFormat: "locale",
  onOpenThread: () => undefined,
} satisfies ComponentProps<typeof QueuedRunsControl>;

it("stays inside the timeline scroller instead of growing the chat column", async () => {
  setup();
  state.projection = { projection: { messages: [] } };
  state.workflow = {
    activeRun: { id: "run:active" },
    canPromoteToSteer: true,
    queuedRuns: [
      {
        run: { id: "run:queued", userMessageId: "message:queued" },
        text: "Later",
        attachments: [],
      },
    ],
  };
  // Mirrors ChatView: a scrollable column, a positioned wrapper, then a non-positioned scroller.
  await using screen = await renderUi(
    <div data-testid="column" style={{ height: 200, overflowY: "auto" }}>
      <div style={{ position: "relative", height: "100%" }}>
        <div style={{ height: "100%", overflowY: "auto" }}>
          <div style={{ height: 1000 }} />
          <QueuedRunsControl {...baseProps} />
        </div>
      </div>
    </div>,
  );
  await expect.element(page.getByText("Later", { exact: true })).toBeInTheDocument();
  const column = screen.getByTestId("column").element();
  expect(column.scrollHeight).toBe(column.clientHeight);
});
