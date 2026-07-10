import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  lstatSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { copyFile, cp, mkdir, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { paths } from "./paths.ts";

const TOOL_CACHES = [".bun", ".npm", ".cache", ".local/share", ".config"];

const EXEC_MODE = 0o755;

const CREDENTIAL_FILES = [".credentials.json", "credentials.json"];
const CONFIG_FILES = ["settings.json", "settings.local.json", "stop-hook-git-check.sh"];
const CONFIG_DIRS = ["statsig", "projects"];

const HOME_CONFIG_FILES = [".claude.json"];

// gstack skills shell out to codex, which reads $HOME/.codex — refresh auth every
// run (like the claude credentials), seed config once so sandbox edits stick.
const CODEX_CREDENTIAL_FILES = ["auth.json"];
const CODEX_CONFIG_FILES = ["config.toml"];

function safeRealpath(path: string): string | undefined {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
}

function assertExecutable(dir: string): void {
  const probe = join(dir, ".garry-exec-probe");
  try {
    writeFileSync(probe, "#!/bin/sh\nexit 0\n");
    chmodSync(probe, EXEC_MODE);
    accessSync(probe, constants.X_OK);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EACCES") {
      throw new Error(
        `sandbox path ${dir} is on a noexec filesystem — garry needs to execute scripts and compiled binaries here. ` +
          `Set GARRY_SANDBOX_DIR to a directory on an exec-allowed mount.`,
        { cause: error },
      );
    }
    throw error;
  } finally {
    rmSync(probe, { force: true });
  }
}

export async function ensureSandbox(): Promise<void> {
  await mkdir(paths.home, { recursive: true });
  assertExecutable(paths.home);

  const real = homedir();
  const linkOps = TOOL_CACHES.filter((dir) => {
    const src = join(real, dir);
    const dest = join(paths.home, dir);
    return existsSync(src) && !existsSync(dest);
  }).map(async (dir) => {
    const dest = join(paths.home, dir);
    await mkdir(dirname(dest), { recursive: true });
    await symlink(join(real, dir), dest);
  });
  await Promise.all(linkOps);

  await mkdir(paths.claude, { recursive: true });
}

export function assertIsolation(): void {
  if (lstatSync(paths.claude, { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new Error("sandbox .claude is a symlink — isolation broken");
  }

  const realResolved = safeRealpath(paths.realClaude);
  const sandboxResolved = safeRealpath(paths.claude);
  if (realResolved && realResolved === sandboxResolved) {
    throw new Error("sandbox .claude resolves to the real .claude — isolation broken");
  }
}

export async function syncConfig(): Promise<void> {
  const src = paths.realClaude;
  const dst = paths.claude;
  const realHome = homedir();

  const credOps = CREDENTIAL_FILES.filter((file) => existsSync(join(src, file))).map(
    async (file) => {
      await copyFile(join(src, file), join(dst, file));
    },
  );
  await Promise.all(credOps);

  const homeConfigOps = HOME_CONFIG_FILES.filter((file) => existsSync(join(realHome, file))).map(
    async (file) => {
      await copyFile(join(realHome, file), join(paths.home, file));
    },
  );
  await Promise.all(homeConfigOps);

  const configOps = CONFIG_FILES.filter(
    (file) => existsSync(join(src, file)) && !existsSync(join(dst, file)),
  ).map(async (file) => copyFile(join(src, file), join(dst, file)));
  await Promise.all(configOps);

  const dirOps = CONFIG_DIRS.filter(
    (dir) => existsSync(join(src, dir)) && !existsSync(join(dst, dir)),
  ).map(async (dir) => cp(join(src, dir), join(dst, dir), { recursive: true }));
  await Promise.all(dirOps);

  const realCodex = join(realHome, ".codex");
  const sandboxCodex = join(paths.home, ".codex");
  const codexCredOps = CODEX_CREDENTIAL_FILES.filter((file) =>
    existsSync(join(realCodex, file)),
  ).map(async (file) => {
    await mkdir(sandboxCodex, { recursive: true });
    await copyFile(join(realCodex, file), join(sandboxCodex, file));
  });
  await Promise.all(codexCredOps);

  const codexConfigOps = CODEX_CONFIG_FILES.filter(
    (file) => existsSync(join(realCodex, file)) && !existsSync(join(sandboxCodex, file)),
  ).map(async (file) => {
    await mkdir(sandboxCodex, { recursive: true });
    await copyFile(join(realCodex, file), join(sandboxCodex, file));
  });
  await Promise.all(codexConfigOps);
}
