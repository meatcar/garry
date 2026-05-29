import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type NixPlaywright, pinPlaywrightVersion, playwrightEnv } from "./nixos.ts";

function tmpGstack(pkg: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "garry-test-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkg, null, 2));
  return dir;
}

describe("pinPlaywrightVersion", () => {
  test("rewrites a mismatched playwright dependency and reports a change", () => {
    const dir = tmpGstack({
      name: "gstack",
      dependencies: { playwright: "^1.58.2", "puppeteer-core": "^24.40.0" },
    });
    try {
      expect(pinPlaywrightVersion(dir, "1.55.0")).toBe(true);
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      expect(pkg.dependencies.playwright).toBe("1.55.0");
      // Other dependencies are left untouched.
      expect(pkg.dependencies["puppeteer-core"]).toBe("^24.40.0");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("is a no-op when the version already matches", () => {
    const dir = tmpGstack({ name: "gstack", dependencies: { playwright: "1.55.0" } });
    try {
      expect(pinPlaywrightVersion(dir, "1.55.0")).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("adds a dependencies block when none exists", () => {
    const dir = tmpGstack({ name: "gstack" });
    try {
      expect(pinPlaywrightVersion(dir, "1.55.0")).toBe(true);
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      expect(pkg.dependencies.playwright).toBe("1.55.0");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("returns false when package.json is missing", () => {
    expect(pinPlaywrightVersion(join(tmpdir(), "garry-does-not-exist-xyz"), "1.55.0")).toBe(false);
  });
});

describe("playwrightEnv", () => {
  const nix: NixPlaywright = { browsers: "/nix/store/abc-playwright-browsers", version: "1.55.0" };

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
    expect(playwrightEnv(nix, undefined, "/sandbox/playwright-browsers")).toEqual({
      PLAYWRIGHT_BROWSERS_PATH: "/nix/store/abc-playwright-browsers",
      PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
      PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS: "true",
    });
  });

  test("NixOS still honours an explicit browsers-path override", () => {
    expect(playwrightEnv(nix, "/custom/path", "/sandbox/playwright-browsers")).toMatchObject({
      PLAYWRIGHT_BROWSERS_PATH: "/custom/path",
    });
  });
});
