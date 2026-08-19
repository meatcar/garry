import { afterEach, describe, expect, mock, test } from "bun:test";

import {
  type Pin,
  applyFlakePin,
  compareSemver,
  findNixpkgsRev,
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

describe("findNixpkgsRev", () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  type HistoryEntry = string | { body: string; status?: number };

  function mockNixpkgsHistory(entries: HistoryEntry[]): void {
    globalThis.fetch = Object.assign(
      mock(async (input: string | URL | Request) => {
        const url = input.toString();
        if (url.includes("api.github.com")) {
          return Response.json(entries.map((_, index) => ({ sha: `rev-${index}` })));
        }
        const rev = url.match(/\/rev-(\d+)\//)?.[1];
        if (rev === undefined) {
          throw new Error(`unexpected URL: ${url}`);
        }
        const entry = entries[Number(rev)];
        if (typeof entry === "string") {
          return new Response(`{ version = "${entry}"; }`);
        }
        return new Response(entry?.body, { status: entry?.status });
      }),
      { preconnect: realFetch.preconnect },
    );
  }

  test("returns no revision while nixpkgs is still behind", async () => {
    mockNixpkgsHistory(["1.61.1"]);
    expect(await findNixpkgsRev("1.62.1")).toBeUndefined();
  });

  test("finds the exact version in newer-first history", async () => {
    mockNixpkgsHistory(["1.63.0", "1.62.1"]);
    expect(await findNixpkgsRev("1.62.1")).toBe("rev-1");
  });

  test("fails when nixpkgs advanced past the requested version", async () => {
    mockNixpkgsHistory(["1.63.0", "1.61.1"]);
    await expect(findNixpkgsRev("1.62.1")).rejects.toThrow("history crossed");
  });

  test("fails when a driver file request fails", async () => {
    mockNixpkgsHistory([{ body: "server error", status: 500 }, "1.61.1"]);
    await expect(findNixpkgsRev("1.62.1")).rejects.toThrow("GitHub request failed (500)");
  });

  test("fails when a driver version cannot be parsed", async () => {
    mockNixpkgsHistory([{ body: '{ pname = "playwright-driver"; }' }, "1.61.1"]);
    await expect(findNixpkgsRev("1.62.1")).rejects.toThrow("could not parse");
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
