import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, readlink, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("cli.ts", import.meta.url));
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("configuration separation", () => {
  test("launches Claude with the sandbox HOME and documented shared boundaries", async () => {
    const root = await mkdtemp(join(tmpdir(), "garry-config-separation-"));
    temporaryDirectories.push(root);

    const realHome = join(root, "real-home");
    const sandbox = join(root, "sandbox");
    const sandboxHome = join(sandbox, "home");
    const fakeBin = join(root, "bin");
    const capture = join(root, "claude.json");
    const realClaude = join(realHome, ".claude");
    const sandboxClaude = join(sandboxHome, ".claude");

    await Promise.all([
      mkdir(join(realClaude, "projects", "example"), { recursive: true }),
      mkdir(join(realHome, ".codex"), { recursive: true }),
      mkdir(join(sandboxClaude, "skills", "gstack"), { recursive: true }),
      mkdir(join(sandboxHome, ".codex"), { recursive: true }),
      mkdir(fakeBin, { recursive: true }),
      ...[".bun", ".npm", ".cache", ".local/share", ".config"].map((dir) =>
        mkdir(join(realHome, dir), { recursive: true }),
      ),
    ]);

    await Promise.all([
      writeFile(join(realClaude, ".credentials.json"), "fresh credentials"),
      writeFile(join(realClaude, "settings.json"), "real settings"),
      writeFile(join(realClaude, "sentinel"), "do not modify"),
      writeFile(join(realClaude, "projects", "example", "state"), "project state"),
      writeFile(join(realHome, ".claude.json"), "home config"),
      writeFile(join(realHome, ".codex", "auth.json"), "fresh codex auth"),
      writeFile(join(realHome, ".codex", "config.toml"), "real codex config"),
      writeFile(join(sandboxClaude, "settings.json"), "sandbox settings"),
      writeFile(join(sandboxHome, ".codex", "config.toml"), "sandbox codex config"),
    ]);

    const fakeClaude = join(fakeBin, "claude");
    await writeFile(
      fakeClaude,
      `#!/usr/bin/env bun
await Bun.write(process.env.CAPTURE_FILE, JSON.stringify({
  argv: process.argv.slice(2),
  home: process.env.HOME,
  inherited: process.env.INHERITED_MARKER,
  claudeTelemetry: process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC,
  gstackTelemetry: process.env.GSTACK_TELEMETRY_OFF,
}));
await Bun.write(process.env.HOME + "/child-probe", "sandbox child write");
await Bun.write(process.env.HOME + "/.cache/shared-probe", "shared cache write");
process.exit(23);
`,
      { mode: 0o755 },
    );

    const child = Bun.spawn([process.execPath, CLI, "--probe", "value"], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: {
        ...process.env,
        HOME: realHome,
        GARRY_SANDBOX_DIR: sandbox,
        GARRY_DISABLE_TELEMETRY: "1",
        INHERITED_MARKER: "expected",
        CAPTURE_FILE: capture,
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(exitCode, `${stdout}\n${stderr}`).toBe(23);

    const invocation = JSON.parse(await readFile(capture, "utf8"));
    expect(invocation).toEqual({
      argv: ["--probe", "value"],
      home: sandboxHome,
      inherited: "expected",
      claudeTelemetry: "1",
      gstackTelemetry: "1",
    });

    expect(await readFile(join(sandboxHome, "child-probe"), "utf8")).toBe(
      "sandbox child write",
    );
    expect(await realpath(sandboxClaude)).not.toBe(await realpath(realClaude));
    expect(await readFile(join(realClaude, "sentinel"), "utf8")).toBe("do not modify");

    expect(await readFile(join(sandboxClaude, ".credentials.json"), "utf8")).toBe(
      "fresh credentials",
    );
    expect(await readFile(join(sandboxClaude, "settings.json"), "utf8")).toBe(
      "sandbox settings",
    );
    expect(await readFile(join(sandboxClaude, "projects", "example", "state"), "utf8")).toBe(
      "project state",
    );
    expect(await readFile(join(sandboxHome, ".claude.json"), "utf8")).toBe("home config");
    expect(await readFile(join(sandboxHome, ".codex", "auth.json"), "utf8")).toBe(
      "fresh codex auth",
    );
    expect(await readFile(join(sandboxHome, ".codex", "config.toml"), "utf8")).toBe(
      "sandbox codex config",
    );

    for (const dir of [".bun", ".npm", ".cache", ".local/share", ".config"]) {
      expect(await readlink(join(sandboxHome, dir))).toBe(join(realHome, dir));
    }
    expect(await readFile(join(realHome, ".cache", "shared-probe"), "utf8")).toBe(
      "shared cache write",
    );
  });
});
