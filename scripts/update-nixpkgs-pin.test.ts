import { describe, expect, test } from "bun:test";

import {
  type Pin,
  applyFlakePin,
  compareSemver,
  lockedRev,
  parseDriverVersion,
  parseGstackPlaywrightVersion,
  readFlakePin,
} from "./update-nixpkgs-pin.ts";

const SAMPLE_PKG = JSON.stringify({
  name: "gstack",
  dependencies: { playwright: "^1.58.2", "puppeteer-core": "^24.40.0" },
});

describe("parseGstackPlaywrightVersion", () => {
  test("extracts the playwright version, stripping the range operator", () => {
    expect(parseGstackPlaywrightVersion(SAMPLE_PKG)).toBe("1.58.2");
  });

  test("handles a bare (operator-less) version", () => {
    expect(parseGstackPlaywrightVersion('{"dependencies":{"playwright":"1.59.1"}}')).toBe("1.59.1");
  });

  test("throws when no playwright dependency is present", () => {
    expect(() => parseGstackPlaywrightVersion('{"dependencies":{}}')).toThrow();
  });
});

describe("parseDriverVersion", () => {
  test("reads the version field from driver.nix", () => {
    expect(parseDriverVersion('{ ... version = "1.58.2"; ... }')).toBe("1.58.2");
  });

  test("returns undefined when absent", () => {
    expect(parseDriverVersion('{ pname = "x"; }')).toBeUndefined();
  });
});

describe("compareSemver", () => {
  test("orders versions numerically, not lexically", () => {
    expect(compareSemver("1.58.2", "1.59.1")).toBeLessThan(0);
    expect(compareSemver("1.59.1", "1.58.2")).toBeGreaterThan(0);
    expect(compareSemver("1.9.0", "1.10.0")).toBeLessThan(0); // lexical would be wrong
    expect(compareSemver("1.58.2", "1.58.2")).toBe(0);
  });
});

const SAMPLE_FLAKE = `{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    # gstack-playwright-version: 1.58.2
    # Pinned so playwright-driver matches gstack's Playwright version. The
    # update-pin workflow keeps marker + rev + lock in sync.
    nixpkgs-playwright.url = "github:NixOS/nixpkgs/7f6a6fb1c76e09426d6125e7e2543efe2a7f74e3";
  };
}`;

describe("readFlakePin / applyFlakePin", () => {
  test("reads the marker version and pinned rev", () => {
    expect(readFlakePin(SAMPLE_FLAKE)).toEqual({
      rev: "7f6a6fb1c76e09426d6125e7e2543efe2a7f74e3",
      playwrightVersion: "1.58.2",
    });
  });

  test("rewrites both fields and round-trips through readFlakePin", () => {
    const next: Pin = {
      rev: "abcdef0123456789abcdef0123456789abcdef01",
      playwrightVersion: "1.60.0",
    };
    const updated = applyFlakePin(SAMPLE_FLAKE, next);
    expect(readFlakePin(updated)).toEqual(next);
    // Only the pin lines change; the plain nixpkgs input is untouched.
    expect(updated).toContain('nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable"');
    expect(updated).toContain("keeps marker + rev + lock in sync");
  });

  test("the real flake.nix carries a parseable pin", async () => {
    const flake = await Bun.file(new URL("../flake.nix", import.meta.url)).text();
    const pin = readFlakePin(flake);
    expect(pin.rev).toMatch(/^[0-9a-f]{40}$/);
    expect(pin.playwrightVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("lockedRev", () => {
  test("reads the locked nixpkgs-playwright rev", () => {
    const lock = JSON.stringify({
      nodes: { "nixpkgs-playwright": { locked: { rev: "7f6a6fb1c76e09426d6125e7e2543efe2a7f74e3" } } },
    });
    expect(lockedRev(lock)).toBe("7f6a6fb1c76e09426d6125e7e2543efe2a7f74e3");
  });

  test("returns undefined when the input is missing", () => {
    expect(lockedRev('{"nodes":{}}')).toBeUndefined();
  });

  test("the real flake.lock matches the flake.nix pin", async () => {
    const flake = await Bun.file(new URL("../flake.nix", import.meta.url)).text();
    const lock = await Bun.file(new URL("../flake.lock", import.meta.url)).text();
    expect(lockedRev(lock)).toBe(readFlakePin(flake).rev);
  });
});
