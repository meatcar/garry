{
  description = "Run gstack (garrytan/gstack) in full isolation from your local Claude Code config";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    # gstack-playwright-version: 1.58.2
    # Pinned so playwright-driver matches gstack's Playwright version (see src/nixos.ts).
    # Renovate bumps the marker above; `bun run update-pin` resolves the matching rev.
    nixpkgs-playwright.url = "github:NixOS/nixpkgs/7f6a6fb1c76e09426d6125e7e2543efe2a7f74e3";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, nixpkgs-playwright, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        garry-src = pkgs.stdenv.mkDerivation {
          pname = "garry-src";
          version = "0.1.0";
          src = ./.;
          dontBuild = true;
          installPhase = ''
            mkdir -p $out
            cp -r src $out/
          '';
        };
      in {
        packages.default = pkgs.writeShellApplication {
          name = "garry";
          runtimeInputs = [ pkgs.bun ];
          # Hand src/nixos.ts the pinned nixpkgs so it builds the matching Chromium.
          text = ''
            export GARRY_PLAYWRIGHT_NIXPKGS=${nixpkgs-playwright}
            exec bun "${garry-src}/src/cli.ts" "$@"
          '';
        };
      }
    );
}
