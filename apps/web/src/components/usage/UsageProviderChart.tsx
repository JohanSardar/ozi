import type { UsageProviderKind } from "@t3tools/contracts";

export type UsageChartMetric = "tokens" | "cost";

export interface DayColumn {
  readonly bands: readonly {
    readonly provider: UsageProviderKind;
    readonly value: number;
  }[];
  readonly total: number;
}
