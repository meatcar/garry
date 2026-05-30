import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { $ } from "bun";

import { paths } from "./paths.ts";

const BROWSERS_CACHE = join(paths.root, "playwright-browsers-path");

let nixOSCache: boolean | undefined;

export function isNixOS(): boolean {
  if (nixOSCache === undefined) {
    nixOSCache =
      existsSync("/etc/os-release") && readFileSync("/etc/os-release", "utf8").includes("ID=nixos");
  }
  return nixOSCache;
}

// nixpkgs source pinned to gstack's Playwright version, injected by the flake
// wrapper from the `nixpkgs-playwright` input (see flake.nix).
function nixpkgsPath(): string {
  const path = process.env.GARRY_PLAYWRIGHT_NIXPKGS;
  if (!path?.startsWith("/nix/store/")) {
    throw new Error("GARRY_PLAYWRIGHT_NIXPKGS is unset — install garry via its Nix flake on NixOS.");
  }
  return path;
}

let browsersPathCache: string | undefined;

// gstack drives a headless Chromium daemon, so the chromium-only bundle suffices.
export async function buildPlaywrightBrowsers(): Promise<string> {
  if (browsersPathCache) {
    return browsersPathCache;
  }

  const cached = readCachedBrowsersPath();
  if (cached) {
    return (browsersPathCache = cached);
  }

  const expr = `(import ${nixpkgsPath()} { }).playwright-driver.browsers-chromium`;
  const result = await $`nix-build --no-out-link -E ${expr}`.quiet();
  const path = result.stdout.toString().trim().split("\n").pop() ?? "";
  if (!path.startsWith("/nix/store/")) {
    throw new Error(`nix-build did not return a store path: ${path}`);
  }
  cacheBrowsersPath(path);
  return (browsersPathCache = path);
}

// Cache the store path in-process and on disk; a stale entry (rev bumped, path
// GC'd) fails the existsSync check and falls back to a fresh nix-build.
function readCachedBrowsersPath(): string | undefined {
  try {
    const path = readFileSync(BROWSERS_CACHE, "utf8").trim();
    if (path.startsWith("/nix/store/") && existsSync(path)) {
      return path;
    }
  } catch {
    // No cache yet.
  }
  return undefined;
}

function cacheBrowsersPath(path: string): void {
  try {
    writeFileSync(BROWSERS_CACHE, `${path}\n`);
  } catch {
    // Best effort.
  }
}
