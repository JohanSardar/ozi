import { OZI_WS_METHODS, OziCheckError } from "@t3tools/contracts";
import * as Completion from "./ozi/Completion.ts";
import * as EventSink from "./orchestration-v2/EventSink.ts";

import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Base64 from "effect/encoding/Base64";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";
import { rpcInitialItems } from "./rpcInitialItems.ts";
import { subscribeChatGptHandoff } from "./provider/CodexChatGptHandoff.ts";
import { subscribeCodexAuthCallback } from "./provider/CodexAuthCallback.ts";
import {
  authScopeResponse,
  AuthAccessStreamError,
  type AuthAccessStreamEvent,
  AuthOrchestrationOperateScope,
  type ScheduledTaskListResult,
  AuthSessionId,
  ClientSurface,
  type DiscoveredLocalServerList,
  type EditorId,
  type FileManagerRevealKind,
  type OrchestrationClientOrigin,
  type MessageId,
  OrchestrationSearchThreadsError,
  OrchestrationV2SearchThreadError,
  ORCHESTRATION_V2_WS_METHODS,
  ORCHESTRATION_PROTOCOL_QUERY_PARAM,
  ORCHESTRATION_PROTOCOL_VERSION,
  OrchestrationV2DispatchCommandError,
  OrchestrationV2GetShellSnapshotError,
  OrchestrationV2GetThreadProjectionError,
  type OrchestrationV2ShellSnapshot,
  ProviderUploadFeedbackError,
  ProviderSetupError,
  type ServerConfig as ClientServerConfig,
  type ServerConfigStreamEvent,
  type ServerLifecycleStreamEvent,
  AssetWorkspaceContextNotFoundError,
  AssetWorkspaceContextResolutionError,
  ChatAttachmentId,
  PersistChatAttachmentsError,
  ThreadId,
  WS_METHODS,
  WsRpcGroup,
} from "@t3tools/contracts";
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerRespondable,
  HttpServerResponse,
} from "effect/http";
import { RpcSerialization, RpcServer } from "effect/rpc";
import * as ServerConfig from "./config.ts";
import * as EnvironmentTheme from "./environmentTheme.ts";
import * as Keybindings from "./keybindings.ts";
import * as ExternalLauncher from "./process/externalLauncher.ts";
import * as ThreadManagementService from "./orchestration-v2/ThreadManagementService.ts";
import * as Jobs from "./ozi/Jobs.ts";
import { OziClock } from "./ozi/Clock.ts";
import { Scheduler } from "./scheduling/Scheduler.ts";
import { Todos } from "./ozi/Todos.ts";
import * as CommandOutputHub from "./orchestration-v2/CommandOutputHub.ts";
import * as McpAppRequests from "./mcpApps/McpAppRequests.ts";
import * as ProviderSessionManager from "./orchestration-v2/ProviderSessionManager.ts";
import * as ThreadMessageIntake from "./orchestration-v2/ThreadMessageIntake.ts";
import * as ScheduledTasks from "./scheduledTasks/ScheduledTaskService.ts";
import * as SecretRequests from "./secrets/SecretRequests.ts";
import {
  archivedShellStreamItemFromThreadShell,
  buildActiveShellSnapshot,
  bufferShellLiveStream,
  coalesceShellApplicationEvents,
  coalesceStoredThreadEvents,
  loadShellSnapshotParts,
  shellStreamItemFromThreadShell,
  skipUnchangedThreadShells,
  toShellApplicationEvent,
  type ShellApplicationEvent,
} from "./orchestration-v2/ShellStream.ts";
import { bufferLiveStream } from "./orchestration-v2/LiveStreamBudget.ts";
import { coalesceThreadLiveStream } from "./orchestration-v2/ThreadLiveEventCoalescer.ts";
import {
  buildBoundedThreadStreamSnapshot,
  decideThreadResume,
  isThreadReplayRawPayloadSafe,
  threadReplayEncodedBytes,
  THREAD_RESUME_MAX_REPLAY_EVENTS,
} from "./orchestration-v2/ThreadStream.ts";
import {
  buildBoundedThreadProjection,
  THREAD_HISTORY_PAGE_POLICY,
  THREAD_HISTORY_SNAPSHOT_ROW_LIMIT,
} from "./orchestration-v2/threadHistoryPaging.ts";
import {
  projectDomainEventForWire,
  projectThreadProjectionForWire,
} from "./orchestration-v2/WireProjection.ts";
import * as ProjectStore from "./orchestration-v2/ProjectStore.ts";
import * as ThreadSearch from "./orchestration-v2/ThreadSearch.ts";
import * as OrchestrationEventStore from "./persistence/OrchestrationEventStore.ts";
import { userFacingDispatchErrorMessage } from "./orchestration-v2/UserFacingErrors.ts";
import * as ProviderRegistry from "./provider/ProviderRegistry.ts";
import * as ProviderInstanceRegistry from "./provider/ProviderInstanceRegistry.ts";
import * as ModelManifest from "./provider/ModelManifest.ts";
import * as ProviderLatestVersions from "@t3tools/provider-core/server/ProviderLatestVersions";
import { latestProviderVersionCacheKeys } from "@t3tools/provider-core/server/maintenanceResolver";
import * as ProviderMaintenanceRunner from "./provider/providerMaintenanceRunner.ts";
import * as ProviderAuthService from "./provider/ProviderAuthService.ts";
import { makeProviderInstallation } from "./provider/providerInstallation.ts";
import * as ServerLifecycleEvents from "./serverLifecycleEvents.ts";
import * as ServerRuntimeStartup from "./serverRuntimeStartup.ts";
import * as ServerSettings from "./serverSettings.ts";
import * as DatabaseStorage from "./persistence/DatabaseStorage.ts";
import * as PreviewAutomationBroker from "./mcp/PreviewAutomationBroker.ts";
import * as ServerBrowser from "./preview/ServerBrowser.ts";
import * as PreviewManager from "./preview/Manager.ts";
import { issueAssetUrl } from "./assets/AssetAccess.ts";
import {
  attachmentRelativePath,
  chatAttachmentStableKey,
  createDeterministicAttachmentId,
} from "./attachmentStore.ts";
import { parseBase64DataUrl } from "./imageMime.ts";
import { deletePendingAttachment, issueAttachmentUploadUrl } from "./assets/AttachmentUpload.ts";
import * as PortScanner from "./preview/PortScanner.ts";
import { readWorkflowScript } from "./orchestration-v2/workflowScriptQuery.ts";
import * as ProjectService from "./project/ProjectService.ts";
import * as ServerEnvironment from "./environment/ServerEnvironment.ts";
import * as DirectEndpoints from "./environment/DirectEndpoints.ts";
import * as RemoteOpenTargets from "./environment/RemoteOpenTargets.ts";
import * as DefectReporter from "./observability/DefectReporter.ts";
import * as EventLoopMonitor from "./observability/EventLoopMonitor.ts";
import * as EnvironmentAuth from "./auth/EnvironmentAuth.ts";
import * as RpcAuthorization from "./auth/RpcAuthorization.ts";
import { RpcInstrumentation, rpcInstrumentationLayer } from "./observability/RpcInstrumentation.ts";
import * as UsageService from "./usage/UsageService.ts";
import * as TraceDiagnostics from "./diagnostics/TraceDiagnostics.ts";
import * as SqlClient from "effect/sql/SqlClient";
import * as OtlpEndpointCheck from "./observability/OtlpEndpointCheck.ts";
import * as PairingGrantStore from "./auth/PairingGrantStore.ts";
import * as SessionStore from "./auth/SessionStore.ts";
import { failEnvironmentAuthInvalid, failEnvironmentInternal } from "./auth/http.ts";

const CONFIG_DISCOVERY_TIMEOUT = Duration.seconds(5);
const isProviderUploadFeedbackError = Schema.is(ProviderUploadFeedbackError);

const resolveDiscoveryForConfig = <A, E, R>(
  discovery: Effect.Effect<A, E, R>,
  onTimeout: () => A,
) =>
  discovery.pipe(
    Effect.timeoutOption(CONFIG_DISCOVERY_TIMEOUT),
    Effect.map(Option.getOrElse(onTimeout)),
  );

const resolveAvailableEditorsForConfig = <A, E, R>(
  discovery: Effect.Effect<ReadonlyArray<A>, E, R>,
) => resolveDiscoveryForConfig(discovery, () => []);

const resolveFileManagerRevealKindForConfig = <E, R>(
  discovery: Effect.Effect<FileManagerRevealKind | undefined, E, R>,
) => resolveDiscoveryForConfig(discovery, () => undefined);

type EditorDiscovery = Pick<
  ExternalLauncher.ExternalLauncher["Service"],
  "resolveAvailableEditors" | "resolveFileManagerRevealKind"
>;

const resolveEditorConfig = Effect.fn("ws.resolveEditorConfig")(function* <E, R>(
  availableEditors: ReadonlyArray<EditorId>,
  revealKind: Effect.Effect<FileManagerRevealKind | undefined, E, R>,
) {
  const fileManagerRevealKind = availableEditors.includes("file-manager")
    ? yield* revealKind
    : undefined;
  return {
    availableEditors,
    ...(fileManagerRevealKind === undefined
      ? {}
      : {
          shellRevealInFileManager: true,
          shellRevealInFileManagerKind: fileManagerRevealKind,
        }),
  };
});

const withLateEditorConfig = <E, R>(
  config: ClientServerConfig,
  liveUpdates: Stream.Stream<ServerConfigStreamEvent, E, R>,
  launcher: EditorDiscovery,
) => {
  const lateEditorConfig = Stream.fromEffect(launcher.resolveAvailableEditors()).pipe(
    Stream.filter(
      (editors) =>
        editors.join() !== config.availableEditors.join() ||
        (editors.includes("file-manager") && config.shellRevealInFileManagerKind === undefined),
    ),
    // Unbounded, unlike the snapshot: the reveal-kind probe is not shared, so
    // a timeout here would cancel a probe that outlasts it every time.
    Stream.mapEffect((editors) =>
      resolveEditorConfig(editors, launcher.resolveFileManagerRevealKind()),
    ),
    Stream.filter(
      (editorConfig) =>
        editorConfig.availableEditors.join() !== config.availableEditors.join() ||
        editorConfig.shellRevealInFileManagerKind !== config.shellRevealInFileManagerKind,
    ),
    Stream.map((editorConfig) => ({ type: "editorsResolved" as const, editorConfig })),
  );

  return Stream.merge(liveUpdates, lateEditorConfig).pipe(
    Stream.mapAccum(
      (): ClientServerConfig => config,
      (current, event): readonly [ClientServerConfig, ReadonlyArray<ServerConfigStreamEvent>] => {
        switch (event.type) {
          case "editorsResolved": {
            const {
              availableEditors: _editors,
              shellRevealInFileManager: _reveal,
              shellRevealInFileManagerKind: _revealKind,
              ...rest
            } = current;
            const next = { ...rest, ...event.editorConfig };
            return [next, [{ version: 1, type: "snapshot", config: next }]];
          }
          case "keybindingsUpdated":
            return [{ ...current, ...event.payload }, [event]];
          case "providerStatuses":
            return [{ ...current, providers: event.payload.providers }, [event]];
          case "settingsUpdated":
            return [{ ...current, settings: event.payload.settings }, [event]];
          // Themes and usage-limit sources never ride in a snapshot; clients
          // carry their projected values across one.
          default:
            return [current, [event]];
        }
      },
    ),
  );
};

const persistChatAttachments = Effect.fn("ws.assets.persistChatAttachments")(function* (input: {
  readonly threadId: ThreadId;
  readonly messageId: MessageId;
  readonly attachments: ReadonlyArray<{
    readonly type: "image";
    readonly name: string;
    readonly mimeType: string;
    readonly sizeBytes: number;
    readonly dataUrl: string;
  }>;
}) {
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  return yield* Effect.forEach(
    input.attachments.map((attachment, index) => ({ attachment, index })),
    Effect.fn("ws.assets.persistChatAttachment")(function* ({ attachment, index }) {
      const parsed = parseBase64DataUrl(attachment.dataUrl);
      if (parsed === null || parsed.mimeType !== attachment.mimeType.toLowerCase()) {
        return yield* new PersistChatAttachmentsError({
          message: `Attachment ${attachment.name} has an invalid image payload.`,
        });
      }
      const bytes = yield* Effect.fromResult(Base64.decode(parsed.base64)).pipe(
        Effect.mapError(
          (cause) =>
            new PersistChatAttachmentsError({
              message: `Attachment ${attachment.name} is not valid base64.`,
              cause,
            }),
        ),
      );
      if (bytes.byteLength !== attachment.sizeBytes) {
        return yield* new PersistChatAttachmentsError({
          message: `Attachment ${attachment.name} size does not match its payload.`,
        });
      }
      const rawId = createDeterministicAttachmentId(
        input.threadId,
        chatAttachmentStableKey(input.messageId, index, bytes),
      );
      if (rawId === null) {
        return yield* new PersistChatAttachmentsError({
          message: "Could not allocate an attachment identifier.",
        });
      }
      const persisted = {
        type: "image" as const,
        id: ChatAttachmentId.make(rawId),
        name: attachment.name,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
      };
      yield* fileSystem
        .writeFile(path.join(config.attachmentsDir, attachmentRelativePath(persisted)!), bytes)
        .pipe(
          Effect.mapError(
            (cause) =>
              new PersistChatAttachmentsError({
                message: `Could not persist attachment ${attachment.name}.`,
                cause,
              }),
          ),
        );
      return persisted;
    }),
    { concurrency: 2 },
  );
});

const PROVIDER_STATUS_DEBOUNCE_MS = 200;

// Middleware added later wraps middleware added earlier, so instrumentation wraps authorization.
const ServerWsRpcGroup = WsRpcGroup.middleware(RpcInstrumentation);
// Replaying each intervening event costs a shell refetch; past this gap a
// single O(active-threads) snapshot is cheaper and bounded.
const SHELL_RESUME_MAX_GAP = 1_000;
// Row count alone does not bound replay memory: a few events with large tool
// payloads can decode to gigabytes. Before replaying, sum the serialized
// payload bytes of the range in SQL and reset with a snapshot past this budget.
const ORCHESTRATION_REPLAY_PAYLOAD_BUDGET_BYTES = 8 * 1024 * 1024;

function toAuthAccessStreamEvent(
  change: PairingGrantStore.BootstrapCredentialChange | SessionStore.SessionCredentialChange,
  revision: number,
  currentSessionId: AuthSessionId,
): AuthAccessStreamEvent {
  switch (change.type) {
    case "pairingLinkUpserted":
      return {
        version: 1,
        revision,
        type: "pairingLinkUpserted",
        payload: { ...change.pairingLink, ...authScopeResponse(change.pairingLink.scopes) },
      };
    case "pairingLinkRemoved":
      return {
        version: 1,
        revision,
        type: "pairingLinkRemoved",
        payload: { id: change.id },
      };
    case "clientUpserted":
      return {
        version: 1,
        revision,
        type: "clientUpserted",
        payload: {
          ...change.clientSession,
          ...authScopeResponse(change.clientSession.scopes),
          current: change.clientSession.sessionId === currentSessionId,
        },
      };
    case "clientRemoved":
      return {
        version: 1,
        revision,
        type: "clientRemoved",
        payload: { sessionId: change.sessionId },
      };
  }
}

const isClientSurface = Schema.is(ClientSurface);
const MAX_CLIENT_APP_VERSION_LENGTH = 64;

function hasCompatibleOrchestrationProtocol(url: URL): boolean {
  return (
    url.searchParams.get(ORCHESTRATION_PROTOCOL_QUERY_PARAM) ===
    String(ORCHESTRATION_PROTOCOL_VERSION)
  );
}

function shouldUseBoundedThreadSnapshot(input: {
  readonly acceptBoundedSnapshot?: boolean;
}): boolean {
  return input.acceptBoundedSnapshot === true;
}

function readClientConnectionOrigin(
  request: HttpServerRequest.HttpServerRequest,
): OrchestrationClientOrigin {
  const url = HttpServerRequest.toURL(request);
  if (Option.isNone(url)) {
    return {};
  }
  const surface = url.value.searchParams.get("clientSurface");
  const appVersion = url.value.searchParams.get("clientAppVersion")?.trim() ?? "";
  return {
    ...(isClientSurface(surface) ? { surface } : {}),
    ...(appVersion !== "" && appVersion.length <= MAX_CLIENT_APP_VERSION_LENGTH
      ? { appVersion }
      : {}),
  };
}

const canReplayPersistedRange = Effect.fnUntraced(function* (
  afterSequence: number,
  headSequence: number,
  maxGap: number,
) {
  const applicationEvents = yield* OrchestrationEventStore.OrchestrationEventStore;

  const replayGap = headSequence - afterSequence;
  if (replayGap < 0 || replayGap > maxGap) {
    return false;
  }
  const stats = yield* applicationEvents.getReplayStats({
    afterSequence,
    throughSequence: headSequence,
  });
  if (stats.rawPayloadBytes > ORCHESTRATION_REPLAY_PAYLOAD_BUDGET_BYTES) {
    yield* Effect.logDebug("orchestration replay replaced by snapshot", {
      afterSequence,
      headSequence,
      replayGap,
      eventCount: stats.eventCount,
      payloadBytes: stats.rawPayloadBytes,
      payloadBudgetBytes: ORCHESTRATION_REPLAY_PAYLOAD_BUDGET_BYTES,
    });
    return false;
  }
  return true;
});

const subscribeOrchestrationV2Thread = Effect.fn("ws.orchestrationV2.subscribeThread")(
  function* (input: {
    readonly threadId: ThreadId;
    readonly afterSequence?: number;
    readonly requestCompletionMarker?: boolean;
    readonly acceptBoundedSnapshot?: boolean;
    readonly acceptCompactTurnItems?: boolean;
  }) {
    const threadManagement = yield* ThreadManagementService.ThreadManagementService;
    const applicationEvents = yield* OrchestrationEventStore.OrchestrationEventStore;

    yield* Effect.annotateCurrentSpan({
      "orchestration_v2.thread_id": input.threadId,
    });
    yield* threadManagement.ensureLegacyTranscript(input.threadId).pipe(
      Effect.mapError(
        (cause) =>
          new OrchestrationV2GetThreadProjectionError({
            threadId: input.threadId,
            message: `Failed to hydrate migrated thread ${input.threadId}`,
            cause,
          }),
      ),
    );

    const eventStreamFrom = (afterSequence: number) =>
      threadManagement
        .streamStoredEventsFrom({
          threadId: input.threadId,
          afterSequence,
        })
        .pipe(
          Stream.map((stored) => ({
            kind: "event" as const,
            sequence: stored.sequence,
            event: projectDomainEventForWire(stored.event),
          })),
          coalesceThreadLiveStream,
          Stream.mapError(
            (cause) =>
              new OrchestrationV2GetThreadProjectionError({
                threadId: input.threadId,
                message: `Failed while streaming orchestration V2 thread ${input.threadId}`,
                cause,
              }),
          ),
        );

    const loadReplayThrough = (afterSequence: number, throughSequence: number) =>
      applicationEvents
        .readAgentEvents({
          threadId: input.threadId,
          afterSequence,
          throughSequence,
          limit: THREAD_RESUME_MAX_REPLAY_EVENTS + 1,
          // A row a newer build wrote (e.g. after a downgrade) must not fail
          // every resubscribe. The live tail resumes from `highWater`, so a
          // dropped row never hides later events.
          skipUnknownEventTypes: true,
        })
        .pipe(
          Stream.map((stored) => ({
            kind: "event" as const,
            sequence: stored.sequence,
            event: projectDomainEventForWire(stored.event),
          })),
          Stream.runCollect,
          Effect.map((items) => Array.from(items)),
          Effect.mapError(
            (cause) =>
              new OrchestrationV2GetThreadProjectionError({
                threadId: input.threadId,
                message: `Failed while replaying orchestration V2 thread ${input.threadId}`,
                cause,
              }),
          ),
        );

    const completionMarker =
      input.requestCompletionMarker === true
        ? Stream.make({ kind: "synchronized" as const })
        : Stream.empty;

    const snapshotThenLive = Effect.fn("ws.orchestrationV2.threadSnapshotThenLive")(function* () {
      const useBoundedSnapshot = shouldUseBoundedThreadSnapshot(input);
      const snapshot = yield* (
        useBoundedSnapshot
          ? threadManagement.getThreadSnapshotWindow(input.threadId, {
              rowLimit: THREAD_HISTORY_SNAPSHOT_ROW_LIMIT,
              userTurnLimit: THREAD_HISTORY_PAGE_POLICY.maxUserTurns,
            })
          : threadManagement.getThreadSnapshot(input.threadId)
      ).pipe(
        Effect.mapError(
          (cause) =>
            new OrchestrationV2GetThreadProjectionError({
              threadId: input.threadId,
              message: `Failed to load orchestration V2 thread ${input.threadId}`,
              cause,
            }),
        ),
      );
      const { snapshotSequence } = snapshot;
      const snapshotItem = useBoundedSnapshot
        ? buildBoundedThreadStreamSnapshot({
            ...snapshot,
            compactTurnItems: input.acceptCompactTurnItems === true,
          })
        : {
            kind: "snapshot" as const,
            snapshotSequence,
            projection: projectThreadProjectionForWire(snapshot.projection),
          };
      return Stream.concat(
        Stream.concat(rpcInitialItems([snapshotItem]), completionMarker),
        eventStreamFrom(snapshotSequence),
      );
    });

    // The event sink subscribes to live events before reading the persisted
    // tail, so no event published during the replay window is lost; overlapping
    // events are deduped by sequence on the client.
    if (input.afterSequence !== undefined) {
      const highWater = yield* applicationEvents.latestAgentSequence(input.threadId).pipe(
        Effect.mapError(
          (cause) =>
            new OrchestrationV2GetThreadProjectionError({
              threadId: input.threadId,
              message: `Failed to prepare orchestration V2 thread ${input.threadId} replay`,
              cause,
            }),
        ),
      );
      if (input.afterSequence > highWater) {
        return yield* snapshotThenLive();
      }
      const stats = yield* applicationEvents
        .getAgentReplayStats({
          threadId: input.threadId,
          afterSequence: input.afterSequence,
          throughSequence: highWater,
          maxEvents: THREAD_RESUME_MAX_REPLAY_EVENTS,
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new OrchestrationV2GetThreadProjectionError({
                threadId: input.threadId,
                message: `Failed to measure orchestration V2 thread ${input.threadId} replay`,
                cause,
              }),
          ),
        );
      // Bound stored JSON before decoding, then check projected event
      // size separately. Neither byte count is a bound on process memory.
      if (
        stats.eventCount > THREAD_RESUME_MAX_REPLAY_EVENTS ||
        !isThreadReplayRawPayloadSafe(stats.rawPayloadBytes)
      ) {
        return yield* snapshotThenLive();
      }
      if (stats.hasCreateEvent) {
        const shell = yield* threadManagement.getThreadShell(input.threadId).pipe(
          Effect.mapError(
            (cause) =>
              new OrchestrationV2GetThreadProjectionError({
                threadId: input.threadId,
                message: `Failed to locate recreated orchestration V2 thread ${input.threadId}`,
                cause,
              }),
          ),
        );
        // A retained creation can belong to a thread already deleted.
        // Only replace its bounded replay when a snapshot can exist.
        if (shell !== null) return yield* snapshotThenLive();
      }
      const replay = yield* loadReplayThrough(input.afterSequence, highWater);
      const plan = decideThreadResume({
        afterSequence: input.afterSequence,
        highWater,
        replayEventCount: replay.length,
        replayEncodedBytes: threadReplayEncodedBytes(replay),
      });
      if (plan.mode === "snapshot") {
        return yield* snapshotThenLive();
      }
      return Stream.concat(
        Stream.concat(rpcInitialItems(replay), completionMarker),
        eventStreamFrom(highWater),
      );
    }

    return yield* snapshotThenLive();
  },
);

const subscribeOrchestrationV2Shell = Effect.fn("ws.orchestrationV2.subscribeShell")(
  function* (input: {
    readonly afterSequence?: number;
    readonly requestCompletionMarker?: boolean;
  }) {
    const sql = yield* SqlClient.SqlClient;
    const threadManagement = yield* ThreadManagementService.ThreadManagementService;
    const applicationEvents = yield* OrchestrationEventStore.OrchestrationEventStore;
    const projects = yield* ProjectStore.ProjectStoreV2;
    const projectService = yield* ProjectService.ProjectService;
    const loadSnapshot = Effect.fn("ws.orchestrationV2.loadShellSnapshot")(function* () {
      const base = buildActiveShellSnapshot(
        yield* loadShellSnapshotParts({
          sql,
          readThreads: threadManagement.readShellSnapshot({ location: "active" }),
          listProjects: projects.listShells(),
          latestSequence: applicationEvents.latestApplicationSequence,
        }),
      );

      return {
        snapshot: base,
      };
    });
    const projectItem = Effect.fn("ws.orchestrationV2.projectShellItem")(function* (
      stored: Extract<ShellApplicationEvent, { readonly aggregateKind: "project" }>,
    ) {
      if (stored.type === "project.deleted") {
        return {
          kind: "project.removed" as const,
          sequence: stored.sequence,
          projectId: stored.aggregateId,
        };
      }
      const project = yield* projectService.getShell(stored.aggregateId);
      return Option.match(project, {
        onNone: () => ({
          kind: "project.removed" as const,
          sequence: stored.sequence,
          projectId: stored.aggregateId,
        }),
        onSome: (value) => ({
          kind: "project.updated" as const,
          sequence: stored.sequence,
          project: value,
        }),
      });
    });

    const projectShellItems = Effect.fn("ws.orchestrationV2.projectShellItems")(function* (
      events: ReadonlyArray<ShellApplicationEvent>,
    ) {
      return yield* Effect.forEach(
        coalesceShellApplicationEvents(events),
        (stored) =>
          Effect.gen(function* () {
            if ("aggregateKind" in stored) {
              return yield* projectItem(stored);
            }
            const shell = yield* threadManagement.getThreadShell(stored.event.threadId);
            return shellStreamItemFromThreadShell({ stored, shell });
          }),
        { concurrency: 8 },
      );
    });

    const toShellStream = <E, R>(stream: Stream.Stream<ShellApplicationEvent, E, R>) =>
      stream.pipe(
        Stream.groupedWithin(512, Duration.millis(50)),
        Stream.mapEffect((events) => projectShellItems(Array.from(events))),
        Stream.flatMap(Stream.fromIterable),
        skipUnchangedThreadShells,
      );

    const liveFrom = (afterSequence: number) =>
      bufferShellLiveStream(
        toShellStream(
          applicationEvents.streamProjectedApplicationEvents({
            afterSequence,
            project: toShellApplicationEvent,
          }),
        ),
      );
    const completionMarker =
      input.requestCompletionMarker === true
        ? Stream.make({ kind: "synchronized" as const })
        : Stream.empty;
    const initialSnapshotItems = (loaded: { readonly snapshot: OrchestrationV2ShellSnapshot }) =>
      rpcInitialItems([{ kind: "snapshot" as const, snapshot: loaded.snapshot }]);
    const completionThenLive = (afterSequence: number) =>
      Stream.concat(completionMarker, liveFrom(afterSequence));

    const stream = yield* Effect.gen(function* () {
      if (input.afterSequence === undefined) {
        const loaded = yield* loadSnapshot();
        return Stream.concat(
          initialSnapshotItems(loaded),
          completionThenLive(loaded.snapshot.snapshotSequence),
        );
      }

      const highWater = yield* applicationEvents.latestApplicationSequence;
      if (!(yield* canReplayPersistedRange(input.afterSequence, highWater, SHELL_RESUME_MAX_GAP))) {
        const loaded = yield* loadSnapshot();
        return Stream.concat(
          initialSnapshotItems(loaded),
          completionThenLive(loaded.snapshot.snapshotSequence),
        );
      }
      const replay = toShellStream(
        applicationEvents.readApplicationEvents({
          afterSequence: input.afterSequence,
          throughSequence: highWater,
          // A row a newer build wrote (e.g. after a downgrade) must not fail
          // every shell resubscribe. The live tail below resumes from
          // highWater, so a dropped row never hides later events.
          skipUnknownEventTypes: true,
        }),
      );
      return Stream.concat(Stream.concat(replay, completionMarker), liveFrom(highWater));
    }).pipe(
      Effect.mapError(
        (cause) =>
          new OrchestrationV2GetShellSnapshotError({
            message: "Failed to prepare the application shell stream",
            cause,
          }),
      ),
    );

    return stream.pipe(
      Stream.mapError(
        (cause) =>
          new OrchestrationV2GetShellSnapshotError({
            message: "Failed while streaming the application shell",
            cause,
          }),
      ),
    );
  },
);

const layerWsRpc = (
  currentSession: EnvironmentAuth.AuthenticatedSession,
  clientOrigin: OrchestrationClientOrigin,
  previewAutomationBroker: PreviewAutomationBroker.PreviewAutomationBroker["Service"],
  serverBrowser: ServerBrowser.ServerBrowser["Service"],
) =>
  ServerWsRpcGroup.toLayer(
    Effect.gen(function* () {
      const currentSessionId = currentSession.sessionId;
      const sql = yield* SqlClient.SqlClient;
      const completion = yield* Completion.Completion;
      const completionEvents = yield* EventSink.EventSinkV2;
      const threadManagement = yield* ThreadManagementService.ThreadManagementService;
      const jobs = yield* Jobs.Jobs;
      const clock = yield* OziClock;
      const scheduler = yield* Scheduler;
      const todos = yield* Todos;
      const intakeContext = yield* Effect.context<
        | ThreadManagementService.ThreadManagementService
        | Jobs.Jobs
        | FileSystem.FileSystem
        | ServerConfig.ServerConfig
        | ServerSettings.ServerSettingsService
      >();
      const applicationEvents = yield* OrchestrationEventStore.OrchestrationEventStore;
      const projectStore = yield* ProjectStore.ProjectStoreV2;
      const projectService = yield* ProjectService.ProjectService;
      const eventLoopMonitor = yield* EventLoopMonitor.EventLoopMonitor;
      const threadSearch = yield* ThreadSearch.ThreadSearch;

      const providerSessionsV2 = yield* ProviderSessionManager.ProviderSessionManagerV2;
      const mcpAppRequests = yield* McpAppRequests.McpAppRequests;
      const commandOutputHub = yield* CommandOutputHub.CommandOutputHub;
      const scheduledTasks = yield* ScheduledTasks.ScheduledTaskService;
      const secretRequests = yield* SecretRequests.SecretRequests;
      const usage = yield* UsageService.UsageService;
      const keybindings = yield* Keybindings.Keybindings;
      const environmentTheme = yield* EnvironmentTheme.EnvironmentThemeService;
      const externalLauncher = yield* ExternalLauncher.ExternalLauncher;
      const remoteOpenTargets = yield* RemoteOpenTargets.RemoteOpenTargets;
      const directEndpoints = yield* DirectEndpoints.DirectEndpoints;
      const previewManager = yield* PreviewManager.PreviewManager;
      const portDiscovery = yield* PortScanner.PortDiscovery;
      const providerRegistry = yield* ProviderRegistry.ProviderRegistry;
      const modelManifest = yield* ModelManifest.ModelManifest;
      const providerLatestVersions = yield* ProviderLatestVersions.ProviderLatestVersions;
      const providerInstances = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
      const providerMaintenanceRunner = yield* ProviderMaintenanceRunner.ProviderMaintenanceRunner;
      const providerAuth = yield* ProviderAuthService.ProviderAuthService;
      const providerInstallation = yield* makeProviderInstallation();
      const config = yield* ServerConfig.ServerConfig;
      const lifecycleEvents = yield* ServerLifecycleEvents.ServerLifecycleEvents;
      const databaseStorage = yield* DatabaseStorage.DatabaseStorage;
      const serverSettings = yield* ServerSettings.ServerSettingsService;
      const startup = yield* ServerRuntimeStartup.ServerRuntimeStartup;
      const serverEnvironment = yield* ServerEnvironment.ServerEnvironment;
      const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
      const otlpEndpointCheck = yield* OtlpEndpointCheck.OtlpEndpointCheck;
      const bootstrapCredentials = yield* PairingGrantStore.PairingGrantStore;
      const sessions = yield* SessionStore.SessionStore;
      // A webhook URL starts agent runs, so only sessions that may operate
      // see it; read-only sessions still see the task itself.
      const withVisibleWebhookUrls = (result: ScheduledTaskListResult): ScheduledTaskListResult =>
        currentSession.scopes.includes(AuthOrchestrationOperateScope)
          ? result
          : {
              tasks: result.tasks.map(({ webhook: _webhook, ...task }) => task),
            };

      const loadAuthAccessSnapshot = () =>
        Effect.all({
          pairingLinks: serverAuth.listPairingLinks(),
          clientSessions: serverAuth.listClientSessions(currentSessionId),
        }).pipe(
          Effect.mapError(
            (error) =>
              new AuthAccessStreamError({
                message: error.message,
              }),
          ),
        );

      const loadServerConfig = Effect.fn("ws.loadServerConfig")(function* () {
        const keybindingsConfig = yield* keybindings.loadConfigState;
        const providers = yield* providerRegistry.getProviders;
        const settings = ServerSettings.redactServerSettingsForClient(
          yield* serverSettings.getSettings,
        );
        const environment = yield* serverEnvironment.getDescriptor;
        const auth = yield* serverAuth.getDescriptor();
        const lastEventLoopStall = yield* eventLoopMonitor.latestNoticeableStall;
        const editorConfig = yield* resolveEditorConfig(
          yield* resolveAvailableEditorsForConfig(externalLauncher.resolveAvailableEditors()),
          resolveFileManagerRevealKindForConfig(externalLauncher.resolveFileManagerRevealKind()),
        );

        return {
          environment,
          auth,
          cwd: config.cwd,
          keybindingsConfigPath: config.keybindingsConfigPath,
          keybindings: keybindingsConfig.keybindings,
          issues: keybindingsConfig.issues,
          providers,
          ...editorConfig,
          remoteOpenTargets: yield* resolveAvailableEditorsForConfig(
            remoteOpenTargets.resolveTargets(),
          ),
          directEndpoints: yield* resolveAvailableEditorsForConfig(directEndpoints.resolve()),
          observability: {
            logsDirectoryPath: config.logsDir,
            localTracingEnabled: true,
            ...(config.otlpTracesUrl !== undefined ? { otlpTracesUrl: config.otlpTracesUrl } : {}),
            otlpTracesEnabled: config.otlpTracesUrl !== undefined,
            ...(config.otlpMetricsUrl !== undefined
              ? { otlpMetricsUrl: config.otlpMetricsUrl }
              : {}),
            otlpMetricsEnabled: config.otlpMetricsUrl !== undefined,
            ...(config.otlpLogsUrl !== undefined ? { otlpLogsUrl: config.otlpLogsUrl } : {}),
            otlpLogsEnabled: config.otlpLogsUrl !== undefined,
          },
          settings,
          shellResumeCompletionMarker: true,
          threadResumeCompletionMarker: true,
          threadSnapshotPagination: true,
          threadFind: true,
          threadFindProgressive: true,
          ...(lastEventLoopStall === undefined ? {} : { lastEventLoopStall }),
        };
      });

      const getOrchestrationV2ArchivedShellSnapshot = Effect.gen(function* () {
        const { threads, projects, snapshotSequence } = yield* loadShellSnapshotParts({
          sql,
          readThreads: threadManagement.readShellSnapshot({ location: "archive" }),
          listProjects: projectStore.listShells(),
          latestSequence: applicationEvents.latestApplicationSequence,
        });
        return {
          schemaVersion: threads.schemaVersion,
          snapshotSequence,
          projects,
          threads: threads.archivedThreads,
        } as const;
      }).pipe(
        Effect.mapError(
          (cause) =>
            new OrchestrationV2GetShellSnapshotError({
              message: "Failed to load archived thread snapshot",
              cause,
            }),
        ),
      );

      const subscribeOrchestrationV2ArchivedShell = Effect.fn(
        "ws.orchestrationV2.subscribeArchivedShell",
      )(function* () {
        const snapshot = yield* getOrchestrationV2ArchivedShellSnapshot;
        const live = threadManagement
          .streamStoredEventsFrom({ afterSequence: snapshot.snapshotSequence })
          .pipe(
            Stream.groupedWithin(512, Duration.millis(50)),
            Stream.mapEffect((events) =>
              Effect.forEach(
                coalesceStoredThreadEvents(Array.from(events)),
                (stored) =>
                  threadManagement
                    .getThreadShell(stored.event.threadId)
                    .pipe(
                      Effect.map((shell) =>
                        archivedShellStreamItemFromThreadShell({ stored, shell }),
                      ),
                    ),
                { concurrency: 8 },
              ),
            ),
            Stream.flatMap(Stream.fromIterable),
            Stream.filterMap((item) => (item === null ? Result.failVoid : Result.succeed(item))),
            (stream) => bufferLiveStream(stream),
            Stream.mapError(
              (cause) =>
                new OrchestrationV2GetShellSnapshotError({
                  message: "Failed while streaming archived threads",
                  cause,
                }),
            ),
          );
        return Stream.concat(rpcInitialItems([{ kind: "snapshot" as const, snapshot }]), live);
      });

      const handlers = ServerWsRpcGroup.of({
        [ORCHESTRATION_V2_WS_METHODS.dispatchCommand]: (command) =>
          Effect.annotateCurrentSpan({
            "orchestration_v2.command_id": command.commandId,
            "orchestration_v2.command_type": command.type,
            "orchestration_v2.thread_id":
              command.type === "thread.fork" || command.type === "thread.merge_back"
                ? command.targetThreadId
                : command.type === "delegated_task.request" ||
                    command.type === "delegated_task.wake-policy" ||
                    command.type === "delegated_task.completion-delivery.acknowledge" ||
                    command.type === "delegated_task.completion-delivery.dispose" ||
                    command.type === "thread.created.record"
                  ? command.parentThreadId
                  : command.threadId,
            ...(command.type === "thread.fork" || command.type === "thread.merge_back"
              ? { "orchestration_v2.source_thread_id": command.sourceThreadId }
              : {}),
          }).pipe(
            Effect.andThen(
              startup
                .enqueueCommand(
                  ThreadMessageIntake.dispatchCommand(
                    ThreadManagementService.withCreationProvenance(command, {
                      createdBy: "user",
                      creationSource: "creationSource" in command ? command.creationSource : "web",
                    }),
                  ).pipe(Effect.provide(intakeContext)),
                )
                .pipe(
                  Effect.map((result) => ({ sequence: result.sequence })),
                  Effect.mapError((cause) => {
                    const detail = userFacingDispatchErrorMessage(cause);
                    return new OrchestrationV2DispatchCommandError({
                      commandId: command.commandId,
                      commandType: command.type,
                      message: detail ?? "Failed to dispatch orchestration V2 command",
                      ...(detail === undefined ? {} : { detail }),
                      cause,
                    });
                  }),
                ),
            ),
          ),
        [OZI_WS_METHODS.checksList]: (input) =>
          completion
            .list(input.threadId)
            .pipe(Effect.mapError((cause) => new OziCheckError({ detail: cause.operation }))),
        [OZI_WS_METHODS.checksSubscribe]: (input) =>
          Stream.unwrap(
            Effect.gen(function* () {
              const afterSequence = yield* completionEvents.latestSequence();
              const initial = yield* completion.list(input.threadId);
              return Stream.concat(
                Stream.succeed(initial),
                completionEvents.stream({ afterSequence }).pipe(
                  Stream.filter(
                    (stored) =>
                      (stored.event.type === "completion.updated" ||
                        stored.event.type === "completion.source-captured" ||
                        stored.event.type === "run.updated") &&
                      (!input.threadId || stored.event.threadId === input.threadId),
                  ),
                  Stream.mapEffect(() => completion.list(input.threadId)),
                ),
              );
            }),
          ).pipe(Stream.mapError((cause) => new OziCheckError({ detail: String(cause) }))),
        [ORCHESTRATION_V2_WS_METHODS.stopWorkflow]: (input) => threadManagement.stopWorkflow(input),
        [ORCHESTRATION_V2_WS_METHODS.getWorkflowScript]: (input) =>
          readWorkflowScript({ scriptPath: input.scriptPath }),
        [ORCHESTRATION_V2_WS_METHODS.getTurnItem]: (input) =>
          threadManagement.getTurnItem(input).pipe(
            Effect.mapError(
              (cause) =>
                new OrchestrationV2GetThreadProjectionError({
                  threadId: input.threadId,
                  message: "Failed to load turn item",
                  cause,
                }),
            ),
          ),
        [ORCHESTRATION_V2_WS_METHODS.searchThread]: (input) =>
          threadManagement
            .searchThread(input)
            .pipe(Effect.mapError((cause) => new OrchestrationV2SearchThreadError({ cause }))),
        [ORCHESTRATION_V2_WS_METHODS.searchThreadStream]: (input) =>
          threadManagement
            .searchThreadStream(input)
            .pipe(Stream.mapError((cause) => new OrchestrationV2SearchThreadError({ cause }))),
        [ORCHESTRATION_V2_WS_METHODS.searchThreads]: (input) =>
          threadSearch.search(input).pipe(
            Effect.mapError(
              (cause) =>
                new OrchestrationSearchThreadsError({
                  message: "Failed to search threads",
                  cause,
                }),
            ),
          ),
        [ORCHESTRATION_V2_WS_METHODS.getArchivedShellSnapshot]: (_input) =>
          getOrchestrationV2ArchivedShellSnapshot,
        [ORCHESTRATION_V2_WS_METHODS.getThreadProjection]: (input) =>
          Effect.annotateCurrentSpan({ "orchestration_v2.thread_id": input.threadId }).pipe(
            Effect.andThen(
              // Pre-pagination clients still call this compatibility endpoint.
              // Keep stale clients from materializing an unbounded transcript.
              threadManagement
                .getThreadSnapshotWindow(input.threadId, {
                  rowLimit: THREAD_HISTORY_SNAPSHOT_ROW_LIMIT,
                })
                .pipe(
                  Effect.map((snapshot) =>
                    projectThreadProjectionForWire(
                      buildBoundedThreadProjection({
                        projection: snapshot.projection,
                        snapshotSequence: snapshot.snapshotSequence,
                      }).projection,
                    ),
                  ),
                  Effect.mapError(
                    (cause) =>
                      new OrchestrationV2GetThreadProjectionError({
                        threadId: input.threadId,
                        message: `Failed to load orchestration V2 thread ${input.threadId}`,
                        cause,
                      }),
                  ),
                ),
            ),
          ),
        [ORCHESTRATION_V2_WS_METHODS.subscribeArchivedShell]: (_input) =>
          Stream.unwrap(subscribeOrchestrationV2ArchivedShell()),
        [ORCHESTRATION_V2_WS_METHODS.subscribeShell]: (input) =>
          Stream.unwrap(subscribeOrchestrationV2Shell(input)),
        [OZI_WS_METHODS.clockAdvance]: Effect.fn("ozi.clock.advance")(function* ({ milliseconds }) {
          const now = yield* clock.advance(milliseconds);
          yield* scheduler.tick;
          return { now };
        }),
        [OZI_WS_METHODS.todosGet]: () => todos.fetch,
        [OZI_WS_METHODS.jobsGet]: () => jobs.cards(),
        [OZI_WS_METHODS.jobsSubscribe]: () => jobs.subscribe(),
        [OZI_WS_METHODS.jobsHandle]: (input) => jobs.handle(input),
        [ORCHESTRATION_V2_WS_METHODS.subscribeThread]: (input) =>
          Stream.unwrap(
            Effect.annotateCurrentSpan({ "orchestration_v2.thread_id": input.threadId }).pipe(
              Effect.andThen(subscribeOrchestrationV2Thread(input)),
            ),
          ),
        [ORCHESTRATION_V2_WS_METHODS.subscribeCommandOutput]: (input) =>
          Stream.unwrap(
            Effect.annotateCurrentSpan({ "orchestration_v2.thread_id": input.threadId }).pipe(
              Effect.as(commandOutputHub.subscribe(input)),
            ),
          ),
        [WS_METHODS.scheduledTasksList]: (_input) =>
          scheduledTasks.list().pipe(Effect.map(withVisibleWebhookUrls)),
        [WS_METHODS.scheduledTasksSubscribe]: (_input) =>
          scheduledTasks.subscribeList().pipe(Stream.map(withVisibleWebhookUrls)),
        [WS_METHODS.scheduledTasksUpsert]: (input) => scheduledTasks.upsert(input),
        [WS_METHODS.scheduledTasksSetEnabled]: (input) =>
          Effect.annotateCurrentSpan({ "scheduled_task.id": input.id }).pipe(
            Effect.andThen(scheduledTasks.setEnabled(input)),
          ),
        [WS_METHODS.scheduledTasksDelete]: (input) =>
          Effect.annotateCurrentSpan({ "scheduled_task.id": input.id }).pipe(
            Effect.andThen(scheduledTasks.delete(input)),
          ),
        [WS_METHODS.scheduledTasksRunNow]: (input) =>
          Effect.annotateCurrentSpan({ "scheduled_task.id": input.id }).pipe(
            Effect.andThen(scheduledTasks.runNow(input)),
          ),
        [WS_METHODS.scheduledTasksRotateWebhookToken]: (input) =>
          Effect.annotateCurrentSpan({ "scheduled_task.id": input.id }).pipe(
            Effect.andThen(scheduledTasks.rotateWebhookToken(input)),
          ),
        [WS_METHODS.secretsAnswerRequest]: (input) =>
          Effect.annotateCurrentSpan({ "orchestration_v2.thread_id": input.threadId }).pipe(
            Effect.andThen(secretRequests.answer(input)),
          ),
        [WS_METHODS.scheduledTasksListWebhookDeliveries]: (input) =>
          Effect.annotateCurrentSpan({ "scheduled_task.id": input.id }).pipe(
            Effect.andThen(scheduledTasks.listWebhookDeliveries(input)),
          ),
        [WS_METHODS.scheduledTasksGetWebhookDelivery]: (input) =>
          Effect.annotateCurrentSpan({ "scheduled_task.id": input.id }).pipe(
            Effect.andThen(scheduledTasks.getWebhookDelivery(input)),
          ),
        [WS_METHODS.serverProbe]: (_input) => Effect.succeed({}),
        [WS_METHODS.serverGetConfig]: (_input) => loadServerConfig(),
        [WS_METHODS.serverRefreshProviders]:
          /* Request instrumentation already owns the span; keep this helper in that context. */
          Effect.fnUntraced(function* (input) {
            if (input.refreshModels) {
              yield* modelManifest.forceRefresh;
              const instances = yield* providerInstances.listInstances;
              yield* Effect.forEach(
                instances.filter(
                  (instance) =>
                    input.instanceId === undefined || input.instanceId === instance.instanceId,
                ),
                (instance) =>
                  Effect.gen(function* () {
                    yield* instance.invalidateCaches ?? Effect.void;
                    const maintenance = yield* instance.snapshot.resolveMaintenance({
                      fresh:
                        input.instanceId !== undefined &&
                        input.cwd !== undefined &&
                        input.fresh !== true,
                    });
                    yield* Effect.forEach(
                      latestProviderVersionCacheKeys(maintenance),
                      providerLatestVersions.invalidate,
                      { discard: true },
                    );
                  }),
                { concurrency: "unbounded", discard: true },
              );
            }
            let providers = yield* input.cwd !== undefined && input.instanceId !== undefined
              ? providerRegistry.refreshWorkspaceSnapshot({
                  instanceId: input.instanceId,
                  cwd: input.cwd,
                  fresh: input.fresh === true,
                })
              : input.instanceId !== undefined
                ? providerRegistry.refreshInstance(input.instanceId)
                : providerRegistry.refresh();
            if (input.refreshModels) {
              const instances = yield* providerInstances.listInstances;
              for (const instance of instances) {
                if (
                  !instance.refreshModels ||
                  (input.instanceId !== undefined && input.instanceId !== instance.instanceId) ||
                  !providers.some(
                    (provider) =>
                      provider.instanceId === instance.instanceId &&
                      provider.enabled &&
                      provider.installed,
                  )
                )
                  continue;
                yield* instance.refreshModels().pipe(
                  Effect.mapError(
                    (error) =>
                      new ProviderSetupError({
                        instanceId: instance.instanceId,
                        operation: "refresh-models",
                        detail: error.detail,
                      }),
                  ),
                );
                providers = yield* providerRegistry.refreshInstance(instance.instanceId);
              }
            }
            return { providers };
          }),
        [WS_METHODS.mcpAppsCallTool]: (input) => mcpAppRequests.callTool(input),
        [WS_METHODS.mcpAppsToolInfo]: (input) => mcpAppRequests.toolInfo(input),
        [WS_METHODS.mcpAppsUpdateModelContext]: (input) => mcpAppRequests.updateModelContext(input),
        [WS_METHODS.mcpAppsReadResource]: (input) => mcpAppRequests.readResource(input),
        [WS_METHODS.providerUploadFeedback]:
          /* Request instrumentation already owns the span; keep this helper in that context. */
          Effect.fnUntraced(
            function* (input) {
              const projection = yield* threadManagement.getThreadRecords(input.threadId, [
                "providerThreads",
              ]);
              const providerThread =
                projection.providerThreads.find(
                  (candidate) => candidate.id === projection.thread.activeProviderThreadId,
                ) ?? projection.providerThreads.at(-1);
              const providerSessionId = providerThread?.providerSessionId ?? null;
              if (providerThread === undefined || providerSessionId === null) {
                return yield* Effect.fail(
                  new ProviderUploadFeedbackError({
                    threadId: input.threadId,
                    cause: "No provider session has run in this thread yet.",
                  }),
                );
              }
              const runtime = Option.getOrNull(yield* providerSessionsV2.get(providerSessionId));
              if (runtime === null) {
                return yield* Effect.fail(
                  new ProviderUploadFeedbackError({
                    threadId: input.threadId,
                    cause: "The provider session is no longer running. Send a message first.",
                  }),
                );
              }
              if (runtime.uploadFeedback === undefined) {
                return yield* Effect.fail(
                  new ProviderUploadFeedbackError({
                    threadId: input.threadId,
                    cause: `Provider '${runtime.driver}' does not support feedback uploads.`,
                  }),
                );
              }
              return yield* runtime.uploadFeedback({
                providerThread,
                ...(input.reason === undefined ? {} : { reason: input.reason }),
              });
            },
            (effect, input) =>
              effect.pipe(
                Effect.mapError((cause) =>
                  isProviderUploadFeedbackError(cause)
                    ? cause
                    : new ProviderUploadFeedbackError({
                        threadId: input.threadId,
                        cause,
                      }),
                ),
              ),
          ),
        [WS_METHODS.serverUpdateProvider]: (input) =>
          providerMaintenanceRunner.updateProvider(input),
        [WS_METHODS.providerConsumeResetCredit]:
          /* Request instrumentation already owns the span; keep this helper in that context. */
          Effect.fnUntraced(function* (input) {
            const instance = yield* providerInstances.getInstance(input.instanceId);
            if (instance === undefined || !instance.enabled) {
              return yield* new ProviderSetupError({
                instanceId: input.instanceId,
                operation: "consume-reset-credit",
                detail: instance ? "This provider is disabled." : "Provider instance not found.",
              });
            }
            if (instance.consumeResetCredit === undefined) {
              return yield* new ProviderSetupError({
                instanceId: input.instanceId,
                operation: "consume-reset-credit",
                detail: "This provider does not bank reset credits.",
              });
            }
            const outcome = yield* instance.consumeResetCredit().pipe(
              Effect.mapError(
                (error) =>
                  new ProviderSetupError({
                    instanceId: input.instanceId,
                    operation: "consume-reset-credit",
                    detail: error.detail,
                    cause: error,
                  }),
              ),
            );
            return { outcome };
          }),
        [WS_METHODS.providerAuthStart]: (input) => providerAuth.start(input, currentSessionId),
        [WS_METHODS.providerAuthRespond]: (input) =>
          Effect.annotateCurrentSpan({ instanceId: input.instanceId }).pipe(
            Effect.andThen(providerAuth.respond(input, currentSessionId)),
          ),
        [WS_METHODS.providerAuthComplete]: (input) =>
          providerAuth.complete(input, currentSessionId),
        [WS_METHODS.chatGptReconnectProfile]: (input) => providerAuth.reconnectProfile(input),
        [WS_METHODS.chatGptImportProfile]: (input) => providerAuth.importProfile(input),
        [WS_METHODS.chatGptHandoffSubscribe]: (input) =>
          subscribeChatGptHandoff(input, currentSessionId),
        [WS_METHODS.codexAuthCallbackSubscribe]: (input) => subscribeCodexAuthCallback(input),
        [WS_METHODS.providerAuthCancel]: (input) => providerAuth.cancel(input, currentSessionId),
        [WS_METHODS.providerAuthLogout]: (input) => providerAuth.logout(input),
        [WS_METHODS.providerAuthSubscribe]: (input) =>
          providerAuth.subscribe(input, currentSessionId),
        [WS_METHODS.providerInstallStart]: (input) => providerInstallation.start(input),
        [WS_METHODS.providerInstallCancel]: (input) => providerInstallation.cancel(input),
        [WS_METHODS.providerInstallSubscribe]: (input) => providerInstallation.subscribe(input),
        [WS_METHODS.providerInstallRemove]: (input) => providerInstallation.remove(input),
        [WS_METHODS.serverUpsertKeybinding]:
          /* Request instrumentation already owns the span; keep this helper in that context. */
          Effect.fnUntraced(function* (rule) {
            const keybindingsConfig = yield* keybindings.upsertKeybindingRule(rule);
            return { keybindings: keybindingsConfig, issues: [] };
          }),
        [WS_METHODS.serverRemoveKeybinding]:
          /* Request instrumentation already owns the span; keep this helper in that context. */
          Effect.fnUntraced(function* (rule) {
            const keybindingsConfig = yield* keybindings.removeKeybindingRule(rule);
            return { keybindings: keybindingsConfig, issues: [] };
          }),
        [WS_METHODS.serverGetDatabaseStorage]: () => databaseStorage.status,
        [WS_METHODS.serverGetSettings]: (_input) =>
          serverSettings.getSettings.pipe(Effect.map(ServerSettings.redactServerSettingsForClient)),
        [WS_METHODS.serverUpdateSettings]:
          /* Request instrumentation already owns the span; keep this helper in that context. */
          Effect.fnUntraced(function* ({ patch, providerInstanceMutation }) {
            const settings = yield* providerInstanceMutation === undefined
              ? serverSettings.updateSettings(patch)
              : serverSettings.updateProviderInstance(providerInstanceMutation, patch);
            return ServerSettings.redactServerSettingsForClient(settings);
          }),
        [WS_METHODS.serverGetTraceDiagnostics]: (_input) =>
          TraceDiagnostics.readTraceDiagnostics({
            traceFilePath: config.serverTracePath,
            maxFiles: config.traceMaxFiles,
          }),
        [WS_METHODS.serverGetUsageSummary]: (input) => usage.readSummary(input),
        [WS_METHODS.serverRefreshUsageRates]: (_input) => usage.refreshRates,
        [WS_METHODS.serverCheckOtlpEndpoint]: (input) => otlpEndpointCheck.check(input),
        [WS_METHODS.shellOpenInEditor]: (input) => externalLauncher.launchEditor(input),
        [WS_METHODS.attachmentsCreateUploadUrl]: (input) => issueAttachmentUploadUrl(input),
        [WS_METHODS.attachmentsDelete]: (input) => deletePendingAttachment(input.attachmentId),
        [WS_METHODS.assetsCreateUrl]:
          /* Request instrumentation already owns the span; keep this helper in that context. */
          Effect.fnUntraced(function* (input) {
            const path = yield* Path.Path;
            if (
              input.resource._tag === "attachment" ||
              input.resource._tag === "native-app-icon" ||
              input.resource._tag === "tool-output-image" ||
              (input.resource._tag === "media-file" && path.isAbsolute(input.resource.path))
            ) {
              return yield* issueAssetUrl({ resource: input.resource });
            }
            if (input.resource._tag === "draft-workspace-file") {
              return yield* issueAssetUrl({
                resource: input.resource,
                workspaceRoot: input.resource.cwd,
              });
            }
            const thread = yield* threadManagement
              .getThreadRecords(input.resource.threadId, [])
              .pipe(
                Effect.mapError(
                  (cause) =>
                    new AssetWorkspaceContextResolutionError({
                      resource: input.resource,
                      cause,
                    }),
                ),
              );
            const project = yield* projectService.getById(thread.thread.projectId).pipe(
              Effect.mapError(
                (cause) =>
                  new AssetWorkspaceContextResolutionError({
                    resource: input.resource,
                    cause,
                  }),
              ),
            );
            if (Option.isNone(project)) {
              return yield* new AssetWorkspaceContextNotFoundError({
                resource: input.resource,
              });
            }
            return yield* issueAssetUrl({
              resource: input.resource,
              workspaceRoot: thread.thread.worktreePath ?? project.value.workspaceRoot,
            });
          }),
        [WS_METHODS.assetsPersistChatAttachments]: (input) =>
          persistChatAttachments(input).pipe(Effect.map((attachments) => ({ attachments }))),
        [WS_METHODS.previewOpen]: (input) => previewManager.open(input),
        [WS_METHODS.previewNavigate]: (input) => previewManager.navigate(input),
        [WS_METHODS.previewResize]: (input) => previewManager.resize(input),
        [WS_METHODS.previewAdjust]: (input) => previewManager.adjust(input),
        [WS_METHODS.previewRefresh]: (input) => previewManager.refresh(input),
        [WS_METHODS.previewClose]: (input) => previewManager.close(input),
        [WS_METHODS.previewList]: (input) => previewManager.list(input),
        [WS_METHODS.previewClearProfile]: (input) => serverBrowser.clearProfile(input.profileId),
        [WS_METHODS.previewReportProfiles]: (input) => serverBrowser.reportProfiles(input),
        [WS_METHODS.previewReportStatus]: (input) => previewManager.reportStatus(input),
        [WS_METHODS.subscribePreviewEvents]: (_input) => previewManager.events,
        [WS_METHODS.subscribeDiscoveredLocalServers]: (input) =>
          Stream.callback<DiscoveredLocalServerList>((queue) =>
            Effect.gen(function* () {
              const configuredUrls = input.configuredUrls ?? [];
              yield* portDiscovery.retain;
              const initial = yield* portDiscovery.scan(configuredUrls);
              const initialScannedAt = DateTime.formatIso(yield* DateTime.now);
              yield* Queue.offer(queue, {
                servers: initial,
                scannedAt: initialScannedAt,
                configuredUrlProbing: true,
              });
              yield* portDiscovery.subscribe(
                { configuredUrls, initialSnapshot: initial },
                (servers) =>
                  Effect.gen(function* () {
                    const scannedAt = DateTime.formatIso(yield* DateTime.now);
                    yield* Queue.offer(queue, {
                      servers,
                      scannedAt,
                      configuredUrlProbing: true,
                    });
                  }),
              );
            }),
          ),
        [WS_METHODS.subscribeServerConfig]: (input) =>
          Stream.unwrap(
            Effect.gen(function* () {
              // Buffer changes through discovery and the initial snapshot's RPC ACK wait.
              const keybindingsChanges = yield* keybindings.subscribeChanges;
              const settingsChanges = yield* serverSettings.subscribeChanges;
              const config = yield* loadServerConfig();
              const keybindingsUpdates = keybindingsChanges.pipe(
                Stream.map((event) => ({
                  version: 1 as const,
                  type: "keybindingsUpdated" as const,
                  payload: {
                    keybindings: event.keybindings,
                    issues: event.issues,
                  },
                })),
              );
              const providerStatuses = Stream.concat(
                Stream.fromEffect(providerRegistry.getProviders),
                providerRegistry.streamChanges,
              ).pipe(
                // Both sides replay their current value, so the first pairing normally
                // repeats the snapshot the client already holds. Compare against that
                // snapshot rather than dropping blindly: a refresh that landed between
                // the snapshot and the subscription still goes out.
                (updates) => Stream.concat(rpcInitialItems([config.providers]), updates),
                Stream.changesWith(
                  (previous, next) => JSON.stringify(previous) === JSON.stringify(next),
                ),
                Stream.drop(1),
                Stream.map((providers) => ({
                  version: 1 as const,
                  type: "providerStatuses" as const,
                  payload: { providers },
                })),
                Stream.debounce(Duration.millis(PROVIDER_STATUS_DEBOUNCE_MS)),
              );
              // Gated on the subscriber's capability flag because an
              // already-shipped client decodes this stream against the old
              // event union and its whole config subscription dies on an
              // unknown member.
              const environmentThemeUpdates =
                input.environmentThemes === true
                  ? environmentTheme.streamChanges.pipe(
                      Stream.map((themes) => ({
                        version: 1 as const,
                        type: "environmentThemesUpdated" as const,
                        payload: { themes },
                      })),
                    )
                  : Stream.empty;
              const settingsUpdates = settingsChanges.pipe(
                Stream.map((settings) => ServerSettings.redactServerSettingsForClient(settings)),
                Stream.map((settings) => ({
                  version: 1 as const,
                  type: "settingsUpdated" as const,
                  payload: { settings },
                })),
              );

              const liveUpdates = Stream.merge(
                keybindingsUpdates,
                Stream.merge(
                  providerStatuses,
                  Stream.merge(settingsUpdates, environmentThemeUpdates),
                ),
              );

              return Stream.concat(
                rpcInitialItems([{ version: 1 as const, type: "snapshot" as const, config }]),
                withLateEditorConfig(config, liveUpdates, externalLauncher),
              );
            }),
          ),
        [WS_METHODS.subscribeServerLifecycle]: (_input) =>
          Stream.unwrap(
            Effect.gen(function* () {
              const liveBuffer = yield* Queue.unbounded<ServerLifecycleStreamEvent>();
              yield* Effect.forkScoped(
                lifecycleEvents.stream.pipe(
                  Stream.runForEach((event) => Queue.offer(liveBuffer, event)),
                ),
                { startImmediately: true },
              );
              const snapshot = yield* lifecycleEvents.snapshot;
              const snapshotEvents = Array.from(snapshot.events).toSorted(
                (left, right) => left.sequence - right.sequence,
              );
              const liveEvents = Stream.fromQueue(liveBuffer).pipe(
                Stream.filter((event) => event.sequence > snapshot.sequence),
              );
              return Stream.concat(rpcInitialItems(snapshotEvents), liveEvents);
            }),
          ),
        [WS_METHODS.subscribeAuthAccess]: (_input) =>
          Stream.unwrap(
            Effect.gen(function* () {
              const initialSnapshot = yield* loadAuthAccessSnapshot();
              const revisionRef = yield* Ref.make(1);
              const accessChanges: Stream.Stream<
                PairingGrantStore.BootstrapCredentialChange | SessionStore.SessionCredentialChange
              > = Stream.merge(bootstrapCredentials.streamChanges, sessions.streamChanges);

              const liveEvents: Stream.Stream<AuthAccessStreamEvent> = accessChanges.pipe(
                Stream.mapEffect((change) =>
                  Ref.updateAndGet(revisionRef, (revision) => revision + 1).pipe(
                    Effect.map((revision) =>
                      toAuthAccessStreamEvent(change, revision, currentSessionId),
                    ),
                  ),
                ),
              );

              return Stream.concat(
                rpcInitialItems([
                  {
                    version: 1 as const,
                    revision: 1,
                    type: "snapshot" as const,
                    payload: initialSnapshot,
                  },
                ]),
                liveEvents,
              );
            }),
          ),
      });
      return handlers;
    }),
  );

// RpcServer's default sends a socket-level Defect frame instead, and the client
// ends every pending request on the socket with it.
const WS_RPC_SERVER_OPTIONS = {
  disableTracing: true,
  disableFatalDefects: true,
} as const;

export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const previewAutomationBroker = yield* PreviewAutomationBroker.PreviewAutomationBroker;
    const serverBrowser = yield* ServerBrowser.ServerBrowser;
    const sql = yield* SqlClient.SqlClient;
    return HttpRouter.add(
      "GET",
      "/ws",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const requestUrl = HttpServerRequest.toURL(request);
        if (Option.isNone(requestUrl) || !hasCompatibleOrchestrationProtocol(requestUrl.value)) {
          return HttpServerResponse.jsonUnsafe(
            {
              code: "orchestration_protocol_incompatible",
              message: `Update this client to one that supports orchestration protocol ${ORCHESTRATION_PROTOCOL_VERSION}.`,
              orchestrationProtocolVersion: ORCHESTRATION_PROTOCOL_VERSION,
            },
            { status: 426 },
          );
        }
        const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
        const sessions = yield* SessionStore.SessionStore;
        const session = yield* serverAuth.authenticateWebSocketUpgrade(request).pipe(
          Effect.catchIf(EnvironmentAuth.isServerAuthCredentialError, (error) =>
            failEnvironmentAuthInvalid(
              EnvironmentAuth.serverAuthCredentialReason(error),
              EnvironmentAuth.serverAuthDpopFailureReason(error),
            ),
          ),
          Effect.catchIf(EnvironmentAuth.isServerAuthInternalError, (error) =>
            failEnvironmentInternal("internal_error", error),
          ),
        );
        const clientOrigin = readClientConnectionOrigin(request);
        yield* sessions.recordClientConnection(session.sessionId, clientOrigin);
        const rpcWebSocketHttpEffect = yield* Effect.gen(function* () {
          const { protocol, httpEffect } = yield* RpcServer.makeProtocolWithHttpEffectWebsocket;
          yield* RpcServer.make(ServerWsRpcGroup, WS_RPC_SERVER_OPTIONS).pipe(
            Effect.provideService(RpcServer.Protocol, protocol),
            Effect.provide(
              Layer.merge(RpcAuthorization.layer(session.scopes), rpcInstrumentationLayer),
            ),
            Effect.forkScoped,
          );
          // @effect-diagnostics-next-line returnEffectInGen:off
          return httpEffect;
        }).pipe(
          Effect.provide(
            layerWsRpc(session, clientOrigin, previewAutomationBroker, serverBrowser).pipe(
              Layer.provideMerge(RpcSerialization.layerJson),
              // Request fibers run in the handlers' context, so this reporter sees
              // their defects, not the rest of the server's.
              Layer.provide(DefectReporter.layer),
              Layer.provide(Layer.succeed(SqlClient.SqlClient, sql)),
              Layer.provide(ProviderMaintenanceRunner.layer),
              Layer.provide(OtlpEndpointCheck.layer),
            ),
          ),
        );
        return yield* Effect.acquireUseRelease(
          sessions.markConnected(session.sessionId),
          () =>
            Effect.raceFirst(
              rpcWebSocketHttpEffect,
              sessions.awaitInvalidation(session.sessionId).pipe(
                Effect.as(HttpServerResponse.empty()),
                Effect.catchTags({
                  SessionCredentialVerificationError: (error) =>
                    failEnvironmentInternal("internal_error", error),
                }),
              ),
            ),
          () => sessions.markDisconnected(session.sessionId),
        );
      }).pipe(
        Effect.catchTags({
          EnvironmentAuthInvalidError: HttpServerRespondable.toResponse,
          EnvironmentInternalError: HttpServerRespondable.toResponse,
        }),
      ),
    );
  }),
);
