import { workspaceEnvironment } from "../state/workspaceFiles";

import { useAtomValue } from "@effect/atom-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { createContext, type ReactNode } from "react";

export const FileMetadataThreadContext = createContext<ScopedThreadRef | null>(null);
const EMPTY_RETENTION = Atom.make(undefined);

export function FileMetadataThreadProvider({
  threadRef,
  children,
}: {
  readonly threadRef: ScopedThreadRef | null;
  readonly children?: ReactNode;
}) {
  useAtomValue(threadRef ? workspaceEnvironment.fileMetadataThread(threadRef) : EMPTY_RETENTION);
  return <FileMetadataThreadContext value={threadRef}>{children}</FileMetadataThreadContext>;
}
