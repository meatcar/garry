import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";

import { $ } from "bun";

import { buildPlaywrightBrowsers, isNixOS, playwrightEnv } from "./nixos.ts";
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

// GARRY_DISABLE_TELEMETRY=1 opts the whole sandboxed stack out of phone-home:
// claude's statsig/sentry/updater traffic and gstack's usage telemetry. garry
// itself sends nothing either way.
export function telemetryEnv(optOut: string | undefined): Record<string, string> {
  if (!optOut || optOut === "0") {
    return {};
  }
  return {
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    GSTACK_TELEMETRY_OFF: "1",
  };
}

async function buildSandboxEnv(): Promise<Record<string, string>> {
  const override = process.env.PLAYWRIGHT_BROWSERS_PATH;
  let nixBrowsers: string | undefined;
  if (isNixOS() && !override) {
    console.log("• NixOS detected — using nixpkgs playwright-driver browsers");
    nixBrowsers = await buildPlaywrightBrowsers();
  }

  return {
    ...inheritedEnv(),
    HOME: paths.home,
    ...playwrightEnv(nixBrowsers, override, `${paths.root}/playwright-browsers`),
    ...telemetryEnv(process.env.GARRY_DISABLE_TELEMETRY),
  };
}

// Install or refresh gstack inside the sandbox. Clones on first run, pulls
// otherwise, then runs gstack's own setup — forwarding any passthrough flags
// (e.g. --team, --no-prefix, --host). Idempotent, so it doubles as "refresh".
export async function gstack(passthrough: string[]): Promise<void> {
  console.log(`• sandbox root: ${paths.root}`);
  await ensureSandbox();
  assertIsolation();

  await mkdir(paths.skills, { recursive: true });

  // .git can survive as an empty husk (e.g. tmpfiles aging deletes files but
  // not dirs), so probe HEAD rather than the dir itself.
  if (existsSync(`${paths.gstack}/.git/HEAD`)) {
    console.log("• gstack already cloned — pulling latest");
    await $`git -C ${paths.gstack} pull --ff-only`;
  } else {
    if (existsSync(paths.gstack)) {
      console.log("• gstack clone is broken — removing and re-cloning");
      await rm(paths.gstack, { recursive: true, force: true });
    } else {
      console.log("• cloning gstack");
    }
    await $`git clone --single-branch --depth 1 ${GSTACK_REPO} ${paths.gstack}`;
  }

  const env = await buildSandboxEnv();
  console.log(`• running gstack setup (HOME=${paths.home})`);
  await $`cd ${paths.gstack} && bash ./setup ${passthrough}`.env(env);

  assertIsolation();
  console.log("• gstack ready");
}

export async function run(passthrough: string[]): Promise<void> {
  if (!existsSync(paths.gstack)) {
    console.log("• gstack not installed — running first-time setup with defaults");
    console.log("  (for custom flags, run: garry gstack --team / --no-prefix / ...)");
    await gstack([]);
  }

  await ensureSandbox();
  assertIsolation();
  await syncConfig();

  const env = await buildSandboxEnv();
  console.log("• launching claude with gstack (sandboxed)");
  const proc = Bun.spawn(["claude", ...passthrough], {
    env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exitCode = await proc.exited;
}

export async function teardown(): Promise<void> {
  if (!existsSync(paths.root)) {
    console.log("• nothing to clean up");
    return;
  }

  console.log(`• removing sandbox: ${paths.root}`);
  // Everything (home, .claude, playwright-browsers, the nix browsers-path cache) lives
  // under root, so a single recursive remove clears the sandbox entirely.
  await rm(paths.root, { recursive: true, force: true });
  console.log("• teardown complete");
}

export async function status(): Promise<void> {
  console.log(`sandbox root:  ${paths.root}`);

  if (existsSync(`${paths.gstack}/.git/HEAD`)) {
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
