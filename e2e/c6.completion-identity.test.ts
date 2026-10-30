import * as NodeChildProcess from "node:child_process";
import * as NodeEvents from "node:events";
import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import { expect, it } from "vite-plus/test";
import { startAnthropic } from "./fakes/anthropic.ts";

const exec = NodeUtil.promisify(NodeChildProcess.execFile);
const root = NodePath.resolve(import.meta.dirname, "..");
const bin = NodePath.join(root, "apps/server/src/bin.ts");

it("C6.completion-identity: delegated wakes preserve rounds and verified progress resets them", async () => {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "ozi-c6-identity-"));
  const home = NodePath.join(directory, "home");
  const workspace = NodePath.join(directory, "work");
  await NodeFSP.mkdir(workspace);
  if (process.env.OZI_C6_HARNESS_ROOT) {
    await NodeFSP.mkdir(NodePath.join(home, "harness"), { recursive: true });
    await NodeFSP.writeFile(
      NodePath.join(home, "harness/system.md"),
      "You are Ozi. Coordinate workers and check their evidence.",
    );
  }
  await NodeFSP.mkdir(NodePath.join(home, "userdata"), { recursive: true });
  await NodeFSP.writeFile(
    NodePath.join(home, "userdata/settings.json"),
    JSON.stringify({
      enableProviderUpdateChecks: false,
      providerInstances: {
        ...(process.env.OZI_C6_HARNESS_ROOT
          ? {
              ozi: {
                driver: "pi",
                enabled: true,
                config: {
                  harness: "pi",
                  binaryPath: NodePath.join(root, "apps/server/node_modules/.bin/pi"),
                  launchArgs: `--extension ${JSON.stringify(process.env.OZI_C6_HARNESS_ROOT)} --ozi-data-root ${JSON.stringify(NodePath.join(home, "harness"))}`,
                },
              },
            }
          : {}),
        codex: { driver: "codex", enabled: false },
        claudeAgent: { driver: "claudeAgent", enabled: false },
      },
    }),
  );
  let phase: "capabilities" | "delegate" | "wait" | "check" | "result" | "finished" =
    "capabilities";
  let workerTurns = 0;
  const writtenRounds = new Set<number>();
  let taskId = "";
  let childThreadId = "";
  let output = "";
  const observed: unknown[] = [];
  const finished = Promise.withResolvers<void>();
  const deadline = setTimeout(
    () =>
      finished.reject(
        new Error(
          JSON.stringify({ phase, workerTurns, taskId, observed, output: output.slice(-500) }),
        ),
      ),
    55_000,
  );
  const fake = await startAnthropic((request) => {
    const system = JSON.stringify(request.system);
    const messages = JSON.stringify(request.messages);
    if (system.includes("OZI COMPLETION CHECK"))
      return {
        text: JSON.stringify(
          system.includes("Check only the supplied worker")
            ? {
                verdict: {
                  verdict: "continue",
                  missing: "progress.txt must also contain C.",
                  evidence: [],
                  useful: true,
                },
                verified: [],
              }
            : {
                verdict: { verdict: "done", useful: false },
                verified: ["The staged worker or coordination response is complete."],
              },
        ),
      };
    if (messages.includes("Check the completed turn's inbox only"))
      return { text: "Nothing to file." };
    if (request.tools.length === 0) return { text: "C6 staged result" };
    const tool = (suffix: string, args: Record<string, unknown>) => {
      const name = request.tools.find((entry) => entry.name.split(/__|\./).at(-1) === suffix)?.name;
      if (!name) throw new Error(`Missing ${suffix}`);
      return { tool: name, arguments: args };
    };
    if (!messages.includes("C6_IDENTITY_ROOT")) {
      if (!messages.includes("C6_WORKER:")) return { text: "C6 staged result" };
      workerTurns = [...messages.matchAll(/Completion check found missing work:/g)].length + 1;
      if ((workerTurns === 1 || workerTurns === 2) && !writtenRounds.has(workerTurns)) {
        writtenRounds.add(workerTurns);
        return tool("write", {
          path: "progress.txt",
          content: workerTurns === 1 ? "A\n" : "A\nB\n",
        });
      }
      return { text: "C6 staged worker finished this round without changes." };
    }
    let check:
      | { state: string; unsuccessfulRounds: number; request: string; error: string | null }
      | undefined;
    const visit = (value: unknown): void => {
      if (typeof value === "string") {
        try {
          visit(JSON.parse(value));
        } catch {}
      } else if (value && typeof value === "object") {
        if ("taskId" in value && "childThreadId" in value) {
          taskId = String(value.taskId);
          childThreadId = String(value.childThreadId);
        } else if ("workerId" in value && "fingerprint" in value && "state" in value)
          check = value as typeof check;
        else for (const item of Object.values(value)) visit(item);
      }
    };
    visit(request.messages);
    switch (phase) {
      case "capabilities":
        phase = "delegate";
        return tool("orchestrator_capabilities", {});
      case "delegate":
        phase = "wait";
        return tool("delegate_task", {
          task: "C6_WORKER: write progress.txt in staged rounds. Initial A, second round append B; otherwise no changes.",
          target: { providerInstanceId: "ozi", model: "claude-bridge/claude-opus-5-5" },
          mode: "wait",
        });
      case "result":
        observed.push(
          check && {
            state: check.state,
            count: check.unsuccessfulRounds,
            request: check.request,
            error: check.error,
          },
        );
        if (check?.state === "blocked") {
          phase = "finished";
          finished.resolve();
          return { text: "C6_IDENTITY_BLOCKED" };
        }
        phase = "wait";
        if (check?.state === "continued") return { text: "Waiting for the worker." };
        break;
      case "check":
        phase = "result";
        return tool("completion_check", {
          workerId: taskId,
          files: ["progress.txt"],
          ticket: {
            group: "Review",
            title: "C6 three-line result",
            need: "Review A, B and C.",
            summary: "progress.txt must contain A, B and C.",
            markdown: "All three lines are required.",
            choices: [],
            attachments: [],
            htmlPages: [],
          },
        });
      case "finished":
        return { text: "C6_IDENTITY_BLOCKED" };
    }
    phase = "check";
    if (!taskId || !childThreadId) {
      finished.reject(new Error("Delegation did not return its task and child IDs"));
      return { text: "Missing delegated identity." };
    }
    return tool("ozi_thread_wait", {
      threadId: childThreadId,
      untilDelegatedWorkSettled: true,
    });
  });
  const reserve = NodeNet.createServer().listen(0, "127.0.0.1");
  await NodeEvents.once(reserve, "listening");
  const { port } = reserve.address() as NodeNet.AddressInfo;
  await new Promise<void>((resolve) => reserve.close(() => resolve()));
  const env = {
    ...process.env,
    HOME: directory,
    OZI_HOME: "",
    OZI_TELEMETRY_ENABLED: "false",
    CLAUDE_CONFIG_DIR: NodePath.join(directory, "claude"),
    PI_CODING_AGENT_DIR: NodePath.join(directory, "pi"),
    CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-ozi-test-only",
    ANTHROPIC_BASE_URL: fake.url,
  };
  const server = NodeChildProcess.spawn(
    process.execPath,
    [bin, "serve", "--home", home, "--port", String(port), "--host", "127.0.0.1", "--no-browser"],
    { cwd: workspace, env, stdio: "pipe" },
  );
  server.stderr.on("data", (chunk) => (output += chunk));
  const ozi = async (...args: string[]) =>
    JSON.parse(
      (await exec(process.execPath, [bin, ...args, "--home", home, "--json"], { env })).stdout,
    );
  try {
    await new Promise<void>((resolve, reject) => {
      server.stdout.on("data", (chunk) => {
        output += chunk;
        if (output.includes("Ozi server is ready.")) resolve();
      });
      server.once("exit", () => reject(new Error(output)));
    });
    const main = await ozi(
      "thread",
      "start",
      "--cwd",
      workspace,
      "C6_IDENTITY_ROOT: check the staged worker until blocked.",
    );
    await finished.promise;
    await ozi("thread", "wait", main.threadId);
    const records = JSON.parse(
      (
        await exec(
          process.execPath,
          [
            NodePath.join(root, "apps/server/node_modules/@ozi/pi/src/cli.mjs"),
            "checks",
            "--data-root",
            NodePath.join(home, "harness"),
            "--json",
          ],
          { env },
        )
      ).stdout,
    ).filter(
      (row: { workerId: string | null; state: string }) =>
        row.workerId !== null && row.state !== "superseded",
    );
    expect(
      new Set(records.map((row: { request: string }) => row.request)).size,
      JSON.stringify(records),
    ).toBe(1);
    expect(
      records.map((row: { unsuccessfulRounds: number }) => row.unsuccessfulRounds),
      JSON.stringify(records),
    ).toEqual([1, 0, 1, 2, 3]);
    expect(records.at(-1).state).toBe("blocked");
    expect(await NodeFSP.readFile(NodePath.join(workspace, "progress.txt"), "utf8")).toBe("A\nB\n");
    const tickets = await ozi("ticket", "list", "--input", '{"search":"C6 three-line result"}');
    expect(tickets.tickets).toHaveLength(1);
    expect(tickets.tickets[0].group).toBe("Read");
  } finally {
    clearTimeout(deadline);
    if (server.exitCode === null && server.signalCode === null) {
      const exited = NodeEvents.once(server, "exit");
      server.kill("SIGTERM");
      await exited;
    }
    await fake.close();
    await NodeFSP.rm(directory, { recursive: true, force: true });
  }
});
