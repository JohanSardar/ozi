import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { expect, it } from "vite-plus/test";

const repo = NodeURL.fileURLToPath(new URL("..", import.meta.url));
const git = (root: string, ...args: string[]) =>
  NodeChildProcess.execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16_777_216,
  });
const emailPattern = /\b[A-Z0-9._%+-]+@(?:[A-Z0-9-]+\.)+[A-Z]{2,}\b/gi;
const placeholderUser =
  /^(?:user|runner|example|test(?:user)?|alice|bob|demo|me|someone|replay-user|repair|dev|vscode|t3|x|linuxbrew|sprite)$/i;
const placeholderDomain =
  /(?:^|\.)(?:example(?:-[a-z]+)?\.[a-z]+|acme\.(?:com|org|net|dev)|invalid|test|example|localhost)$/i;
const placeholderEmail =
  /^(?:test|user|example|foo|bar|alice|bob|dev|me|someone|nobody)@(?:test|company|acme|domain|email)\.(?:com|org|net)$/i;
const tokenPattern =
  /\b(?:sk-(?:(?:ant-(?:api\d+-)?|proj-|svcacct-))?[A-Za-z0-9_-]{32,}|gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{82,})\b/;
const privateKeyPattern = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/;
const publicEmails = new Set([
  "claude@anthropic.com",
  "codex@openai.com",
  "copilot@github.com",
  "snap-shot@t3.codes",
]);
const networks = new Map([
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
]);

async function personalData(root: string) {
  const hits: string[] = [];
  for (const file of git(root, "ls-files", "-z").split("\0").filter(Boolean)) {
    if (file.startsWith(".repos/")) continue;
    const path = NodePath.join(root, file);
    const contents = (await NodeFSP.lstat(path)).isSymbolicLink()
      ? await NodeFSP.readlink(path)
      : await NodeFSP.readFile(path, "utf8");
    let authors = "";
    if (/(?:^|\/)package\.json$/.test(file)) {
      const metadata = JSON.parse(contents);
      authors = JSON.stringify([metadata.author, metadata.contributors, metadata.maintainers]);
    }
    for (const [index, line] of contents.split(/\r?\n/).entries()) {
      const kinds = new Set<string>();
      for (const match of line.matchAll(/\/(?:home|Users)\/(\w[\w .-]*)\//g))
        if (!placeholderUser.test(match[1]!)) kinds.add("home path");
      for (const match of line.matchAll(emailPattern)) {
        const email = match[0];
        const [local, host] = email.split("@");
        const domain = host!.replace(
          /\.(?:json|png|jpe?g|svg|webp|gif|patch|txt|md|[cm]?[jt]sx?)$/i,
          "",
        );
        const attribution =
          (file === "third-party-licenses.config.json" ||
            /(?:^|\/)(?:LICENSE|COPYING|NOTICE)(?:\.[^/]*)?$/i.test(file)) &&
          /copyright|author|contributor|maintainer/i.test(line);
        const metadata =
          (file === "scripts/build-desktop-artifact.ts" && /\bmaintainer\s*:/.test(line)) ||
          (file === "pnpm-lock.yaml" && /^\s+deprecated:/.test(line));
        const before = line.slice(0, match.index);
        const after = line.slice(match.index + email.length);
        const remote =
          /^(?:git|deploy|ssh)$/.test(local!) ||
          /^:[A-Za-z0-9_.-]+\//.test(after) ||
          (/(?:https?|ssh):\/\/[^\s"'<>/]*$/.test(before) &&
            /^(?:\/|:\d+(?:\/|["')\s]|$))/.test(after));
        if (
          domain.includes(".") &&
          !placeholderDomain.test(domain) &&
          !placeholderEmail.test(email) &&
          !/(?:^|\.)noreply\.github\.com$/i.test(domain) &&
          !/^noreply$/i.test(local!) &&
          !/^\d+\.\d+\.\d+(?:[-+.]|$)/.test(domain) &&
          !publicEmails.has(`${local}@${domain}`.toLowerCase()) &&
          !authors.includes(email) &&
          !attribution &&
          !metadata &&
          !remote
        )
          kinds.add("email");
      }
      for (const match of line.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)) {
        if (!NodeNet.isIPv4(match[0])) continue;
        const prefix = networks.get(match[0]);
        if (
          prefix &&
          new RegExp(`^(?:/${prefix}(?!\\d)|["'],\\s*${prefix}\\])`).test(
            line.slice(match.index + match[0].length),
          )
        )
          continue;
        const [a, b] = match[0].split(".").map(Number);
        if (
          a === 10 ||
          (a === 172 && b! >= 16 && b! <= 31) ||
          (a === 192 && b === 168) ||
          (a === 100 && b! >= 64 && b! <= 127)
        )
          kinds.add("private IP");
      }
      if (tokenPattern.test(line)) kinds.add("token");
      if (privateKeyPattern.test(line)) kinds.add("private key");
      for (const kind of kinds) hits.push(`${file}:${index + 1} ${kind}`);
    }
  }
  return hits;
}

const mit = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

it("m6.public-ready MIT notices and tracked-file privacy", async () => {
  const license = await NodeFSP.readFile(NodePath.join(repo, "LICENSE"), "utf8");
  expect(license).toContain("MIT License");
  expect(license).toContain("Copyright (c) 2026 T3 Tools Inc.");
  expect(license).toContain("Copyright (c) 2026 Ozi contributors");
  expect(license).toContain(mit);
  const notices = await NodeFSP.readFile(NodePath.join(repo, "THIRD_PARTY_NOTICES.md"), "utf8");
  for (const [name, copyright, url] of [
    ["Pi", "Copyright (c) 2025 Mario Zechner", "https://github.com/earendil-works/pi"],
    ["Firstmate", "Copyright (c) 2026 Kun Chen", "https://github.com/kunchenguid/firstmate"],
  ]) {
    const notice = notices.split(`## ${name}\n`)[1]?.split("\n## ")[0];
    expect(notice).toContain(`MIT License\n\n${copyright}\n\n${mit}`);
    expect(notice).toContain(url);
  }
  const config = JSON.parse(
    await NodeFSP.readFile(NodePath.join(repo, "third-party-licenses.config.json"), "utf8"),
  );
  expect(config.customNotices).toContainEqual({
    bundles: ["desktop", "server", "web"],
    license: "MIT",
    name: "Pi and Firstmate",
    noticeFile: "THIRD_PARTY_NOTICES.md",
  });

  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "ozi-public-"));
  try {
    git(root, "init", "--quiet");
    const home = (base: string, name: string) => ["", base, name, "project"].join("/");
    const email = (domain: string) => ["person", domain].join("@");
    const samples = [
      [home("home", "private-person"), "home path"],
      [home("Users", "private-person"), "home path"],
      [home("Users", "Private Person"), "home path"],
      [home("home", "_private"), "home path"],
      [email("personal-domain.dev"), "email"],
      [email("personal-domain.dev") + ".json", "email"],
      [
        "https://" + email("personal-domain.dev") + ":" + email("github.com") + "/owner/repo.git",
        "email",
      ],
      ...[
        [10, 1, 2, 3],
        [172, 16, 0, 1],
        [172, 31, 1, 1],
        [192, 168, 1, 2],
        [100, 64, 0, 1],
        [100, 127, 1, 2],
      ].map((ip) => [ip.join("."), "private IP"]),
      ...[
        "sk-",
        "sk-proj-",
        "sk-svcacct-",
        "sk-ant-api03-",
        "ghp_",
        "gho_",
        "ghu_",
        "ghs_",
        "ghr_",
        "github_pat_",
      ].map((prefix) => [prefix + "a".repeat(90), "token"]),
      [["-----BEGIN", "PRIVATE KEY-----"].join(" "), "private key"],
      [["-----BEGIN RSA", "PRIVATE KEY-----"].join(" "), "private key"],
      [["-----BEGIN PGP", "PRIVATE KEY BLOCK-----"].join(" "), "private key"],
    ];
    await NodeFSP.writeFile(
      NodePath.join(root, "tracked fixture.txt"),
      samples.map(([value]) => value).join("\n"),
    );
    await NodeFSP.mkdir(NodePath.join(root, ".repos"));
    await NodeFSP.writeFile(
      NodePath.join(root, ".repos/reference.txt"),
      samples.map(([value]) => value).join("\n"),
    );
    await NodeFSP.writeFile(
      NodePath.join(root, "package.json"),
      JSON.stringify({ author: email("upstream.dev") }),
    );
    await NodeFSP.writeFile(
      NodePath.join(root, "safe.txt"),
      [
        home("home", "user"),
        home("home", "runner"),
        home("Users", "example"),
        email("example.com"),
        email("example.org"),
        email("example.test"),
        email("example.invalid"),
        email("users.noreply.github.com"),
        ["test", "test.com"].join("@"),
        email("example-company.com"),
        email("acme.dev"),
        email("example.com") + ".json",
        "icon@2x.png",
        ["git", "github.com"].join("@") + ":owner/repo.git",
        ["deploy", "github.com"].join("@") + ":owner/repo.git",
        ["deploy", "github.com"].join("@") + "/owner/repo.git",
        "ssh://" + ["aur", "aur.archlinux.org"].join("@") + "/repo.git",
        "https://user:" + email("github.com") + "/owner/repo.git",
        "https://user:pa@" + email("github.com") + "/owner/repo.git",
        "https://" + email("github.com") + "/owner/repo.git",
        ...[...networks].map(([network, prefix]) => `${network}/${prefix}`),
        ...[
          [100, 63, 255, 255],
          [100, 128, 0, 1],
          [172, 15, 0, 1],
          [172, 32, 0, 1],
          [127, 0, 0, 1],
          [192, 0, 2, 1],
        ].map((ip) => ip.join(".")),
        "ghp_fixture",
      ].join("\n"),
    );
    git(root, "add", ".");
    await NodeFSP.writeFile(NodePath.join(root, "untracked.txt"), samples[0]![0]!);
    expect(await personalData(root)).toEqual(
      samples.map(([, kind], index) => `tracked fixture.txt:${index + 1} ${kind}`),
    );
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
  const hits = await personalData(repo);
  expect(hits, "Tracked-file privacy violations").toEqual([]);
});
