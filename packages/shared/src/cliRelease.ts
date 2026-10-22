const CLI_RELEASE_REPOSITORY = "pingdotgg/t3code";

/**
 * Kept in step with the build_linux_cli matrix, build_windows_arm64_cli, and
 * the `cli_archive` rows in .github/workflows/release.yml: a key here without a
 * build there produces download URLs that 404, and a build there without a key
 * here is unreachable from every installer.
 */
// No darwin-x64: Node single-executables are unsupported on x64 macOS (the
// SEA docs list macOS as arm64 only) and the binary segfaults on start.
const CLI_ARCHIVE_PLATFORM_KEYS = [
  "darwin-arm64",
  "linux-arm64",
  "linux-x64",
  "win32-arm64",
  "win32-x64",
] as const;
export type CliArchivePlatformKey = (typeof CLI_ARCHIVE_PLATFORM_KEYS)[number];

/**
 * Windows ships bsdtar in System32, which reads both formats; a Git-for-Windows
 * GNU tar earlier on PATH cannot open the zip, so the system copy is named by
 * absolute path.
 */
export function cliArchiveTarCommand(
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>,
): string {
  if (platform !== "win32") return "tar";
  const systemRoot = env["SystemRoot"] ?? env["windir"] ?? "C:\\Windows";
  return `${systemRoot}\\System32\\tar.exe`;
}

const CLI_RELEASE_DEFAULT_BASE_URL = `https://github.com/${CLI_RELEASE_REPOSITORY}/releases/download`;

export function cliReleaseDownloadBaseUrl(
  version: string,
  baseUrl: string | undefined = CLI_RELEASE_DEFAULT_BASE_URL,
): string {
  return `${(baseUrl?.trim() || CLI_RELEASE_DEFAULT_BASE_URL).replace(/\/+$/, "")}/v${version}`;
}

export type CliReleaseChannel = "stable" | "nightly" | "preview";
