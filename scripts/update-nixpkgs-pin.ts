#!/usr/bin/env bun
// Keep NIXPKGS_PIN in src/nixos.ts matched to the Playwright version gstack
// locks. Browser revisions are tied to the Playwright version, so when gstack
// bumps Playwright the pinned nixpkgs revision (and its hash) must follow.
//
// This is normally run by CI on a schedule, but you can run it by hand too:
//   bun run scripts/update-nixpkgs-pin.ts            # match gstack's current lock
//   bun run scripts/update-nixpkgs-pin.ts 1.58.2     # force a specific version
//
// Requires Nix on PATH (for nix-prefetch-url / nix-instantiate). Set GITHUB_TOKEN
// to avoid GitHub API rate limits.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { $ } from "bun";

// Mirrors GSTACK_REPO in src/paths.ts (imported as a literal to avoid that
// module's import-time filesystem probing).
const GSTACK_LOCK_URL = "https://raw.githubusercontent.com/garrytan/gstack/main/bun.lock";
const DRIVER_NIX_PATH = "pkgs/development/web/playwright/driver.nix";
const NIXOS_TS = fileURLToPath(new URL("../src/nixos.ts", import.meta.url));

export interface Pin {
  rev: string;
  sha256: string;
  playwrightVersion: string;
}

// Pull the exact (locked) playwright version out of gstack's bun.lock.
export function parseGstackPlaywrightVersion(lockText: string): string {
  const version = lockText.match(/"playwright":\s*\["playwright@(\d+\.\d+\.\d+)"/)?.[1];
  if (!version) {
    throw new Error("could not find a locked playwright version in gstack's bun.lock");
  }
  return version;
}

// Read the `version = "x.y.z"` from a nixpkgs playwright driver.nix.
export function parseDriverVersion(driverNix: string): string | undefined {
  return driverNix.match(/version\s*=\s*"(\d+\.\d+\.\d+)"/)?.[1];
}

export function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) {
      return x - y;
    }
  }
  return 0;
}

// Rewrite the rev/sha256/playwrightVersion fields of the NIXPKGS_PIN literal.
export function applyPin(fileText: string, pin: Pin): string {
  return fileText
    .replace(/(\brev:\s*")[0-9a-f]{40}(")/, `$1${pin.rev}$2`)
    .replace(/(\bsha256:\s*")[0-9a-z]+(")/, `$1${pin.sha256}$2`)
    .replace(/(\bplaywrightVersion:\s*")\d+\.\d+\.\d+(")/, `$1${pin.playwrightVersion}$2`);
}

export function readCurrentPin(fileText: string): Pin {
  const rev = fileText.match(/\brev:\s*"([0-9a-f]{40})"/)?.[1] ?? "";
  const sha256 = fileText.match(/\bsha256:\s*"([0-9a-z]+)"/)?.[1] ?? "";
  const playwrightVersion = fileText.match(/\bplaywrightVersion:\s*"(\d+\.\d+\.\d+)"/)?.[1] ?? "";
  return { rev, sha256, playwrightVersion };
}

async function gh(url: string): Promise<Response> {
  const headers: Record<string, string> = {
    "User-Agent": "garry-pin-updater",
    Accept: "application/vnd.github+json",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`GitHub request failed (${res.status}): ${url}`);
  }
  return res;
}

// Find the newest nixpkgs commit whose playwright driver.nix is exactly
// `version`. driver.nix version is monotonic along the branch, so we scan
// commits newest-first and stop at the first exact match (or bail once we drop
// below the target — meaning that version was never in nixpkgs).
async function findNixpkgsRev(version: string): Promise<string> {
  const perPage = 100;
  for (let page = 1; page <= 6; page++) {
    const commits = (await (
      await gh(
        `https://api.github.com/repos/NixOS/nixpkgs/commits?path=${DRIVER_NIX_PATH}&per_page=${perPage}&page=${page}`,
      )
    ).json()) as Array<{ sha: string }>;
    if (commits.length === 0) {
      break;
    }
    for (const { sha } of commits) {
      const driver = await (
        await fetch(`https://raw.githubusercontent.com/NixOS/nixpkgs/${sha}/${DRIVER_NIX_PATH}`)
      ).text();
      const found = parseDriverVersion(driver);
      if (!found) {
        continue;
      }
      if (found === version) {
        return sha;
      }
      if (compareSemver(found, version) < 0) {
        throw new Error(
          `no nixpkgs commit found with playwright-driver ${version} ` +
            `(history dropped to ${found}); it may not be in nixpkgs yet`,
        );
      }
    }
  }
  throw new Error(`no nixpkgs commit found with playwright-driver ${version} in recent history`);
}

async function prefetchSha256(rev: string): Promise<string> {
  const url = `https://github.com/NixOS/nixpkgs/archive/${rev}.tar.gz`;
  const result = await $`nix-prefetch-url --unpack ${url}`.quiet();
  const hash = result.stdout.toString().trim().split("\n").pop() ?? "";
  if (!/^[0-9a-z]{52}$/.test(hash)) {
    throw new Error(`unexpected nix-prefetch-url output: ${hash}`);
  }
  return hash;
}

// Confirm the pinned rev really evaluates to the expected playwright version.
async function verifyPin(pin: Pin): Promise<void> {
  const expr = `(import (fetchTarball {
    url = "https://github.com/NixOS/nixpkgs/archive/${pin.rev}.tar.gz";
    sha256 = "${pin.sha256}";
  }) {}).playwright-driver.version`;
  const out = (await $`nix-instantiate --eval --json -E ${expr}`.quiet()).stdout.toString().trim();
  const version = JSON.parse(out) as unknown;
  if (version !== pin.playwrightVersion) {
    throw new Error(`pin verification failed: rev evaluates to ${version}, expected ${pin.playwrightVersion}`);
  }
}

async function main(): Promise<void> {
  const forced = process.argv[2];
  const version =
    forced ?? parseGstackPlaywrightVersion(await (await fetch(GSTACK_LOCK_URL)).text());
  console.log(`• gstack Playwright version: ${version}`);

  const fileText = readFileSync(NIXOS_TS, "utf8");
  const current = readCurrentPin(fileText);
  if (current.playwrightVersion === version) {
    console.log(`• pin already targets ${version} (rev ${current.rev.slice(0, 12)}) — up to date`);
    return;
  }

  console.log(`• searching nixpkgs for playwright-driver ${version}…`);
  const rev = await findNixpkgsRev(version);
  console.log(`• found nixpkgs rev ${rev}`);

  const sha256 = await prefetchSha256(rev);
  const pin: Pin = { rev, sha256, playwrightVersion: version };

  console.log("• verifying pin evaluates to the expected version…");
  await verifyPin(pin);

  writeFileSync(NIXOS_TS, applyPin(fileText, pin));
  console.log(`• updated NIXPKGS_PIN: ${current.playwrightVersion} → ${version}`);
  console.log(`    rev=${rev}`);
  console.log(`    sha256=${sha256}`);
}

if (import.meta.main) {
  await main();
}
