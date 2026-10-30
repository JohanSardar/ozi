import { workspaceEnvironment } from "../state/workspaceFiles";

import { AuthFilesystemReadScope, type EnvironmentId } from "@t3tools/contracts";
import { resolvePathLinkTarget, splitFilePathPosition } from "@t3tools/shared/fileLinks";
import { isAbsolutePath, isNetworkPath, normalizePathForComparison } from "@t3tools/shared/path";
import { useContext } from "react";

import { useEnvironmentScope } from "../state/session";
import { useEnvironmentQuery } from "../state/query";
import { FileMetadataThreadContext } from "./FileMetadataThreadProvider";

export function useFileMetadata(
  environmentId: EnvironmentId | null | undefined,
  path: string,
  cwd?: string,
) {
  const canRead = useEnvironmentScope(environmentId ?? null, AuthFilesystemReadScope);
  const threadRef = useContext(FileMetadataThreadContext);
  const hostPath = splitFilePathPosition(path).path;
  const targetPath = normalizePathForComparison(
    hostPath.startsWith("~/") || !cwd ? hostPath : resolvePathLinkTarget(hostPath, cwd),
  );
  const absolute = isAbsolutePath(targetPath) || targetPath.startsWith("~/");
  return useEnvironmentQuery(
    // Servers stat what they are asked about, and a network path leaks the
    // Windows user's NTLM credentials to its host before any chip is clicked.
    environmentId && canRead && absolute && !isNetworkPath(targetPath) && targetPath.length <= 512
      ? workspaceEnvironment.fileMetadata({
          environmentId,
          input: {
            path: targetPath,
            ...(threadRef?.environmentId === environmentId ? { threadId: threadRef.threadId } : {}),
          },
        })
      : null,
  ).data;
}
