import { describe, expect, test } from "bun:test";

import { browsersExpr, parseBrowsersCache, playwrightEnv } from "./nixos.ts";

describe("playwrightEnv", () => {
  const browsers = "/nix/store/abc-playwright-browsers";
  const fallback = "/sandbox/playwright-browsers";

  test("non-NixOS uses the sandbox fallback path", () => {
    expect(playwrightEnv(undefined, undefined, fallback)).toEqual({
      PLAYWRIGHT_BROWSERS_PATH: fallback,
    });
  });

  test("non-NixOS honours an explicit override", () => {
    expect(playwrightEnv(undefined, "/custom/path", fallback)).toEqual({
      PLAYWRIGHT_BROWSERS_PATH: "/custom/path",
    });
  });

  test("NixOS points at the nix bundle and skips download + host validation", () => {
    expect(playwrightEnv(browsers, undefined, fallback)).toEqual({
      PLAYWRIGHT_BROWSERS_PATH: browsers,
      PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
      PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS: "true",
    });
  });

  test("NixOS still honours an explicit override, without the skip vars", () => {
    expect(playwrightEnv(browsers, "/custom/path", fallback)).toEqual({
      PLAYWRIGHT_BROWSERS_PATH: "/custom/path",
    });
  });
});

describe("browsersExpr", () => {
  test("includes the headless shell playwright needs for default headless launches", () => {
    expect(browsersExpr("/nix/store/x-nixpkgs")).toContain("withChromiumHeadlessShell = true");
  });
});

describe("parseBrowsersCache", () => {
  const expr = browsersExpr("/nix/store/x-nixpkgs");
  const path = "/nix/store/y-playwright-browsers";

  test("round-trips a matching expression", () => {
    expect(parseBrowsersCache(`${expr}\n${path}\n`, expr)).toBe(path);
  });

  test("rejects a cache built from a different expression", () => {
    const other = browsersExpr("/nix/store/z-nixpkgs");
    expect(parseBrowsersCache(`${other}\n${path}\n`, expr)).toBeUndefined();
  });

  test("rejects the legacy path-only cache format", () => {
    expect(parseBrowsersCache(`${path}\n`, expr)).toBeUndefined();
  });
});
