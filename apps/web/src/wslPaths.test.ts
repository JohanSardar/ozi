import { describe, expect, it } from "vite-plus/test";

import {
  applyWslEnvironmentConfiguration,
  parseWslUncPath,
  resolveWslPathSelection,
} from "./wslPaths";

describe("parseWslUncPath", () => {
  it("parses wsl.localhost UNC paths into distro and POSIX path", () => {
    expect(parseWslUncPath("\\\\wsl.localhost\\Ubuntu-22.04\\home\\josh\\repo")).toEqual({
      distro: "Ubuntu-22.04",
      linuxPath: "/home/josh/repo",
    });
  });

  it("rejects non-WSL paths and invalid distro names", () => {
    expect(parseWslUncPath("C:\\Users\\Josh\\repo")).toBeNull();
    expect(parseWslUncPath("\\\\wsl.localhost\\bad!name\\home")).toBeNull();
  });
});

describe("resolveWslPathSelection", () => {
  it("routes a UNC path to the matching WSL backend", () => {
    expect(
      resolveWslPathSelection("\\\\wsl.localhost\\Ubuntu\\home\\theo\\repo", [
        { environmentId: "env-debian", backendId: "wsl:Debian", runningDistro: null },
        { environmentId: "env-ubuntu", backendId: "wsl:Ubuntu", runningDistro: null },
      ]),
    ).toEqual({
      distro: "Ubuntu",
      environmentId: "env-ubuntu",
      linuxPath: "/home/theo/repo",
    });
  });

  it("does not route to a sole WSL backend for a different distro", () => {
    expect(
      resolveWslPathSelection("\\\\wsl.localhost\\Debian\\home\\theo\\repo", [
        { environmentId: "env-ubuntu", backendId: "wsl:Ubuntu", runningDistro: null },
      ]),
    ).toBeNull();
  });

  it("routes a default backend only to the distro used by its running process", () => {
    const candidates = [
      { environmentId: "env-wsl", backendId: "wsl:default", runningDistro: "Debian" },
    ];

    expect(
      resolveWslPathSelection("\\\\wsl.localhost\\Debian\\home\\theo\\repo", candidates),
    ).toEqual({
      distro: "Debian",
      environmentId: "env-wsl",
      linuxPath: "/home/theo/repo",
    });
    expect(
      resolveWslPathSelection("\\\\wsl.localhost\\Ubuntu\\home\\theo\\repo", candidates),
    ).toBeNull();
  });
});

describe("applyWslEnvironmentConfiguration", () => {
  const ubuntuConfiguration = {
    enabled: true,
    wslOnly: false,
    distro: null,
    distros: [
      { name: "Debian", isDefault: false },
      { name: "Ubuntu", isDefault: true },
    ],
  };

  it("does not replace a live default backend's running distro from current configuration", () => {
    const candidates = applyWslEnvironmentConfiguration(
      [{ environmentId: "env-wsl", backendId: "wsl:default", runningDistro: "Debian" }],
      "env-primary",
      ubuntuConfiguration,
    );

    expect(
      resolveWslPathSelection("\\\\wsl.localhost\\Ubuntu\\home\\theo\\repo", candidates),
    ).toBeNull();
    expect(
      resolveWslPathSelection("\\\\wsl.localhost\\Debian\\home\\theo\\repo", candidates),
    ).toEqual({
      distro: "Debian",
      environmentId: "env-wsl",
      linuxPath: "/home/theo/repo",
    });
  });

  it("represents an explicitly configured WSL-only primary by its distro", () => {
    expect(
      applyWslEnvironmentConfiguration([], "env-primary", {
        ...ubuntuConfiguration,
        wslOnly: true,
        distro: "ubuntu",
      }),
    ).toEqual([{ environmentId: "env-primary", backendId: "wsl:Ubuntu", runningDistro: "Ubuntu" }]);
  });

  it("uses the live primary distro for a default-tracking WSL-only primary", () => {
    const candidates = applyWslEnvironmentConfiguration(
      [],
      "env-primary",
      {
        ...ubuntuConfiguration,
        wslOnly: true,
        distros: [],
      },
      "Ubuntu",
    );

    expect(candidates).toEqual([
      { environmentId: "env-primary", backendId: "wsl:default", runningDistro: "Ubuntu" },
    ]);
    expect(
      resolveWslPathSelection("\\\\wsl.localhost\\Ubuntu\\home\\theo\\repo", candidates),
    ).toEqual({
      distro: "Ubuntu",
      environmentId: "env-primary",
      linuxPath: "/home/theo/repo",
    });
  });
});
