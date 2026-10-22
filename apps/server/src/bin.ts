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
  const command = process.argv[2];
  if (
    [
      "status",
      "say",
      "steer",
      "stop",
      "thread",
      "wait",
      "pair",
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
