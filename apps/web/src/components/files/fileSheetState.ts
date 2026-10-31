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
  environmentId?: EnvironmentId;
  resource?: AssetResource;
  attachment?: ChatAttachment;
  threadRef?: ScopedThreadRef;
  file?: Blob | null;
  src?: string;
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
