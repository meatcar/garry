import { existsSync } from "node:fs";
import { mkdir, rm, rmdir } from "node:fs/promises";

import { $ } from "bun";

import { buildChromiumDeps, isNixOS } from "./nixos.ts";
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

async function buildSandboxEnv(): Promise<Record<string, string>> {
  const env: Record<string, string> = {
    ...inheritedEnv(),
    HOME: paths.home,
    PLAYWRIGHT_BROWSERS_PATH:
      process.env.PLAYWRIGHT_BROWSERS_PATH ?? `${paths.root}/playwright-browsers`,
  };

  if (isNixOS()) {
    console.log("• NixOS detected — building chromium runtime deps via nix-build");
    const depsPath = await buildChromiumDeps();
    const libPath = `${depsPath}/lib`;
    env.NIX_LD_LIBRARY_PATH = process.env.NIX_LD_LIBRARY_PATH
      ? `${libPath}:${process.env.NIX_LD_LIBRARY_PATH}`
      : libPath;
    env.LD_LIBRARY_PATH = process.env.LD_LIBRARY_PATH
      ? `${libPath}:${process.env.LD_LIBRARY_PATH}`
      : libPath;
  }

  return env;
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

  const env = await buildSandboxEnv();
  console.log(`• running gstack setup (HOME=${paths.home})`);
  await $`cd ${paths.gstack} && bash ./setup ${passthrough}`.env(env);

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

export async function update(passthrough: string[]): Promise<void> {
  if (!existsSync(`${paths.gstack}/.git`)) {
    throw new Error("gstack not installed — run: garry setup");
  }

  console.log("• updating gstack");
  await $`git -C ${paths.gstack} pull --ff-only`;

  const env = await buildSandboxEnv();
  console.log("• re-running setup");
  await $`cd ${paths.gstack} && bash ./setup ${passthrough}`.env(env);

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
