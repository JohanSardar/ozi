import * as NodeFSP from "node:fs/promises";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { _electron, type ElectronApplication, type Page } from "playwright";
import { expect, it } from "vite-plus/test";
import { startHarness, type Harness } from "./harness.ts";
import { startDesktopKeyring } from "./desktop.ts";

it("m1.remote-client desktop app uses the paired server with local off and persists its server choice", async () => {
  const remote = await startHarness();
  const closeKeyring = await startDesktopKeyring(remote).catch(async (error: unknown) => {
    await remote.close();
    throw error;
  });
  let other: Harness | undefined;
  let desktop: ElectronApplication | undefined;
  const desktopHome = NodePath.join(remote.root, "desktop");
  const settings = NodePath.join(desktopHome, "userdata/desktop-settings.json");
  const require = NodeModule.createRequire(
    new URL("../apps/desktop/package.json", import.meta.url),
  );
  const launch = async () => {
    desktop = await _electron.launch({
      executablePath: require("electron") as string,
      args: [
        NodeURL.fileURLToPath(new URL("../apps/desktop/dist-electron/boot.cjs", import.meta.url)),
        "--no-sandbox",
      ],
      env: {
        ...remote.env,
        ...(process.env.DISPLAY ? { DISPLAY: process.env.DISPLAY } : {}),
        ...(process.env.XAUTHORITY ? { XAUTHORITY: process.env.XAUTHORITY } : {}),
        OZI_HOME: desktopHome,
        OZI_DISABLE_AUTO_UPDATE: "true",
      },
      timeout: 30_000,
    });
    const page = await desktop.firstWindow();
    page.setDefaultTimeout(20_000);
    return page;
  };
  const pair = async (page: Page, h: Harness) => {
    const pairing = await h.ozi<{ url: string }>("pair");
    const url = new URL(pairing.url);
    const address = Object.values(NodeOS.networkInterfaces())
      .flat()
      .find((entry) => entry?.family === "IPv4" && !entry.internal)?.address;
    if (!address) throw new Error("No network address for desktop pairing");
    url.hostname = address;
    await page.getByRole("button", { name: "Add environment", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Add Environment", exact: true });
    await dialog.getByRole("textbox", { name: "Host", exact: true }).fill(url.toString());
    await dialog.getByRole("button", { name: "Add environment", exact: true }).click();
    await dialog.waitFor({ state: "hidden" }).catch(async (error: unknown) => {
      throw new Error(`${String(error)}\n${await dialog.innerText()}`);
    });
  };
  try {
    await remote.script([
      {
        match: "seed-remote-desktop",
        role: "main",
        steps: [
          {
            tool: {
              name: "delegate_task",
              arguments: {
                task: "desktop-remote-worker",
                title: "Remote desktop job",
                mode: "async",
                clientRequestId: "desktop-remote-job",
              },
            },
          },
          { say: "Your remote main is here" },
        ],
      },
      {
        match: "desktop-remote-worker",
        role: "worker",
        steps: [{ say: "Remote job is running" }, { wait: true }],
      },
      {
        match: "hello-from-desktop",
        role: "main",
        steps: [{ say: "Remote main received the desktop message" }],
      },
      {
        match: "desktop-job-message",
        role: "worker",
        steps: [{ say: "Remote job received the desktop message" }],
      },
    ]);
    await remote.ozi("say", "seed-remote-desktop");
    await remote.wait("ozi-main", "text:Your remote main is here", 30);
    const [job] = await remote.ozi<{ jobId: string }[]>("jobs");
    expect(job).toBeDefined();
    await remote.wait(job!.jobId, "text:Remote job is running", 30);
    await NodeFSP.mkdir(NodePath.dirname(settings), { recursive: true });
    await NodeFSP.writeFile(
      settings,
      JSON.stringify({ localEnvironmentEnabled: false, linuxPasswordStore: "gnome-libsecret" }),
    );
    let page = await launch();
    await page.getByRole("link", { name: "Connections", exact: true }).click();
    await pair(page, remote);
    await desktop!.close();
    page = await launch();
    const main = () => page.getByRole("region", { name: "Main conversation", exact: true });
    const jobs = () => page.getByRole("complementary", { name: "Jobs", exact: true });
    await main().getByText("Your remote main is here", { exact: true }).waitFor();
    await jobs().getByRole("button", { name: "Remote desktop job", exact: true }).waitFor();
    await page
      .getByRole("status")
      .filter({ hasText: / · Connected$/ })
      .waitFor();
    expect(await page.getByRole("region", { name: "Main conversation", exact: true }).count()).toBe(
      1,
    );
    await main()
      .getByRole("textbox", { name: "Message Ozi", exact: true })
      .fill("hello-from-desktop");
    await main().getByRole("button", { name: "Submit message", exact: true }).click();
    await remote.wait("ozi-main", "text:Remote main received the desktop message", 30);
    await main().getByText("Remote main received the desktop message", { exact: true }).waitFor();
    await jobs().getByRole("button", { name: "Remote desktop job", exact: true }).click();
    const drawer = page.getByRole("complementary", { name: "Job details" });
    await drawer.getByText("Remote job is running", { exact: true }).waitFor();
    await drawer
      .getByRole("textbox", { name: "Message this job", exact: true })
      .fill("desktop-job-message");
    await drawer.getByRole("combobox", { name: "When to send" }).selectOption("steer");
    await drawer.getByRole("button", { name: "Submit message", exact: true }).click();
    await remote.wait(job!.jobId, "text:Remote job received the desktop message", 30);
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByRole("link", { name: "Connections", exact: true }).click();
    other = await startHarness();
    await other.script([{ match: "second-remote", steps: [{ say: "The second remote main" }] }]);
    await other.ozi("say", "second-remote");
    await other.wait("ozi-main", "text:The second remote main", 30);
    await pair(page, other);
    const picker = page.getByRole("combobox", { name: "Ozi server", exact: true });
    const choices = await picker
      .locator("option")
      .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
    expect(choices).toHaveLength(2);
    expect(await picker.inputValue()).toBe(choices[0]);
    await picker.selectOption(choices[1]!);
    await page.getByRole("link", { name: "← Ozi", exact: true }).click();
    await main().getByText("The second remote main", { exact: true }).waitFor();
    expect(
      await jobs().getByRole("button", { name: "Remote desktop job", exact: true }).count(),
    ).toBe(0);
    expect(await drawer.count()).toBe(0);
    await desktop!.close();
    await NodeFSP.writeFile(
      settings,
      JSON.stringify({ localEnvironmentEnabled: true, linuxPasswordStore: "gnome-libsecret" }),
    );
    await NodeFSP.copyFile(
      NodePath.join(remote.home, "userdata/settings.json"),
      NodePath.join(desktopHome, "userdata/settings.json"),
    );
    page = await launch();
    await main().getByText("The second remote main", { exact: true }).waitFor();
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByRole("link", { name: "Connections", exact: true }).click();
    expect(
      await page.getByRole("switch", { name: "Local environment", exact: true }).isChecked(),
    ).toBe(true);
    expect(await page.getByRole("combobox", { name: "Ozi server", exact: true }).inputValue()).toBe(
      choices[1],
    );
    await page.getByRole("link", { name: "← Ozi", exact: true }).click();
    await other.stop();
    await page
      .getByRole("status")
      .filter({ hasText: / · (Reconnecting|Connection failed|Offline)/ })
      .waitFor();
    await main().getByText("The second remote main", { exact: true }).waitFor();
    await main()
      .getByRole("textbox", { name: "Message Ozi", exact: true })
      .fill("must-not-send-offline");
    expect(
      await main().getByRole("button", { name: "Submit message", exact: true }).isDisabled(),
    ).toBe(true);
    expect(await main().getByText("Your remote main is here", { exact: true }).count()).toBe(0);
  } finally {
    await desktop?.close();
    await other?.close();
    await closeKeyring();
    await remote.close();
  }
}, 300_000);
