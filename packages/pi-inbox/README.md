# Pi inbox

Standalone Pi extension for agents running in Ozi. H3 can bundle `@ozi/pi-inbox` as a Pi package or load its default extension with `--extension`.

The GUI injects the same extension for every Pi instance, including the default Ozi harness. It snapshots native history after `agent_settled` and starts Pi with `--fork`, the current provider, model and thinking level, the same extensions and configuration, and only the four I2 ticket tools. The source session receives no messages or entries. Forks set `OZI_INBOX_FORK=1` and never install the hook.

The GUI supplies `OZI_MCP_URL`, `OZI_MCP_BEARER_TOKEN` and `OZI_PI_INBOX_CONTEXT_FILE`. The last file contains the current GUI run ID; the fork captures it before the main session accepts another turn. The MCP bridge forwards it as `x-ozi-ticket-run-id`, which ticket handlers validate against the authenticated thread, provider and session. Delayed filing and acknowledgement retain the checked turn's provenance.

`ctx.ui.setStatus("ozi-inbox:<id>", JSON.stringify({ status, filed, error? }))` reports `running`, `completed` or `failed`. The GUI renders one quiet work-log step, ending as `Inbox check · n filed` or `Inbox check · failed`. The step never keeps the main run active. A check has a two-minute deadline; shutdown terminates its child process and normal completion removes its temporary native fork.

The extension is self-contained: all runtime imports and constants live inside its default function. The GUI serializes that function into Pi's extension cache, so development and bundled servers use the same implementation without another runtime asset. If H3 also loads the package, the shared Pi event-bus guard prevents installing the hook twice.
