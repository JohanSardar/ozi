import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeEvents from "node:events";
import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

const exec = NodeUtil.promisify(NodeChildProcess.execFile);
const bin = NodePath.resolve(import.meta.dirname, "../apps/server/src/bin.ts");

describe("I2.calendar-attachment", () => {
  let home: string;
  let threadId: string;
  let server: NodeChildProcess.ChildProcess | undefined;
  let env: NodeJS.ProcessEnv;
  const cli = async (...args: string[]) =>
    JSON.parse(
      (
        await exec(process.execPath, [bin, ...args, "--home", home, "--json"], {
          cwd: home,
          env,
          timeout: 25_000,
        })
      ).stdout,
    );
  const calendar = (command: string, input: unknown) =>
    cli("calendar", command, "--input", JSON.stringify(input));

  beforeAll(async () => {
    home = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "ozi-calendar-files-"));
    await NodeFSP.mkdir(NodePath.join(home, "userdata"));
    await NodeFSP.writeFile(
      NodePath.join(home, "userdata/settings.json"),
      JSON.stringify({ enableProviderUpdateChecks: false }),
    );
    env = {
      ...process.env,
      HOME: home,
      OZI_HOME: home,
      OZI_TELEMETRY_ENABLED: "false",
      TZ: "America/Chicago",
    };
    const reserve = NodeNet.createServer();
    reserve.listen(0, "127.0.0.1");
    await NodeEvents.once(reserve, "listening");
    const address = reserve.address();
    if (!address || typeof address === "string") throw new Error("No TCP address");
    await new Promise<void>((resolve) => reserve.close(() => resolve()));
    server = NodeChildProcess.spawn(
      process.execPath,
      [
        bin,
        "serve",
        "--home",
        home,
        "--host",
        "127.0.0.1",
        "--port",
        String(address.port),
        "--no-browser",
      ],
      { cwd: home, env, stdio: ["ignore", "pipe", "pipe"] },
    );
    await new Promise<void>((resolve, reject) => {
      let output = "";
      server!.stdout!.on("data", (chunk) => {
        output += chunk;
        if (output.includes("Ozi server is ready.")) resolve();
      });
      server!.stderr!.on("data", (chunk) => {
        output += chunk;
      });
      server!.once("error", reject);
      server!.once("exit", (code) => reject(new Error(`Server exited ${code}: ${output}`)));
    });
    ({ threadId } = await cli("session", "new", "--title", "Calendar and file checks"));
  });

  afterAll(async () => {
    if (server?.exitCode === null) {
      const exited = NodeEvents.once(server, "exit");
      server.kill("SIGTERM");
      await exited;
    }
    if (home) await NodeFSP.rm(home, { recursive: true, force: true });
  });

  it("I2.calendar: preserve local dates, DST, hashes, validation and ticket deduplication", async () => {
    const event = { title: "DST day", start: "2026-11-01" };
    const added = await calendar("add", event);
    expect(added.id).toBe(
      NodeCrypto.createHash("sha256")
        .update(JSON.stringify([event.title, event.start, "2026-11-02", ""]))
        .digest("hex"),
    );
    expect(await calendar("add", event)).toEqual(added);
    const timed = await calendar("add", { title: "Repeated hour", start: "2026-11-01T01:30:00" });
    expect(timed.id).toBe(
      NodeCrypto.createHash("sha256")
        .update(
          JSON.stringify([
            "Repeated hour",
            "2026-11-01T06:30:00.000Z",
            "2026-11-01T07:30:00.000Z",
            "",
          ]),
        )
        .digest("hex"),
    );
    await cli(
      "ticket",
      "create",
      "--input",
      JSON.stringify({
        threadId,
        group: "Read",
        title: "Calendar proposal",
        need: "Read the event.",
        summary: "```event\n" + JSON.stringify(event) + "\n```",
        markdown: "",
        choices: [],
        attachments: [],
        htmlPages: [],
      }),
    );
    const listed = await calendar("list", { start: "2026-11-01", end: "2026-11-02" });
    expect(listed.events).toEqual([added, timed]);
    await expect(calendar("add", { title: "Invalid day", start: "2026-02-30" })).rejects.toThrow();
    await expect(
      calendar("add", { title: "Invalid range", start: "2026-11-02", end: "2026-11-01" }),
    ).rejects.toThrow();
  });

  it("I2.attachment-versions: import, snapshot, annotate, create, read and restore through the CLI", async () => {
    const file = NodePath.join(home, "notes.txt");
    await NodeFSP.writeFile(file, "Original\n");
    const attachment = await cli(
      "attachment",
      "import",
      "--thread",
      threadId,
      "--file",
      file,
      "--mime-type",
      "text/plain",
    );
    expect(attachment.name).toBe("notes.txt");
    const versions = (input: Record<string, unknown>) =>
      cli("attachment", "versions", "--input", JSON.stringify({ threadId, attachment, ...input }));
    const original = await versions({ action: "read" });
    expect(Buffer.from(original.contentBase64, "base64").toString()).toBe("Original\n");
    expect(original.versions).toHaveLength(1);
    const notes = [{ id: "highlight", quote: "Original", comment: "Keep the introduction." }];
    const created = await versions({
      action: "create",
      contentBase64: Buffer.from("Updated\n").toString("base64"),
      notes,
    });
    expect(created.versions).toHaveLength(2);
    expect(created.versions[1]).toMatchObject({ author: "Ozi", notes });
    expect(created.versions[1].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number.isFinite(Date.parse(created.versions[1].createdAt))).toBe(true);
    const latest = await versions({ action: "read" });
    expect(Buffer.from(latest.contentBase64, "base64").toString()).toBe("Updated\n");
    const restored = await versions({ action: "restore", versionId: "original" });
    expect(restored.versions).toHaveLength(3);
    expect(restored.versions[2].notes).toEqual([]);
    const restoredRead = await versions({ action: "read" });
    expect(Buffer.from(restoredRead.contentBase64, "base64").toString()).toBe("Original\n");
    expect(await NodeFSP.readFile(original.sourcePath, "utf8")).toBe("Original\n");
    const previous = await versions({ action: "read", versionId: created.versions[1].id });
    expect(Buffer.from(previous.contentBase64, "base64").toString()).toBe("Updated\n");
  });
});
