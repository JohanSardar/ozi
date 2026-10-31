import { create } from "zustand";
import type {
  AssetResource,
  ChatAttachment,
  EnvironmentId,
  ScopedThreadRef,
  Ticket,
} from "@t3tools/contracts";

export interface FileSheetTarget {
  name: string;
  mimeType: string;
  sizeBytes: number;
  environmentId?: EnvironmentId | undefined;
  resource?: AssetResource | undefined;
  attachment?: ChatAttachment | undefined;
  threadRef?: ScopedThreadRef | undefined;
  file?: Blob | null;
  src?: string | undefined;
  ticket?: Ticket;
}
export const useFileSheet = create<{
  target: FileSheetTarget | null;
  open: (target: FileSheetTarget) => void;
  close: () => void;
}>((set) => ({
  target: null,
  open: (target) => set({ target }),
  close: () => set({ target: null }),
}));
