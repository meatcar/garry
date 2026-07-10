#!/usr/bin/env bun
// Keep the `nixpkgs-playwright` flake input matched to the Playwright version
// gstack uses. Browser revisions are tied to the Playwright version, so when
// gstack bumps Playwright the pinned nixpkgs revision must follow.
//
// Renovate watches gstack's package.json (see renovate.json) and opens a PR
// bumping the `gstack-playwright-version` marker in flake.nix; run this to
// resolve the matching nixpkgs rev and refresh flake.lock:
//   bun run scripts/update-nixpkgs-pin.ts            # match gstack's package.json
//   bun run scripts/update-nixpkgs-pin.ts 1.58.2     # force a specific version
//
// It reads gstack's package.json (not bun.lock) so it stays consistent with
// Renovate's datasource — bun.lock is JSONC and Renovate can't parse it.
//
// Requires Nix on PATH (for `nix flake update`). Set GITHUB_TOKEN to avoid
// GitHub API rate limits.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { $ } from "bun";

const GSTACK_PKG_URL = "https://raw.githubusercontent.com/garrytan/gstack/main/package.json";
const DRIVER_NIX_PATH = "pkgs/development/web/playwright/driver.nix";
const FLAKE_NIX = fileURLToPath(new URL("../flake.nix", import.meta.url));
const FLAKE_LOCK = fileURLToPath(new URL("../flake.lock", import.meta.url));

export interface Pin {
  rev: string;
  playwrightVersion: string;
}

// Pull the declared playwright version out of gstack's package.json, stripping
// any range operator (e.g. "^1.58.2" -> "1.58.2"). This matches what Renovate's
// custom datasource extracts, keeping the two from fighting over the file.
export function parseGstackPlaywrightVersion(pkgJson: string): string {
  const pkg = JSON.parse(pkgJson) as { dependencies?: Record<string, string> };
  const version = pkg.dependencies?.playwright?.match(/(\d+\.\d+\.\d+)/)?.[1];
  if (!version) {
    throw new Error("could not find a playwright dependency in gstack's package.json");
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

// Read the version marker and pinned rev from flake.nix.
export function readFlakePin(flakeText: string): Pin {
  const playwrightVersion =
    flakeText.match(/gstack-playwright-version:\s*(\d+\.\d+\.\d+)/)?.[1] ?? "";
  const rev =
    flakeText.match(/nixpkgs-playwright\.url\s*=\s*"github:NixOS\/nixpkgs\/([0-9a-f]{40})"/)?.[1] ??
    "";
  return { rev, playwrightVersion };
}

// Rewrite the version marker and the nixpkgs-playwright input rev.
export function applyFlakePin(flakeText: string, pin: Pin): string {
  return flakeText
    .replace(/(gstack-playwright-version:\s*)\d+\.\d+\.\d+/, `$1${pin.playwrightVersion}`)
    .replace(
      /(nixpkgs-playwright\.url\s*=\s*"github:NixOS\/nixpkgs\/)[0-9a-f]{40}(")/,
      `$1${pin.rev}$2`,
    );
}

export function lockedRev(lockJson: string): string | undefined {
  const lock = JSON.parse(lockJson) as {
    nodes?: Record<string, { locked?: { rev?: string } }>;
  };
  return lock.nodes?.["nixpkgs-playwright"]?.locked?.rev;
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

async function main(): Promise<void> {
  const forced = process.argv[2];
  const version =
    forced ?? parseGstackPlaywrightVersion(await (await fetch(GSTACK_PKG_URL)).text());
  console.log(`• gstack Playwright version: ${version}`);

  const flakeText = readFileSync(FLAKE_NIX, "utf8");
  const current = readFlakePin(flakeText);

  console.log(`• searching nixpkgs for playwright-driver ${version}…`);
  const rev = await findNixpkgsRev(version);
  console.log(`• found nixpkgs rev ${rev}`);

  const pin: Pin = { rev, playwrightVersion: version };

  // Renovate bumps only the version marker, and a hand-edited flake.nix can
  // leave flake.lock stale — so check all three before declaring done.
  const lockRev = lockedRev(readFileSync(FLAKE_LOCK, "utf8"));
  if (current.rev === rev && current.playwrightVersion === version && lockRev === rev) {
    console.log(`• pin already correct for ${version} (rev ${rev.slice(0, 12)}) — up to date`);
    return;
  }

  writeFileSync(FLAKE_NIX, applyFlakePin(flakeText, pin));
  console.log("• updating flake.lock…");
  await $`nix flake update nixpkgs-playwright`.cwd(fileURLToPath(new URL("..", import.meta.url)));
  console.log(`• updated nixpkgs-playwright pin → playwright ${version} (rev ${rev})`);
}

if (import.meta.main) {
  await main();
}
