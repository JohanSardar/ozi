import { useWorkerPool } from "@pierre/diffs/react";
import { resolveCodeThemeName } from "~/lib/syntaxHighlighting";
import { WorkerPoolContext } from "@pierre/diffs/react";
import { WorkerPoolManager } from "@pierre/diffs/worker";
import CodeWorker from "@pierre/diffs/worker/worker.js?worker";
import * as Schema from "effect/Schema";
import { useSyncExternalStore, type ReactNode } from "react";
import { getRenderedAppearance, subscribeRenderedAppearance } from "../hooks/useTheme";
import { PREFERRED_HIGHLIGHTER } from "../lib/syntaxHighlighting";

export class CodeWorkerError extends Schema.TaggedError<CodeWorkerError>()("CodeWorkerError", {
  operation: Schema.Literals(["create-worker", "get-render-options", "set-render-options"]),
  themeName: Schema.Literals(["pierre-dark", "t3-light"]),
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Code worker operation ${this.operation} failed for theme ${this.themeName}.`;
  }
}

const CODE_WORKER_IDLE_TTL_MS = 30_000;
function resolveCodeWorkerPoolSize() {
  const cores =
    typeof navigator === "undefined" ? 4 : Math.max(1, navigator.hardwareConcurrency || 4);
  return Math.max(2, Math.min(6, Math.floor(cores / 2)));
}
let sharedWorkerPool:
  | {
      readonly pool: WorkerPoolManager;
      readonly unsubscribeTheme: () => void;
      consumers: number;
      idleTimer: ReturnType<typeof setTimeout> | undefined;
    }
  | undefined;

function applyCodeWorkerTheme(pool: WorkerPoolManager) {
  const themeName = resolveCodeThemeName(getRenderedAppearance());
  let operation: CodeWorkerError["operation"] = "get-render-options";
  void (async () => {
    try {
      const current = pool.getDiffRenderOptions();
      if (current.theme === themeName) return;
      operation = "set-render-options";
      await pool.setRenderOptions({ ...current, theme: themeName });
    } catch (cause) {
      console.error(new CodeWorkerError({ operation, themeName, cause }));
    }
  })();
}

function createCodeWorkerPool(poolSize: number) {
  const themeName = resolveCodeThemeName(getRenderedAppearance());
  const pool = new WorkerPoolManager(
    {
      workerFactory: () => {
        try {
          return new CodeWorker();
        } catch (cause) {
          throw new CodeWorkerError({ operation: "create-worker", themeName, cause });
        }
      },
      poolSize,
      totalASTLRUCacheSize: 240,
    },
    {
      theme: themeName,
      preferredHighlighter: PREFERRED_HIGHLIGHTER,
      tokenizeMaxLineLength: 1_000,
      useTokenTransformer: true,
    },
  );
  return {
    pool,
    unsubscribeTheme: subscribeRenderedAppearance(() => applyCodeWorkerTheme(pool)),
    consumers: 0,
    idleTimer: undefined,
  };
}

function acquireCodeWorkerPool(poolSize: number) {
  const entry = (sharedWorkerPool ??= createCodeWorkerPool(poolSize));
  clearTimeout(entry.idleTimer);
  entry.idleTimer = undefined;
  entry.consumers += 1;
  return entry;
}

function subscribeSharedWorkerPool(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  const entry = acquireCodeWorkerPool(resolveCodeWorkerPoolSize());
  onStoreChange();
  return () => {
    entry.consumers -= 1;
    if (entry.consumers !== 0) return;
    entry.idleTimer = setTimeout(() => {
      entry.idleTimer = undefined;
      entry.unsubscribeTheme();
      entry.pool.terminate();
      if (sharedWorkerPool === entry) sharedWorkerPool = undefined;
    }, CODE_WORKER_IDLE_TTL_MS);
  };
}
function useCodeWorkerPool() {
  return useSyncExternalStore(
    subscribeSharedWorkerPool,
    () => sharedWorkerPool?.pool,
    () => undefined,
  );
}

export function CodeWorkerPoolProvider({ children }: { children?: ReactNode }) {
  const workerPool = useCodeWorkerPool();

  return (
    <WorkerPoolContext value={workerPool}>
      <CodeWorkerReady>{children}</CodeWorkerReady>
    </WorkerPoolContext>
  );
}

const failedPools = new WeakSet<WorkerPoolManager>();
function CodeWorkerReady({ children }: { children?: ReactNode }) {
  const pool = useWorkerPool();
  const subscribe = (changed: () => void) => {
    let active = true;
    if (pool)
      void pool.initialize().then(
        () => {
          if (active) changed();
        },
        () => {
          failedPools.add(pool);
          if (active) changed();
        },
      );
    return () => {
      active = false;
    };
  };
  const snapshot = () =>
    pool
      ? failedPools.has(pool) || pool.isInitialized() || !pool.isWorkingPool()
      : typeof window === "undefined";
  const ready = useSyncExternalStore(subscribe, snapshot, () => true);
  return ready ? (
    children
  ) : (
    <div
      role="status"
      className="flex min-h-0 flex-1 items-center justify-center p-4 text-xs text-muted-foreground"
    >
      Loading code…
    </div>
  );
}
