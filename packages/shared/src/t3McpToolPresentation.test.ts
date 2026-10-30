import { describe, expect, it } from "vite-plus/test";

import {
  OZI_MCP_TOOL_NAMES,
  resolveT3McpSummaryAction,
  resolveT3McpToolDefinition,
  resolveT3McpToolPresentation,
} from "./t3McpToolPresentation.ts";

describe("resolveT3McpToolPresentation", () => {
  it("recognizes every T3 tool across provider prefixes and completion suffixes", () => {
    for (const tool of OZI_MCP_TOOL_NAMES) {
      const presentation = resolveT3McpToolPresentation(tool);
      for (const prefix of ["mcp__ozi__", "Ozi.", "ozi/", "ozi:", "mcp_ozi_", "Ozi ", "ozi · "]) {
        expect(resolveT3McpToolPresentation(`${prefix}${tool} completed`), tool).toEqual(
          presentation,
        );
      }
      expect(resolveT3McpToolPresentation(`mcp__another-server__${tool}`), tool).toBeNull();
    }
  });

  it("matches OpenCode 2's per-thread server names, whose thread ids hold underscores", () => {
    expect(
      resolveT3McpToolPresentation("ozi-thread_opencode2-adapter_delegate_task")?.displayName,
    ).toBe("Delegate a child task");
    expect(resolveT3McpToolPresentation("ozi-thread_opencode2-adapter_not_a_tool")).toBeNull();
  });
});

describe("resolveT3McpToolDefinition", () => {
  it("labels an action tool call as the action it ran", () => {
    expect(resolveT3McpToolDefinition("mcp__ozi__preview_act", { action: "type" })?.labels).toEqual(
      resolveT3McpToolDefinition("preview_type")?.labels,
    );
    expect(resolveT3McpToolDefinition("ozi_thread_transfer", { action: "fork" })?.displayName).toBe(
      resolveT3McpToolDefinition("ozi_thread_fork")?.displayName,
    );
    expect(resolveT3McpToolDefinition("preview_act", { action: "unknown" })?.labels[2]).toBe(
      "Used",
    );
  });
});

describe("resolveT3McpSummaryAction", () => {
  it("summarizes an action tool by the action each call ran", () => {
    expect(resolveT3McpSummaryAction("mcp__ozi__ozi_queue", { action: "list" })).toBe("queue-list");
    expect(resolveT3McpSummaryAction("ozi_queue", { action: "edit" })).toBe("queue-edit");
    expect(resolveT3McpSummaryAction("ozi_thread_transfer", { action: "status" })).toBe(
      "thread-transfers",
    );
    expect(resolveT3McpSummaryAction("ozi_thread_configure", {})).toBe("thread-configuration");
    expect(resolveT3McpSummaryAction("schedule_task", { scheduledTaskId: "task-1" })).toBe(
      "schedule-update",
    );
    expect(resolveT3McpSummaryAction("delegate_task", { task: "x" })).toBe("delegate");
  });
});
