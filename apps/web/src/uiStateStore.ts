import { create } from "zustand";
import { persist } from "zustand/middleware";

export const useUiStateStore = create<{
  defaultAdvertisedEndpointKey: string | null;
  setDefaultAdvertisedEndpointKey: (key: string | null) => void;
}>()(
  persist(
    (set) => ({
      defaultAdvertisedEndpointKey: null,
      setDefaultAdvertisedEndpointKey: (defaultAdvertisedEndpointKey) =>
        set({ defaultAdvertisedEndpointKey }),
    }),
    { name: "ozi:connection-choice" },
  ),
);
