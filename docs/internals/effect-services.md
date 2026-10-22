# Effect services

Server capabilities live in Effect services under `apps/server/src/`. HTTP, RPC, MCP and CLI handlers decode input, call a service and map its typed errors. Files, git, processes, persistence, retries and rollback belong in the service.

Use one module per service: imports, errors and schemas, `Context.Service` with its interface inline, private construction, then an exported layer. Read dependencies from the Effect environment. Consumers import service modules as namespaces. Extend the service that owns the domain before adding another.

Import Effect modules from subpaths, such as `import * as Effect from "effect/Effect"`. Use `Effect.gen` for inline programs and `Effect.fn("Service.operation")` for reusable operations. Preserve span names. Runtime execution belongs at application boundaries.

Errors are `Schema.TaggedError` classes with bounded attributes and the immediate underlying `cause`. Never copy arbitrary defect text, credentials, payloads or command output into public messages or log attributes. Translate errors at transport boundaries. Catch known tags with `Effect.catchTags`.

Tests run through the real server and `ozi` CLI in `e2e/`. Fake only provider transports, the clock and external MCP. Follow [AGENTS.md](../../AGENTS.md) and keep [SPEC.md](../../SPEC.md) and [features.yaml](../../features.yaml) current.
