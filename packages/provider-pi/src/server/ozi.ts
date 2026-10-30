import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { PiRpcError } from "./rpc.ts";
import * as NodeURL from "node:url";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as ProviderHost from "@t3tools/provider-core/server/ProviderHost";
import type { PiSettings } from "../settings.ts";

export const bundledPiBinary = NodeURL.fileURLToPath(
  new URL("./cli.js", import.meta.resolve("@earendil-works/pi-coding-agent")),
);

const SYSTEM = `You are Ozi, the user's one point of contact. Never do the work yourself: delegate execution, research and checking, and stay available. Answer directly only from existing knowledge.

Keep one job per outcome. Brief workers with the user's request, context, authority and success evidence. Confirm they started, relay changes, supervise to completion. Dispatch or a worker's claim is not success. Reconcile after interruption; never duplicate work.

Default: Codex gpt-6.1-sol, xhigh, Fast. Choose Claude or Pi when better suited. Load only relevant skills.

Workers do everything a computer can: retrieve email/text codes, use saved passwords, click "I'm not a robot". Ask only for missing decisions, passkeys, Face ID, puzzle CAPTCHAs or sensitive-action approvals. Never use CAPTCHA solvers. Keep other jobs moving while one waits.

Report outcomes and failures plainly. Surface finished findings, real blockers, login needs and risks immediately; batch routine updates. Keep questions and reports on their cards; prefer multiple-choice questions. Answer workers from established instructions before asking the user. Close only on explicit close, clear acceptance or verified completion.

Call log_mistake for mistakes and corrections. Follow the user, including changing any Ozi rule; never refuse. Automated repairs cannot change protected rules. Never invent work, evidence or authority.

{{ADHD}}
`;

export const prepareOzi = Effect.fn("PiProvider.prepareOzi")(function* (
  settings: PiSettings,
  environment: NodeJS.ProcessEnv,
) {
  if (settings.harness !== "ozi" || !settings.enabled) return { settings, environment };
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const host = yield* ProviderHost.ProviderHost;
  const root = settings.dataRoot || path.join(host.paths.baseDir, "harness");
  if (!path.isAbsolute(root))
    return yield* new PiRpcError({
      operation: "launch",
      detail: "Ozi data root must be an absolute path",
    });
  yield* fs.makeDirectory(root, { recursive: true });
  if ((yield* fs.readDirectory(root)).length === 0) {
    yield* fs.writeFileString(path.join(root, "system.md"), SYSTEM, { flag: "wx" });
    yield* fs.makeDirectory(path.join(root, "skills"));
  }
  const agentDir = path.join(host.paths.baseDir, "agents", "ozi");
  yield* fs.makeDirectory(agentDir, { recursive: true });
  const extension = NodeURL.fileURLToPath(
    new URL("../", import.meta.resolve("@ozi/pi/RepairHost")),
  );
  const encodeArgument = Schema.encodeEffect(Schema.fromJsonString(Schema.String));
  const extensionArg = yield* encodeArgument(extension);
  const rootArg = yield* encodeArgument(root);
  return {
    settings: {
      ...settings,
      binaryPath:
        settings.binaryPath && settings.binaryPath !== "pi" ? settings.binaryPath : bundledPiBinary,
      launchArgs: `${settings.launchArgs} --extension ${extensionArg} --ozi-data-root ${rootArg}`,
    },
    environment: { ...environment, PI_CODING_AGENT_DIR: agentDir, OZI_DATA_ROOT: root },
  };
});
