import { type EnvironmentId, type WorkspaceReadFileResult, WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { Atom } from "effect/reactivity";

import {
  type EnvironmentRpcInput,
  type EnvironmentRpcSuccess,
  request,
  requestGuarded,
} from "../rpc/client.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentCommand,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createFileMetadataAtoms } from "./fileMetadata.ts";
import { resolveWorkspaceFilePath } from "@t3tools/shared/path";

export interface OptimisticWorkspaceFile {
  readonly data: WorkspaceReadFileResult;
  readonly confirmedAgainst: object | null | undefined;
}

export interface OptimisticWorkspaceFileTarget {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly relativePath: string;
}

function optimisticWorkspaceFileKey(target: OptimisticWorkspaceFileTarget): string {
  return JSON.stringify([target.environmentId, target.cwd, target.relativePath]);
}

function writtenFilePaths(
  input: EnvironmentRpcInput<typeof WS_METHODS.workspaceWriteFile>,
  result: EnvironmentRpcSuccess<typeof WS_METHODS.workspaceWriteFile>,
) {
  return new Set(
    [result.relativePath, input.relativePath].map((path) =>
      resolveWorkspaceFilePath(path, input.cwd),
    ),
  );
}

export function createWorkspaceEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const fileMetadata = createFileMetadataAtoms(runtime);
  const fileScheduler = createAtomCommandScheduler();
  const optimisticFileFamily = Atom.family((key: string) =>
    Atom.make<OptimisticWorkspaceFile | null>(null).pipe(
      Atom.withLabel(`environment-data:workspace:optimistic-file:${key}`),
    ),
  );
  return {
    fileMetadata: fileMetadata.metadata,
    fileMetadataThread: fileMetadata.retainThread,
    invalidateFileMetadata: createEnvironmentCommand(runtime, {
      label: "environment-data:filesystem:invalidate-metadata",
      execute: (input: { paths: ReadonlyArray<string> }, registry, environmentId) =>
        Effect.forEach([...new Set(input.paths)], (path) =>
          fileMetadata
            .invalidate(path)
            .pipe(
              Effect.tap(() =>
                Effect.sync(() => fileMetadata.refreshPath(environmentId, path, registry)),
              ),
            ),
        ),
    }),
    searchEntries: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:workspace:search-entries",
      tag: WS_METHODS.workspaceSearchEntries,
      staleTimeMs: 15_000,
      execute: (input) =>
        fileMetadata.seedAfterRead(
          request(WS_METHODS.workspaceSearchEntries, input),
          (result, isCurrent) => fileMetadata.rememberEntries(input.cwd, result.entries, isCurrent),
        ),
    }),
    listEntries: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:workspace:list-entries",
      tag: WS_METHODS.workspaceListEntries,
      staleTimeMs: 30_000,
      idleTtlMs: 5 * 60_000,
      execute: (input) =>
        fileMetadata.seedAfterRead(
          request(WS_METHODS.workspaceListEntries, input),
          (result, isCurrent) => fileMetadata.rememberEntries(input.cwd, result.entries, isCurrent),
        ),
    }),
    readFile: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:workspace:read-file",
      tag: WS_METHODS.workspaceReadFile,
      staleTimeMs: 30_000,
      idleTtlMs: 5 * 60_000,
      execute: (input) =>
        fileMetadata.seedAfterRead(
          request(WS_METHODS.workspaceReadFile, input),
          (result, isCurrent) =>
            result.exists === false
              ? Effect.void
              : fileMetadata.rememberFile(input.cwd, result, isCurrent),
        ),
    }),
    optimisticFile: (target: OptimisticWorkspaceFileTarget) =>
      optimisticFileFamily(optimisticWorkspaceFileKey(target)),
    writeFile: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:workspace:write-file",
      tag: WS_METHODS.workspaceWriteFile,
      scheduler: fileScheduler,
      concurrency: {
        mode: "serial",
        key: ({ environmentId, input }) =>
          JSON.stringify([environmentId, input.cwd, input.relativePath]),
      },
      execute: (input) =>
        requestGuarded(WS_METHODS.workspaceWriteFile, input).pipe(
          Effect.tap((result) =>
            Effect.forEach(writtenFilePaths(input, result), fileMetadata.invalidate),
          ),
        ),
      onSuccess: ({ environmentId, input }, registry, result) =>
        Effect.sync(() => {
          for (const path of writtenFilePaths(input, result))
            fileMetadata.refreshPath(environmentId, path, registry);
        }),
    }),
  };
}

export * from "./workspacePaths.ts";
