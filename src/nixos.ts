import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { $ } from "bun";

import { paths } from "./paths.ts";

const CHROMIUM_DEPS_EXPR = `with import <nixpkgs> {}; symlinkJoin {
  name = "garry-chromium-deps";
  paths = with pkgs; [
    glib.out nss nspr atk at-spi2-atk cups.lib dbus.lib libdrm
    gtk3 pango.out cairo.out libxkbcommon mesa expat libxcb
    alsa-lib.out at-spi2-core libxshmfence
    xorg.libX11 xorg.libXcomposite xorg.libXdamage xorg.libXext
    xorg.libXfixes xorg.libXrandr xorg.libxcb gdk-pixbuf
  ];
}`;

const CHROMIUM_DEPS_CACHE = join(paths.root, "chromium-deps-path");

let nixOSCache: boolean | undefined;

export function isNixOS(): boolean {
  if (nixOSCache === undefined) {
    nixOSCache =
      existsSync("/etc/os-release") && readFileSync("/etc/os-release", "utf8").includes("ID=nixos");
  }
  return nixOSCache;
}

let depsPathCache: string | undefined;

export async function buildChromiumDeps(): Promise<string> {
  // nix-build re-evaluates nixpkgs on every call (seconds). The result is a
  // deterministic store path for a given channel, so cache it — in-process and
  // on disk — and skip the rebuild while the cached path still exists.
  if (depsPathCache) {
    return depsPathCache;
  }

  const cached = readCachedDepsPath();
  if (cached) {
    return (depsPathCache = cached);
  }

  const result = await $`nix-build --no-out-link -E ${CHROMIUM_DEPS_EXPR}`.quiet();
  const path = result.stdout.toString().trim().split("\n").pop() ?? "";
  if (!path.startsWith("/nix/store/")) {
    throw new Error(`nix-build did not return a store path: ${path}`);
  }
  cacheDepsPath(path);
  return (depsPathCache = path);
}

function readCachedDepsPath(): string | undefined {
  try {
    const path = readFileSync(CHROMIUM_DEPS_CACHE, "utf8").trim();
    // A stale cache (channel bumped, path garbage-collected) fails this check
    // and falls back to a fresh nix-build.
    if (path.startsWith("/nix/store/") && existsSync(path)) {
      return path;
    }
  } catch {
    // No cache yet — fall through to build.
  }
  return undefined;
}

function cacheDepsPath(path: string): void {
  try {
    writeFileSync(CHROMIUM_DEPS_CACHE, `${path}\n`);
  } catch {
    // Best effort — a cache-write failure must never break the build.
  }
}
