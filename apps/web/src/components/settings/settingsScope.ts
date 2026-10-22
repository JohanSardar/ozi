export interface SettingsScopeSearch {
  machine?: string | undefined;
}

export function validateSettingsScopeSearch(raw: Record<string, unknown>): SettingsScopeSearch {
  return typeof raw.machine === "string" && raw.machine.trim() ? { machine: raw.machine } : {};
}
