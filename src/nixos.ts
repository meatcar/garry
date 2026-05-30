import { existsSync, readFileSync } from "node:fs";

import { $ } from "bun";

// Pinned nixpkgs revision whose `playwright-driver` matches the Playwright
// version gstack uses. The browser revisions are tied to the Playwright
// version, so this pin must track gstack's version.
//
// Kept current automatically: Renovate (renovate.json) watches gstack's
// package.json and bumps `playwrightVersion` here; the complete-nixpkgs-pin
// workflow then fills in the matching `rev` + `sha256`. To do it by hand, run
// `bun run update-pin` (requires Nix).
export const NIXPKGS_PIN = {
  rev: "0f2be1f70b1fb91a99fe21b3820a39bbf5c11e16",
  sha256: "119g85pw1b8cn2gxldg35vp0r1mx9ynxs1gl9rsydmyw8i8kr1x0",
  // The playwright-driver version at this rev — i.e. the gstack Playwright
  // version this pin is good for.
  playwrightVersion: "1.58.2",
} as const;

export function isNixOS(): boolean {
  if (!existsSync("/etc/os-release")) {
    return false;
  }
  return readFileSync("/etc/os-release", "utf8").includes("ID=nixos");
}

// Realise the Playwright browser bundle from the pinned nixpkgs. These browsers
// are already patched for NixOS, so gstack's Playwright can use them directly
// instead of downloading its own Chromium and hunting for shared libraries.
// Pinning nixpkgs (rather than the user's channel) keeps the browser revision
// matched to gstack's locked Playwright version without touching gstack.
export async function nixPlaywrightBrowsers(): Promise<string> {
  const expr = `with import (fetchTarball {
    url = "https://github.com/NixOS/nixpkgs/archive/${NIXPKGS_PIN.rev}.tar.gz";
    sha256 = "${NIXPKGS_PIN.sha256}";
  }) {}; playwright-driver.browsers`;
  const result = await $`nix-build --no-out-link -E ${expr}`.quiet();
  const path = result.stdout.toString().trim().split("\n").pop() ?? "";
  if (!path.startsWith("/nix/store/")) {
    throw new Error(`nix-build did not return a store path: ${path}`);
  }
  return path;
}

// The Playwright version gstack actually installed, read from its node_modules.
// Used to warn when gstack has drifted away from the pinned nixpkgs version.
export function gstackPlaywrightVersion(gstackDir: string): string | undefined {
  const pkgPath = `${gstackDir}/node_modules/playwright/package.json`;
  if (!existsSync(pkgPath)) {
    return undefined;
  }
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
  return pkg.version;
}

// Build the Playwright-related environment. On NixOS we point at the nix browser
// bundle and skip the download / host-requirement checks, since the bundle is
// already present and patched. Elsewhere we keep browsers inside the sandbox. An
// explicit PLAYWRIGHT_BROWSERS_PATH override always wins.
export function playwrightEnv(
  browsers: string | undefined,
  override: string | undefined,
  fallbackPath: string,
): Record<string, string> {
  if (browsers) {
    return {
      PLAYWRIGHT_BROWSERS_PATH: override ?? browsers,
      PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
      PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS: "true",
    };
  }
  return { PLAYWRIGHT_BROWSERS_PATH: override ?? fallbackPath };
}
