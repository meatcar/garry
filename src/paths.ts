import { accessSync, chmodSync, constants, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";

const isMacOS = process.platform === "darwin";

// Where per-user app data lives by default. Honor XDG_DATA_HOME everywhere; otherwise
// use the platform-idiomatic location: ~/Library/Application Support on macOS, ~/.local/share elsewhere.
const xdgData =
  process.env.XDG_DATA_HOME ??
  (isMacOS
    ? join(homedir(), "Library", "Application Support")
    : join(homedir(), ".local", "share"));
const EXEC_MODE = 0o755;

function isExecutable(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    return false;
  }
  const probe = join(dir, ".garry-exec-probe");
  try {
    writeFileSync(probe, "#!/bin/sh\nexit 0\n");
    chmodSync(probe, EXEC_MODE);
    accessSync(probe, constants.X_OK);
    return true;
  } catch {
    return false;
  } finally {
    try {
      rmSync(probe, { force: true });
    } catch {
      /* Best effort. */
    }
  }
}

function pickRoot(): string {
  if (process.env.GARRY_SANDBOX_DIR) {
    return process.env.GARRY_SANDBOX_DIR;
  }

  const { uid } = userInfo();
  const [defaultRoot, ...fallbacks] = [
    join(xdgData, "garry"),
    join(homedir(), ".garry"),
    `/var/tmp/garry-${uid}`,
    `/tmp/garry-${uid}`,
  ];

  for (const candidate of [defaultRoot, ...fallbacks]) {
    if (candidate && isExecutable(candidate)) {
      if (candidate !== defaultRoot) {
        // Silent degradation here cost us a debugging session: noexec mounts
        // push the sandbox into /tmp, where tmpfiles aging eats idle clones.
        console.warn(
          `• ${defaultRoot} not usable (noexec mount?) — sandbox at ${candidate}`,
        );
        if (candidate.startsWith("/tmp/")) {
          console.warn(
            "  /tmp is subject to periodic cleanup; set GARRY_SANDBOX_DIR to a persistent exec-capable dir to avoid re-setup",
          );
        }
      }
      return candidate;
    }
  }
  return defaultRoot ?? `/tmp/garry-${uid}`;
}

const root = pickRoot();

export const paths = {
  root,
  home: join(root, "home"),
  claude: join(root, "home", ".claude"),
  skills: join(root, "home", ".claude", "skills"),
  gstack: join(root, "home", ".claude", "skills", "gstack"),
  realClaude: join(homedir(), ".claude"),
};

export const GSTACK_REPO = "https://github.com/garrytan/gstack.git";
