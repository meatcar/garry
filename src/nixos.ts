import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { $ } from "bun";

export interface NixPlaywright {
  // /nix/store path to nixpkgs' pre-patched Playwright browser bundle.
  browsers: string;
  // The Playwright version those browsers were built for. gstack must install
  // exactly this npm version or it will look for a browser revision the bundle
  // doesn't contain.
  version: string;
}

export function isNixOS(): boolean {
  if (!existsSync("/etc/os-release")) {
    return false;
  }
  return readFileSync("/etc/os-release", "utf8").includes("ID=nixos");
}

// Realise nixpkgs' Playwright browser bundle. These browsers are already
// patched for NixOS, so gstack's Playwright can use them directly instead of
// downloading its own Chromium and hunting for shared libraries.
async function buildPlaywrightBrowsers(): Promise<string> {
  const result =
    await $`nix-build --no-out-link -E ${"with import <nixpkgs> {}; playwright-driver.browsers"}`.quiet();
  const path = result.stdout.toString().trim().split("\n").pop() ?? "";
  if (!path.startsWith("/nix/store/")) {
    throw new Error(`nix-build did not return a store path: ${path}`);
  }
  return path;
}

// The Playwright version packaged in nixpkgs. The browser revisions are tied to
// this version, so gstack's npm playwright must match it.
async function playwrightVersion(): Promise<string> {
  const result =
    await $`nix-instantiate --eval --json -E ${"(import <nixpkgs> {}).playwright-driver.version"}`.quiet();
  const raw = result.stdout.toString().trim();
  const version = JSON.parse(raw) as unknown;
  if (typeof version !== "string" || version.length === 0) {
    throw new Error(`could not read nixpkgs playwright-driver version: ${raw}`);
  }
  return version;
}

export async function resolveNixPlaywright(): Promise<NixPlaywright> {
  const [browsers, version] = await Promise.all([buildPlaywrightBrowsers(), playwrightVersion()]);
  return { browsers, version };
}

// Pin gstack's playwright dependency to the nixpkgs version so `bun install`
// resolves the browser revision the nix bundle provides. Returns true if
// package.json was changed (i.e. the lockfile is now stale and gstack's
// `--frozen-lockfile || install` will fall back to a fresh install).
export function pinPlaywrightVersion(gstackDir: string, version: string): boolean {
  const pkgPath = `${gstackDir}/package.json`;
  if (!existsSync(pkgPath)) {
    return false;
  }

  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
    dependencies?: Record<string, string>;
  };
  if (pkg.dependencies?.playwright === version) {
    return false;
  }

  pkg.dependencies = { ...pkg.dependencies, playwright: version };
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  return true;
}

// Build the Playwright-related environment. On NixOS we point at the nix
// browser bundle and skip the download / host-requirement checks, since the
// bundle is already present and patched. Elsewhere we keep browsers inside the
// sandbox. An explicit PLAYWRIGHT_BROWSERS_PATH override always wins.
export function playwrightEnv(
  nix: NixPlaywright | undefined,
  override: string | undefined,
  fallbackPath: string,
): Record<string, string> {
  if (nix) {
    return {
      PLAYWRIGHT_BROWSERS_PATH: override ?? nix.browsers,
      PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
      PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS: "true",
    };
  }
  return { PLAYWRIGHT_BROWSERS_PATH: override ?? fallbackPath };
}
