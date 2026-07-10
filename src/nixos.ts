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

// Playwright's prebuilt Chromium can't run against NixOS' non-FHS libraries, so
// on NixOS (nixBrowsers set) point Playwright at the nixpkgs bundle and skip the
// download + host validation. An explicit override wins on every platform.
export function playwrightEnv(
  nixBrowsers: string | undefined,
  override: string | undefined,
  fallback: string,
): Record<string, string> {
  if (override) {
    return { PLAYWRIGHT_BROWSERS_PATH: override };
  }
  if (nixBrowsers) {
    return {
      PLAYWRIGHT_BROWSERS_PATH: nixBrowsers,
      PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
      PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS: "true",
    };
  }
  return { PLAYWRIGHT_BROWSERS_PATH: fallback };
}

let browsersPathCache: string | undefined;

// gstack drives a headless Chromium daemon, so the chromium-only bundle suffices —
// but browsers-chromium ships without the headless shell, which playwright's default
// headless launch requires, so flip it back on.
export function browsersExpr(nixpkgs: string): string {
  return `(import ${nixpkgs} { }).playwright-driver.browsers-chromium.override { withChromiumHeadlessShell = true; }`;
}

export async function buildPlaywrightBrowsers(): Promise<string> {
  if (browsersPathCache) {
    return browsersPathCache;
  }

  const expr = browsersExpr(nixpkgsPath());
  const cached = readCachedBrowsersPath(expr);
  if (cached) {
    return (browsersPathCache = cached);
  }

  const result = await $`nix-build --no-out-link -E ${expr}`.quiet();
  const path = result.stdout.toString().trim().split("\n").pop() ?? "";
  if (!path.startsWith("/nix/store/")) {
    throw new Error(`nix-build did not return a store path: ${path}`);
  }
  cacheBrowsersPath(expr, path);
  return (browsersPathCache = path);
}

// Cache format: the expression that produced the path, then the path. Keying on
// the expression invalidates the cache when the pin OR the bundle expression
// changes — the old store path can outlive both, so existsSync alone is not enough.
export function parseBrowsersCache(text: string, expr: string): string | undefined {
  const [cachedExpr, path] = text.split("\n");
  if (cachedExpr === expr && path?.startsWith("/nix/store/")) {
    return path;
  }
  return undefined;
}

function readCachedBrowsersPath(expr: string): string | undefined {
  try {
    const path = parseBrowsersCache(readFileSync(BROWSERS_CACHE, "utf8"), expr);
    if (path && existsSync(path)) {
      return path;
    }
  } catch {
    // No cache yet.
  }
  return undefined;
}

function cacheBrowsersPath(expr: string, path: string): void {
  try {
    writeFileSync(BROWSERS_CACHE, `${expr}\n${path}\n`);
  } catch {
    // Best effort.
  }
}
