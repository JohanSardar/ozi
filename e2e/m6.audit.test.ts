import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import * as NodeURL from "node:url";
import { parse, type ArrayExpression, type Node, type Property } from "acorn";
import { expect, it } from "vite-plus/test";
import ts from "typescript-legacy";
import { startHarness } from "./harness.ts";

const repo = NodeURL.fileURLToPath(new URL("..", import.meta.url));
const exec = (command: string, args: string[]) =>
  new Promise<string>((resolve, reject) => {
    NodeChildProcess.execFile(
      command,
      args,
      {
        cwd: repo,
        env: { ...process.env, OZI_DESKTOP_DEV: "0" },
        timeout: 300_000,
        maxBuffer: 16 * 1024 * 1024,
      },
      (error, stdout, stderr) =>
        error ? reject(new Error(stderr || stdout || error.message)) : resolve(stdout),
    );
  });

it("m6.audit desktop never uses T3 Code's identity or legacy state", async () => {
  const paths = (await exec("git", ["ls-files", "-z"])).split("\0").filter(Boolean);
  expect(
    JSON.parse(await NodeFSP.readFile(NodePath.join(repo, "apps/server/package.json"), "utf8"))
      .name,
  ).toBe("ozi");
  const allow = /(?:^\.repos\/|(?:LICENSE|NOTICE)|\.test\.|^e2e\/|\.md$)/;
  const desktop =
    /^(?:native\/(?:kde|hyprland)-snap-shot\/|apps\/desktop\/|scripts\/build-desktop-artifact\.ts$|packages\/shared\/src\/(?:desktopAppControl|devHome|promptLinks|providerAuthReturnUrl|codexAuthHandoff)\.ts$|packages\/contracts\/src\/desktopBootstrap\.ts$|apps\/server\/src\/(?:httpCors|cli\/config)\.ts$|packages\/ssh\/src\/(?:tunnel|auth)\.ts$)/;
  const forbidden =
    /\.t3\b|t3code|T3 Code|T3CODE_|T3_SSH_AUTH_SECRET|com\.t3tools|T3SnapShot|snap-shot@t3\.codes|t3-(?:kde|hyprland|browser-secret|snap-shot)/i;
  const metadata = JSON.parse(
    await NodeFSP.readFile(
      NodePath.join(repo, "apps/desktop/gnome-extension/metadata.json"),
      "utf8",
    ),
  );
  const extension = JSON.parse(
    await NodeFSP.readFile(NodePath.join(repo, "apps/desktop/gnome-extension/bundle.json"), "utf8"),
  );
  expect(metadata.uuid).toBe("snap-shot@com-ozi-app");
  expect(extension.uuid).toBe(metadata.uuid);
  const violations: string[] = [];
  for (const path of paths) {
    if (allow.test(path) || !/\.(?:[cm]?[jt]sx?|rs|qml|toml|json|xml|sh|ps1|ya?ml)$/.test(path))
      continue;
    const source = await NodeFSP.readFile(NodePath.join(repo, path), "utf8").catch((error) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    for (const [line, text] of source.split("\n").entries()) {
      if (/^\s*(?:\/\/|\*|#)/.test(text)) continue;
      if ((desktop.test(path) ? forbidden : /T3CODE_/).test(text))
        violations.push(`${path}:${line + 1}: ${text.trim()}`);
    }
    if (
      desktop.test(path) &&
      /DesktopLegacyLocalStorage|mergeLegacyLocalStorage|V1_PROFILE_NAMES/.test(source)
    )
      violations.push(`${path}: legacy state import`);
  }
  expect(violations).toEqual([]);
});

it("m6.audit bundled desktop starts ozi serve and pairs through Connections", async () => {
  await exec(NodePath.join(repo, "node_modules/.bin/vp"), [
    "run",
    "--filter",
    "@t3tools/desktop",
    "build",
  ]);
  const bundle = await NodeFSP.readFile(
    NodePath.join(repo, "apps/desktop/dist-electron/main.cjs"),
    "utf8",
  );
  const launches: string[][] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (value === null || typeof value !== "object") return;
    const node = value as Node;
    if (node.type === "Property") {
      const property = node as Property;
      if (
        property.key.type === "Identifier" &&
        property.key.name === "args" &&
        property.value.type === "ArrayExpression"
      ) {
        const elements = (property.value as ArrayExpression).elements;
        const index = elements.findIndex(
          (entry) => entry?.type === "Literal" && entry.value === "--bootstrap-fd",
        );
        if (index !== -1) {
          const command = elements[index - 2];
          expect(command?.type).toMatch(/^(?:MemberExpression|SpreadElement)$/);
          const argv = elements
            .slice(index - 1)
            .flatMap((entry) =>
              entry?.type === "Literal" && typeof entry.value === "string" ? [entry.value] : [],
            );
          expect(argv.slice(0, 2)).toEqual(["serve", "--bootstrap-fd"]);
          launches.push(argv);
        }
      }
    }
    Object.values(value).forEach(visit);
  };
  visit(parse(bundle, { ecmaVersion: "latest", sourceType: "script" }));
  expect(launches.toSorted()).toEqual([
    ["serve", "--bootstrap-fd", "0"],
    ["serve", "--bootstrap-fd", "3"],
  ]);
  const local = await startHarness({ desktopArgv: launches.find((argv) => argv[2] === "3")! });
  let remote: Awaited<ReturnType<typeof startHarness>> | undefined;
  try {
    remote = await startHarness();
    expect((await local.status()).main?.thread.id).toBe("ozi-main");
    expect(await NodeFSP.readFile(NodePath.join(local.root, "account/.t3/bin/t3"), "utf8")).toBe(
      "T3 sentinel",
    );
    expect(await NodeFSP.readdir(NodePath.join(local.root, "account/.t3"))).toEqual(["bin"]);
    const page = await local.page();
    await page.getByPlaceholder("Tell Ozi anything…").waitFor();
    await page.goto(new URL("/settings/connections", page.url()).href);
    await page.getByRole("button", { name: "Add environment", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Add Environment", exact: true });
    const pairing = await remote.ozi<{ url: string }>("pair");
    await dialog.getByRole("textbox", { name: "Host", exact: true }).fill(pairing.url);
    await dialog.getByRole("button", { name: "Add environment", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    const environmentId = (await remote.status()).server.environment.environmentId;
    const permissions = page.locator(`[aria-controls="remote-permissions-${environmentId}"]`);
    await permissions.waitFor();
    await page.reload();
    await permissions.waitFor();
  } finally {
    await remote?.close();
    await local.close();
  }
}, 360_000);

it("m6.audit tests and provider fakes live only in e2e", async () => {
  const paths = (await exec("git", ["ls-files", "-z"])).split("\0").filter(Boolean);
  const violations: string[] = [];
  for (const path of paths) {
    if (path.startsWith(".repos/") || path.startsWith("e2e/")) continue;
    if (!(await NodeFSP.lstat(NodePath.join(repo, path)).catch(() => null))) continue;
    if (
      /\.(?:test|spec|testkit|testFixtures)\.[cm]?[jt]sx?$|(?:^|\/)(?:testUtils|testFixtures|testkit|testing)\/|(?:^|\/)(?:test\.c|transport_tests\.rs|tst_.*\.qml)$/.test(
        path,
      )
    )
      violations.push(path);
    if (
      path.endsWith(".rs") &&
      /#\[(?:test|cfg\(test\))\]/.test(await NodeFSP.readFile(NodePath.join(repo, path), "utf8"))
    )
      violations.push(`${path}: native unit test`);
    if (!/\.(?:[cm]?[jt]sx?|json)$/.test(path)) continue;
    const source = await NodeFSP.readFile(NodePath.join(repo, path), "utf8");
    if (path.endsWith("package.json")) {
      const scripts = JSON.parse(source).scripts ?? {};
      for (const [name, command] of Object.entries(scripts))
        if (
          /(?:^|[-:])test(?:$|[-:])/.test(name) &&
          !(path === "package.json" && name === "test" && command === "vp test run --root e2e")
        )
          violations.push(`${path}: test script ${name}`);
    }
    if (
      /(?:from\s+|import\s*\(|require\s*\()['"](?:@effect\/vitest|@vitest\/|vitest|@t3tools\/provider-testing)/.test(
        source,
      )
    )
      violations.push(`${path}: test-only import`);
  }
  expect(violations).toEqual([]);
});

it("m6.audit Knip finds no unused files, exports or dependencies", async () => {
  await exec(NodePath.join(repo, "node_modules/.bin/knip"), [
    "--include",
    "files,dependencies,exports,nsExports,duplicates,unresolved",
    "--preprocessor",
    "./scripts/knip-schemas.ts",
    "--no-config-hints",
  ]);
}, 360_000);

const removedCapabilities = [
  "threadPullRequests",
  "threadSnooze",
  "projectWorktreeCleanup",
  "projectSettingsOverrides",
  "projectProviderInstanceOverrides",
  "threadPinning",
  "threadPinReorder",
  "threadActiveReorder",
  "threadVisitedTracking",
  "commandOutputStreaming",
];
const removedSettings =
  /^(?:diffFilesCollapsed|diffIgnoreWhitespace|diffLayout|confirmThread(?:Archive|Delete|Unpin)|legacySidebarEnabled|sidebar(?:WorkingShelfEnabled|ProjectGroupingMode|ProjectGroupingOverrides|ProjectSortOrder|ThreadSortOrder|ThreadPreviewCount)|snoozeLimitedThreads|projectSettingsOverrides|projectAgentBrowserAccessOverrides|projectSettingsFolded)$/;

it("m6.audit retired imports, settings, instructions and Ozi comments stay absent", async () => {
  const paths = (await exec("git", ["ls-files", "-z"])).split("\0").filter(Boolean);
  const contracts = await import("@t3tools/contracts");
  for (const name of [
    "OrchestratorMcpTaskRole",
    "ProjectSettingsOverrides",
    "ProjectProviderInstanceOverride",
    "PROJECT_SCOPED_SERVER_SETTING_KEYS",
    "SourceControlHostSettings",
    "DiffLayout",
    "SidebarProjectSortOrder",
    "SidebarThreadSortOrder",
    "SidebarProjectGroupingMode",
    "SidebarThreadPreviewCount",
  ])
    expect(contracts).not.toHaveProperty(name);
  const violations = new Set<string>();
  const retired =
    /^(?:@effect\/vitest|@vitest\/|vitest(?:\/|$)|@t3tools\/(?:provider-testing|source-control|shared\/projectSettings)|@ff-labs\/|@pierre\/diffs|node-pty(?:\/|$))/;
  for (const path of paths) {
    if (path.startsWith(".repos/") || !/\.[cm]?[jt]sx?$/.test(path)) continue;
    const source = await NodeFSP.readFile(NodePath.join(repo, path), "utf8").catch((error) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    const ozi =
      /^(?:apps\/server\/src\/ozi\/|apps\/web\/src\/components\/ozi\/|e2e\/|scripts\/features\.ts$)/.test(
        path,
      );
    const inherited = !path.startsWith("e2e/") && !path.includes("/persistence/Migrations");
    const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    const comment = (position: number) => {
      if (
        ts.getLeadingCommentRanges(source, position)?.length ||
        ts.getTrailingCommentRanges(source, position)?.length
      )
        violations.add(`${path}: Ozi comment`);
    };
    const visit = (node: ts.Node) => {
      if (ozi) {
        comment(node.pos);
        comment(node.end);
        if (ts.isJsxExpression(node)) comment(node.getStart(parsed) + 1);
      }
      if (inherited && (ts.isStringLiteralLike(node) || ts.isJsxText(node))) {
        if (/\bT3(?: Code| Chat)?\b|t3\.codes|--filter=t3\b|t3\.tgz|dist-exe\/t3\b/.test(node.text))
          violations.add(`${path}: T3 product text`);
        if (/Act as the .*sub-agent/.test(node.text)) violations.add(`${path}: role preamble`);
      }
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        retired.test(node.moduleSpecifier.text)
      )
        violations.add(`${path}: retired import`);
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          node.expression.getText(parsed) === "require")
      ) {
        const argument = node.arguments[0];
        if (argument && ts.isStringLiteral(argument) && retired.test(argument.text))
          violations.add(`${path}: retired import`);
      }
      if (inherited && (ts.isPropertyAssignment(node) || ts.isPropertySignature(node))) {
        const name = node.name.getText(parsed);
        if (removedSettings.test(name)) violations.add(`${path}: retired setting`);
        if (
          /\/(?:environment|ServerEnvironment)\.ts$/.test(path) &&
          removedCapabilities.includes(name)
        )
          violations.add(`${path}: retired capability`);
      }
      ts.forEachChild(node, visit);
    };
    visit(parsed);
  }
  expect([...violations]).toEqual([]);
});

it("m6.audit runtime excludes snooze and preserves delegated briefs", async () => {
  const h = await startHarness();
  try {
    const status = await h.status();
    for (const key of removedCapabilities)
      expect(status.server.environment.capabilities).not.toHaveProperty(key);
    expect(status.server.settings).not.toHaveProperty("snoozeLimitedThreads");
    for (const key of ["snoozedUntil", "snoozedAt", "lastSnoozeWakeAt"])
      expect(status.main!.thread).not.toHaveProperty(key);
    for (const type of ["thread.snooze", "thread.unsnooze"])
      expect(
        await h.ozi(
          "request",
          "orchestration.dispatchCommand",
          "--payload",
          JSON.stringify({ type, commandId: type, threadId: "ozi-main" }),
        ),
      ).toMatchObject([{ ok: false }]);
    await h.script([
      {
        match: "audit-delegate",
        role: "main",
        steps: [
          {
            tool: {
              name: "delegate_task",
              arguments: {
                task: "verbatim-audit-brief",
                role: "research",
                title: "Audit",
                clientRequestId: "audit-brief",
              },
            },
          },
          { say: "audit-started" },
        ],
      },
      { match: "^verbatim-audit-brief$", role: "worker", steps: [{ say: "audit-brief-verified" }] },
      { match: "audit-brief-verified", role: "main", steps: [{ say: "audit-reported" }] },
    ]);
    await h.ozi("say", "audit-delegate");
    await h.ozi("wait", "thread", "ozi-main", "text:audit-reported", "--timeout", "30");
    const worker = (await h.status()).snapshot.threads.find((thread) => thread.role === "worker")!;
    const lead = await h.thread(worker.id);
    expect(lead.messages.find((message) => message.role === "user")?.text).toBe(
      "verbatim-audit-brief",
    );
    const record = (await h.records()).find(
      (entry) => entry.provider === "codex" && entry.event === "prompt" && entry.role === "worker",
    );
    expect(record?.instructions).toContain("Do the brief fully yourself.");
    expect(record?.instructions).not.toMatch(/Act as the .*sub-agent/);
    await h.restart();
    expect((await h.status()).main!.thread).not.toHaveProperty("snoozedUntil");
  } finally {
    await h.close();
  }
});

it("m6.audit existing snooze events migrate without losing the thread", async () => {
  const h = await startHarness();
  try {
    await h.restart({}, async () => {
      const db = new NodeSqlite.DatabaseSync(NodePath.join(h.home, "userdata/statev2.sqlite"));
      try {
        db.exec(`
          ALTER TABLE projection_threads ADD COLUMN snoozed_until TEXT;
          ALTER TABLE projection_threads ADD COLUMN snoozed_at TEXT;
          DELETE FROM effect_sql_migrations WHERE migration_id = 85;
          UPDATE orchestration_v2_projection_threads
          SET payload_json = json_set(payload_json, '$.snoozedUntil', '2099-01-01T00:00:00.000Z', '$.snoozedAt', '2026-01-01T00:00:00.000Z')
          WHERE thread_id = 'ozi-main';
          INSERT INTO orchestration_events (
            event_id, aggregate_kind, stream_id, stream_version, event_type,
            occurred_at, command_id, causation_event_id, correlation_id, actor_kind,
            payload_json, metadata_json, application_event_version
          )
          SELECT 'audit-snooze-event', aggregate_kind, stream_id, stream_version + 1,
            'thread.snoozed', occurred_at, NULL, NULL, NULL, 'server',
            (SELECT payload_json FROM orchestration_v2_projection_threads WHERE thread_id = 'ozi-main'),
            metadata_json, 2
          FROM orchestration_events WHERE stream_id = 'ozi-main' AND application_event_version = 2
          ORDER BY sequence DESC LIMIT 1;
        `);
      } finally {
        db.close();
      }
    });
    const events = await h.ozi<{ event: { id: string; type: string; payload: object } }[]>(
      "events",
      "ozi-main",
    );
    const migrated = events.find((row) => row.event.id === "audit-snooze-event")!;
    expect(migrated.event.type).toBe("thread.metadata-updated");
    expect(migrated.event.payload).not.toHaveProperty("snoozedUntil");
    expect(migrated.event.payload).not.toHaveProperty("snoozedAt");
    expect((await h.status()).main!.thread.id).toBe("ozi-main");
  } finally {
    await h.close();
  }
});

it("m6.audit provider and browser preferences have one server scope", async () => {
  const h = await startHarness();
  try {
    const status = await h.status();
    const instances = status.server.settings.providerInstances!;
    const update = (enabled: boolean) =>
      h.ozi(
        "request",
        "server.updateSettings",
        "--payload",
        JSON.stringify({
          patch: {
            providerInstances: { ...instances, codex: { ...instances.codex, enabled } },
            enableAgentBrowserAccess: false,
            projectSettingsOverrides: {
              [status.main!.thread.projectId]: {
                enableAgentBrowserAccess: true,
                providerInstances: { codex: { enabled: true } },
              },
            },
            projectAgentBrowserAccessOverrides: { [status.main!.thread.projectId]: true },
            projectSettingsFolded: false,
          },
        }),
      );
    expect(await update(false)).toMatchObject([{ ok: true }]);
    await h.ozi("wait", "provider", "codex", "disabled", "--timeout", "30");
    await h.script([
      {
        match: "settings-disabled-case",
        role: "main",
        steps: [
          {
            tool: {
              name: "delegate_task",
              arguments: { task: "disabled-settings-worker", clientRequestId: "settings-disabled" },
            },
          },
          { say: "settings-disabled-checked" },
        ],
      },
      {
        match: "settings-enabled-case",
        role: "main",
        steps: [
          {
            tool: {
              name: "delegate_task",
              arguments: { task: "settings-worker", clientRequestId: "settings-enabled" },
            },
          },
          { say: "settings-started" },
        ],
      },
      {
        match: "^settings-worker$",
        role: "worker",
        steps: [{ tool: { name: "preview_status" } }, { say: "settings-result" }],
      },
      { match: "settings-result", role: "main", steps: [{ say: "settings-reported" }] },
    ]);
    await h.ozi("say", "settings-disabled-case");
    await h.ozi("wait", "thread", "ozi-main", "text:settings-disabled-checked", "--timeout", "30");
    expect(await h.ozi("jobs")).toMatchObject([{ column: "needs_you" }]);
    expect(
      (await h.records()).filter(
        (record) => record.provider === "codex" && record.event === "prompt",
      ),
    ).toEqual([]);
    expect(await update(true)).toMatchObject([{ ok: true }]);
    await h.ozi("wait", "provider", "codex", "ready", "--timeout", "30");
    await h.ozi("say", "settings-enabled-case");
    await h.ozi("wait", "thread", "ozi-main", "text:settings-reported", "--timeout", "30");
    const records = await h.records();
    const preview = records.find(
      (record) =>
        record.provider === "codex" && record.event === "tool" && record.name === "preview_status",
    );
    expect(preview?.result?.isError).toBe(true);
    await h.restart();
    const settings = (await h.status()).server.settings;
    expect(settings.enableAgentBrowserAccess).toBe(false);
    for (const key of [
      "projectSettingsOverrides",
      "projectAgentBrowserAccessOverrides",
      "projectSettingsFolded",
    ])
      expect(settings).not.toHaveProperty(key);
  } finally {
    await h.close();
  }
});
