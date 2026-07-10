import { describe, expect, test } from "bun:test";

import { playwrightEnv } from "./nixos.ts";

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
