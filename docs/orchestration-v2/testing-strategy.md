# Testing orchestration

Tests live in [`e2e/`](../../e2e) and drive the real server, SQLite, files, git, web client
and `ozi --json`. Only provider transports, the clock and external MCP may be faked.
Native protocol fakes live in `e2e/fakes`; never call real providers in these tests.

Name each test with its [SPEC scenario ID](../../SPEC.md) first. Await state with `ozi wait`.
Run `vp test run --root e2e`, then `node scripts/features.ts check <milestone>`.

M3 covers isolated native forks for all three providers, durable completion checks,
progress evidence, exact card disposition, supersession and real server crash recovery.
The checkpoint-based replay harness and its dependent fixtures are retired.
