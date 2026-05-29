import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NIXPKGS_PIN, gstackPlaywrightVersion, playwrightEnv } from "./nixos.ts";

function tmpGstackWithPlaywright(version: string | undefined): string {
  const dir = mkdtempSync(join(tmpdir(), "garry-test-"));
  if (version !== undefined) {
    const pwDir = join(dir, "node_modules", "playwright");
    mkdirSync(pwDir, { recursive: true });
    writeFileSync(join(pwDir, "package.json"), JSON.stringify({ name: "playwright", version }));
  }
  return dir;
}

describe("NIXPKGS_PIN", () => {
  test("carries a rev, a base32 sha256, and the target playwright version", () => {
    expect(NIXPKGS_PIN.rev).toMatch(/^[0-9a-f]{40}$/);
    expect(NIXPKGS_PIN.sha256).toMatch(/^[0-9a-z]{52}$/);
    expect(NIXPKGS_PIN.playwrightVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("gstackPlaywrightVersion", () => {
  test("reads the installed playwright version from node_modules", () => {
    const dir = tmpGstackWithPlaywright("1.58.2");
    try {
      expect(gstackPlaywrightVersion(dir)).toBe("1.58.2");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("returns undefined when playwright is not installed", () => {
    const dir = tmpGstackWithPlaywright(undefined);
    try {
      expect(gstackPlaywrightVersion(dir)).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("playwrightEnv", () => {
  const browsers = "/nix/store/abc-playwright-browsers";

  test("non-NixOS uses the sandbox fallback path", () => {
    expect(playwrightEnv(undefined, undefined, "/sandbox/playwright-browsers")).toEqual({
      PLAYWRIGHT_BROWSERS_PATH: "/sandbox/playwright-browsers",
    });
  });

  test("non-NixOS honours an explicit override", () => {
    expect(playwrightEnv(undefined, "/custom/path", "/sandbox/playwright-browsers")).toEqual({
      PLAYWRIGHT_BROWSERS_PATH: "/custom/path",
    });
  });

  test("NixOS points at the nix bundle and skips download + host validation", () => {
    expect(playwrightEnv(browsers, undefined, "/sandbox/playwright-browsers")).toEqual({
      PLAYWRIGHT_BROWSERS_PATH: "/nix/store/abc-playwright-browsers",
      PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
      PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS: "true",
    });
  });

  test("NixOS still honours an explicit browsers-path override", () => {
    expect(playwrightEnv(browsers, "/custom/path", "/sandbox/playwright-browsers")).toMatchObject({
      PLAYWRIGHT_BROWSERS_PATH: "/custom/path",
    });
  });
});
