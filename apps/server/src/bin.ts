import { isEntrypoint } from "./entrypoint.ts";

if (
  isEntrypoint({
    moduleUrl: import.meta.url,
    entryPath: process.argv[1],
    runtimeMain: import.meta.main,
  })
) {
  const { ignoreMacosTypeOfServiceEinval } = await import("./outboundHttp.ts");
  ignoreMacosTypeOfServiceEinval();
  if (process.argv[2] === "-p" || process.argv[2] === "--print") process.argv[2] = "print";
  const command = process.argv[2];
  const args = process.argv.slice(2);
  if (command === "pi") {
    const { runPi } = await import("./binPi.ts");
    runPi(args.slice(1));
  } else if (
    process.stdin.isTTY &&
    process.stdout.isTTY &&
    (args.length === 0 || (args.length === 2 && ["--home", "--base-dir"].includes(args[0]!)))
  ) {
    const { runTuiCli } = await import("./binTui.ts");
    runTuiCli();
  } else if (
    [
      "status",
      "say",
      "print",
      "main",
      "steer",
      "stop",
      "thread",
      "wait",
      "pair",
      "connect",
      "disconnect",
      "request",
      "jobs",
      "job",
      "answer",
      "close",
      "checks",
      "schedules",
      "schedule",
      "todos",
      "test-clock",
    ].includes(command ?? "")
  ) {
    const { runClientCli } = await import("./binClientCli.ts");
    runClientCli();
  } else {
    const { attachConsoleStdin } = await import("./cli/consoleStdin.ts");
    attachConsoleStdin();
    const { runCli } = await import("./binCli.ts");
    runCli();
  }
}
