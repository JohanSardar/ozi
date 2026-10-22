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
  const { attachConsoleStdin } = await import("./cli/consoleStdin.ts");
  attachConsoleStdin();
  const { runCli } = await import("./binCli.ts");
  runCli();
}
