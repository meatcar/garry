import { existsSync, readFileSync } from "node:fs";

import { $ } from "bun";

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

export function isNixOS(): boolean {
  if (!existsSync("/etc/os-release")) {
    return false;
  }
  return readFileSync("/etc/os-release", "utf8").includes("ID=nixos");
}

export async function buildChromiumDeps(): Promise<string> {
  const result = await $`nix-build --no-out-link -E ${CHROMIUM_DEPS_EXPR}`.quiet();
  const path = result.stdout.toString().trim().split("\n").pop() ?? "";
  if (!path.startsWith("/nix/store/")) {
    throw new Error(`nix-build did not return a store path: ${path}`);
  }
  return path;
}
