import { existsSync } from "node:fs";
import { mkdir, rm, rmdir } from "node:fs/promises";

import { $ } from "bun";

import {
  NIXPKGS_PIN,
  gstackPlaywrightVersion,
  isNixOS,
  nixPlaywrightBrowsers,
  playwrightEnv,
} from "./nixos.ts";
import { GSTACK_REPO, paths } from "./paths.ts";
import { assertIsolation, ensureSandbox, syncConfig } from "./sandbox.ts";

function inheritedEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

// On NixOS, realise the pre-patched Playwright browser bundle from the pinned
// nixpkgs so gstack doesn't have to download Chromium or rebuild its runtime
// deps. Returns the bundle path, or undefined off NixOS.
async function nixBrowsers(): Promise<string | undefined> {
  if (!isNixOS()) {
    return undefined;
  }
  console.log("• NixOS detected — using pinned nixpkgs Playwright browsers (no Chromium download)");
  return nixPlaywrightBrowsers();
}

function buildSandboxEnv(browsers: string | undefined): Record<string, string> {
  return {
    ...inheritedEnv(),
    HOME: paths.home,
    ...playwrightEnv(
      browsers,
      process.env.PLAYWRIGHT_BROWSERS_PATH,
      `${paths.root}/playwright-browsers`,
    ),
  };
}

// The pinned nixpkgs only ships browsers for one Playwright version. If gstack
// has drifted to a different version, the bundle won't contain the revision it
// looks for — warn with the exact fix rather than letting it fail cryptically.
function warnOnPlaywrightDrift(browsers: string | undefined): void {
  if (!browsers) {
    return;
  }
  const installed = gstackPlaywrightVersion(paths.gstack);
  if (installed && installed !== NIXPKGS_PIN.playwrightVersion) {
    console.warn(
      `! gstack installed playwright ${installed}, but garry's nixpkgs pin provides browsers ` +
        `for ${NIXPKGS_PIN.playwrightVersion}. The browser will likely fail to launch.\n` +
        `  Update NIXPKGS_PIN in src/nixos.ts to a nixpkgs rev with playwright-driver ${installed}.`,
    );
  }
}

export async function setup(passthrough: string[]): Promise<void> {
  console.log(`• sandbox root: ${paths.root}`);
  await ensureSandbox();
  assertIsolation();

  await mkdir(paths.skills, { recursive: true });

  if (existsSync(`${paths.gstack}/.git`)) {
    console.log("• gstack already cloned — pulling latest");
    await $`git -C ${paths.gstack} pull --ff-only`;
  } else {
    console.log("• cloning gstack");
    await $`git clone --single-branch --depth 1 ${GSTACK_REPO} ${paths.gstack}`;
  }

  const browsers = await nixBrowsers();
  const env = buildSandboxEnv(browsers);
  console.log(`• running gstack setup (HOME=${paths.home})`);
  await $`cd ${paths.gstack} && bash ./setup ${passthrough}`.env(env);

  warnOnPlaywrightDrift(browsers);
  assertIsolation();
  console.log("• setup complete");
}

export async function run(passthrough: string[]): Promise<void> {
  if (!existsSync(paths.gstack)) {
    throw new Error("gstack not installed — run: garry setup");
  }

  await ensureSandbox();
  assertIsolation();
  await syncConfig();

  const browsers = await nixBrowsers();
  warnOnPlaywrightDrift(browsers);
  const env = buildSandboxEnv(browsers);
  console.log("• launching claude with gstack (sandboxed)");
  const proc = Bun.spawn(["claude", ...passthrough], {
    env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exitCode = await proc.exited;
}

export async function update(passthrough: string[]): Promise<void> {
  if (!existsSync(`${paths.gstack}/.git`)) {
    throw new Error("gstack not installed — run: garry setup");
  }

  console.log("• updating gstack");
  await $`git -C ${paths.gstack} pull --ff-only`;

  const browsers = await nixBrowsers();
  const env = buildSandboxEnv(browsers);
  console.log("• re-running setup");
  await $`cd ${paths.gstack} && bash ./setup ${passthrough}`.env(env);

  warnOnPlaywrightDrift(browsers);
  assertIsolation();
  console.log("• update complete");
}

export async function teardown(): Promise<void> {
  if (!existsSync(paths.root)) {
    console.log("• nothing to clean up");
    return;
  }

  console.log(`• removing sandbox: ${paths.root}`);
  await rm(paths.claude, { recursive: true, force: true });
  await rm(paths.home, { recursive: true, force: true });
  await rmdir(paths.root).catch(() => undefined);
  console.log("• teardown complete");
}

export async function status(): Promise<void> {
  console.log(`sandbox root:  ${paths.root}`);

  if (existsSync(`${paths.gstack}/.git`)) {
    const rev = await $`git -C ${paths.gstack} log -1 --format='%h %s'`.text();
    console.log(`gstack:        installed (${rev.trim()})`);
  } else {
    console.log("gstack:        not installed");
  }

  if (existsSync(paths.claude)) {
    console.log("sandbox .claude: exists");
  } else {
    console.log("sandbox .claude: missing");
  }
}
