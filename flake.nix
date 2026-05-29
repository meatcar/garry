{
  description = "Run gstack (garrytan/gstack) in full isolation from your local Claude Code config";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
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
          text = ''
            exec bun "${garry-src}/src/cli.ts" "$@"
          '';
        };
      }
    );
}
