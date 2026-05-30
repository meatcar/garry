import { describe, expect, test } from "bun:test";

import {
  type Pin,
  applyPin,
  compareSemver,
  parseDriverVersion,
  parseGstackPlaywrightVersion,
  readCurrentPin,
} from "./update-nixpkgs-pin.ts";

const SAMPLE_LOCK = `{
  "lockfileVersion": 1,
  "packages": {
    "playwright": ["playwright@1.58.2", "", { "dependencies": { "playwright-core": "1.58.2" } }, "sha512-xxx"],
    "playwright-core": ["playwright-core@1.58.2", "", {}, "sha512-yyy"],
  }
}`;

describe("parseGstackPlaywrightVersion", () => {
  test("extracts the locked playwright version", () => {
    expect(parseGstackPlaywrightVersion(SAMPLE_LOCK)).toBe("1.58.2");
  });

  test("throws when no playwright entry is present", () => {
    expect(() => parseGstackPlaywrightVersion('{"packages":{}}')).toThrow();
  });
});

describe("parseDriverVersion", () => {
  test("reads the version field from driver.nix", () => {
    expect(parseDriverVersion('{ ... version = "1.58.2"; ... }')).toBe("1.58.2");
  });

  test("returns undefined when absent", () => {
    expect(parseDriverVersion("{ pname = \"x\"; }")).toBeUndefined();
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

const SAMPLE_NIXOS_TS = `export const NIXPKGS_PIN = {
  rev: "0f2be1f70b1fb91a99fe21b3820a39bbf5c11e16",
  sha256: "119g85pw1b8cn2gxldg35vp0r1mx9ynxs1gl9rsydmyw8i8kr1x0",
  // a comment
  playwrightVersion: "1.58.2",
} as const;`;

describe("readCurrentPin / applyPin", () => {
  test("reads the current pin fields", () => {
    expect(readCurrentPin(SAMPLE_NIXOS_TS)).toEqual({
      rev: "0f2be1f70b1fb91a99fe21b3820a39bbf5c11e16",
      sha256: "119g85pw1b8cn2gxldg35vp0r1mx9ynxs1gl9rsydmyw8i8kr1x0",
      playwrightVersion: "1.58.2",
    });
  });

  test("rewrites all three fields and round-trips through readCurrentPin", () => {
    const next: Pin = {
      rev: "abcdef0123456789abcdef0123456789abcdef01",
      sha256: "0000000000000000000000000000000000000000000000000000",
      playwrightVersion: "1.60.0",
    };
    const updated = applyPin(SAMPLE_NIXOS_TS, next);
    expect(readCurrentPin(updated)).toEqual(next);
    // Surrounding structure (comment, `as const`) is preserved.
    expect(updated).toContain("// a comment");
    expect(updated).toContain("} as const;");
  });
});
