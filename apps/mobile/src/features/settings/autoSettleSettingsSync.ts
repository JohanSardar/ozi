import type { EnvironmentId, ServerSettings } from "@t3tools/contracts";

export type AutoSettleSettings = Pick<ServerSettings, "sidebarAutoSettleAfterDays">;

interface AutoSettleSyncTarget {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly settings: AutoSettleSettings | null;
}

export function planAutoSettleSettingsSync(
  reference: {
    readonly environmentId: EnvironmentId;
    readonly settings: AutoSettleSettings;
  },
  targets: readonly AutoSettleSyncTarget[],
) {
  const patch: AutoSettleSettings = {
    sidebarAutoSettleAfterDays: reference.settings.sidebarAutoSettleAfterDays,
  };
  const mismatches = targets.filter(
    (target) =>
      target.environmentId !== reference.environmentId &&
      target.settings !== null &&
      target.settings.sidebarAutoSettleAfterDays !== patch.sidebarAutoSettleAfterDays,
  );
  return { patch, mismatches };
}
