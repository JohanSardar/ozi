import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { EnvironmentId } from "@t3tools/contracts";

export const useUiStateStore = create<{
  oziEnvironmentId: EnvironmentId | null;
  setOziEnvironmentId: (id: EnvironmentId) => void;
  defaultAdvertisedEndpointKey: string | null;
  setDefaultAdvertisedEndpointKey: (key: string | null) => void;
}>()(
  persist(
    (set) => ({
      oziEnvironmentId: null,
      setOziEnvironmentId: (oziEnvironmentId) => set({ oziEnvironmentId }),
      defaultAdvertisedEndpointKey: null,
      setDefaultAdvertisedEndpointKey: (defaultAdvertisedEndpointKey) =>
        set({ defaultAdvertisedEndpointKey }),
    }),
    { name: "ozi:connection-choice" },
  ),
);
