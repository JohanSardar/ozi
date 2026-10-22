import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { parse, type ArrayExpression, type Node, type Property } from "acorn";
import { expect, it } from "vite-plus/test";
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
  const allow = /(?:^\.repos\/|(?:LICENSE|NOTICE)|\.test\.|^e2e\/|\.md$)/;
  const desktop =
    /^(?:apps\/desktop\/|scripts\/build-desktop-artifact\.ts$|packages\/shared\/src\/(?:desktopAppControl|devHome|promptLinks|providerAuthReturnUrl|codexAuthHandoff)\.ts$|packages\/contracts\/src\/desktopBootstrap\.ts$|apps\/server\/src\/(?:httpCors|cli\/config)\.ts$|packages\/ssh\/src\/(?:tunnel|auth)\.ts$)/;
  const forbidden =
    /\.t3\b|t3code|T3 Code|T3CODE_|T3_SSH_AUTH_SECRET|com\.t3tools|T3SnapShot|snap-shot@t3\.codes/i;
  const violations: string[] = [];
  for (const path of paths) {
    if (allow.test(path) || !/\.(?:[cm]?[jt]sx?|json|xml|sh|ps1|ya?ml)$/.test(path)) continue;
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
    await page.waitForURL((url) => url.pathname !== "/pair");
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
