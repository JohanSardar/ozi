export interface T3ToolSummaryCall {
  readonly input: unknown;
  readonly output: unknown;
  readonly outcome: "completed" | "failed" | "unfinished";
}
