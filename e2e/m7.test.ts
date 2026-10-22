import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import type { OziJobCard } from "@t3tools/contracts";
import { afterEach, beforeEach, expect, it } from "vite-plus/test";
import { startHarness, type Harness, type Projection } from "./harness.ts";

type Card = typeof OziJobCard.Encoded;
let h: Harness;
beforeEach(async () => {
  h = await startHarness();
});
afterEach(async () => {
  await h?.close();
});

it("m7.remote-cli", async () => {
  const home = NodePath.join(h.root, "remote");
  const file = NodePath.join(home, "remote.json");
  const remote = <T = unknown>(...args: string[]) => h.ozi<T>(...args, "--home", home);
  const failure = async (args: string[], message: string, json = true) => {
    const result = await h.execOutput(...args, "--home", home, ...(json ? ["--json"] : []));
    expect(result.code).not.toBe(0);
    const output = (result.stdout + result.stderr).trim();
    expect(output.split(/[\r\n]+/)).toHaveLength(1);
    if (json)
      expect(JSON.parse(output)).toEqual({
        error: { code: expect.any(String), message: expect.stringContaining(message) },
      });
    else expect(output).toContain(message);
  };
  const pairing = await h.ozi<{ url: string; credential: string }>("pair");
  const origin = new URL(pairing.url).origin;
  expect(await remote("connect", pairing.url)).toEqual({ origin });
  const saved = JSON.parse(await NodeFSP.readFile(file, "utf8"));
  expect(saved).toEqual({ origin, token: expect.any(String) });
  expect(saved.token).not.toBe(pairing.credential);
  expect((await NodeFSP.stat(file)).mode & 0o777).toBe(0o600);
  await failure(["connect", pairing.url], "ozi connect");
  const invalid = new URL(pairing.url);
  invalid.hash = "token=invalid";
  await failure(["connect", invalid.toString()], "ozi connect");
  await failure(["connect", invalid.toString()], "ozi connect", false);
  expect(JSON.parse(await NodeFSP.readFile(file, "utf8"))).toEqual(saved);

  await h.script([
    {
      match: "^remote-start$",
      role: "main",
      steps: [
        {
          tool: {
            name: "delegate_task",
            arguments: {
              task: "remote-worker",
              title: "remote-worker",
              mode: "async",
              clientRequestId: "remote-worker",
            },
          },
        },
        { say: "remote started" },
      ],
    },
    {
      match: "^remote-worker$",
      role: "worker",
      steps: [{ ask: "Which color?" }, { say: "remote answered: $result" }],
    },
    { match: ".*", role: "main", steps: [{ say: "received" }], repeat: true },
  ]);
  await remote("say", "remote-start");
  await remote("wait", "thread", "ozi-main", "text:remote started", "--timeout", "20");
  const [card] = await remote<Card[]>("jobs");
  expect(card).toMatchObject({ title: "remote-worker" });
  const pending = await remote<Card>("wait", "job", card!.jobId, "needs_you", "--timeout", "20");
  const request = pending.requests.find((request) => request.kind === "question")!;
  expect(request).toMatchObject({ prompt: "Which color?" });
  await remote("answer", request.id, "Ocean", "Blue");
  const thread = await remote<Projection>(
    "wait",
    "thread",
    request.threadId,
    "text:remote answered",
    "--timeout",
    "20",
  );
  expect(JSON.stringify(thread.messages)).toContain("Ocean Blue");
  expect((await h.ozi<Card[]>("jobs"))[0]!.jobId).toBe(card!.jobId);

  const localPairing = await h.ozi<{ url: string }>("pair");
  await h.ozi("connect", localPairing.url);
  const [revoked] = await h.ozi<{ status: number; body: string }[]>(
    "request",
    "/api/auth/clients/revoke-others",
    "--method",
    "POST",
  );
  expect(revoked!.status).toBe(200);
  expect(JSON.parse(revoked!.body).revokedCount).toBe(2);
  await failure(["jobs"], "ozi connect");
  await failure(["jobs"], "ozi connect", false);
  expect(await h.ozi<Card[]>("jobs")).toHaveLength(1);
  const fresh = await h.ozi<{ url: string }>("pair");
  await remote("connect", fresh.url);
  expect(await remote<Card[]>("jobs")).toHaveLength(1);
  expect((await NodeFSP.stat(file)).mode & 0o777).toBe(0o600);
  expect(await remote("disconnect")).toEqual({ disconnected: true });
  await expect(NodeFSP.stat(file)).rejects.toMatchObject({ code: "ENOENT" });
  await failure(["jobs"], "found no running server");
  const disconnected = await h.execOutput("disconnect", "--home", home);
  expect(disconnected).toMatchObject({ code: 0, stderr: "" });
  expect(disconnected.stdout.trim().split(/[\r\n]+/)).toHaveLength(1);
});
