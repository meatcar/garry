# garry

Run [gstack](https://github.com/garrytan/gstack) in a fully isolated sandbox, untouched by your local Claude Code config.

## Why

gstack installs itself as a Claude Code skill and modifies your `~/.claude` directory. If you want to try it without disturbing your existing setup — or keep a clean, reproducible environment for gstack — garry sandboxes it in a separate `HOME`.

## Requirements

- [Bun](https://bun.sh) ≥ 1.0 (except Homebrew, which manages this automatically)
- [Claude Code](https://claude.ai/code) CLI (`claude`) on your `PATH`
- Git

## Install

**Nix:**

```sh
nix run github:meatcar/garry -- gstack status
```

**Homebrew** (macOS / Linux):

```sh
brew tap oven-sh/bun
brew tap meatcar/tap
brew install meatcar/tap/garry
```

Or install the latest from `main`:

```sh
brew install --HEAD meatcar/tap/garry
```

**npm / bun registry:**

```sh
bun install -g garry
# or
npm install -g garry
```

**Git (from source):**

```sh
git clone https://github.com/meatcar/garry.git
cd garry
bun link
```

**One-off (no install):**

```sh
bunx garry <command>
```

## Usage

**garry is claude.** Whatever you pass is forwarded straight to `claude`, running in the sandbox — and the first run installs gstack for you automatically:

```sh
garry                # launch claude (installs gstack on first run)
garry --resume       # → claude --resume
garry -p "fix tests" # → claude -p "fix tests"
garry mcp list       # → claude mcp list
```

Everything garry-specific lives under `garry gstack`:

```
garry gstack [setup args...]  install / refresh gstack (forwards flags, e.g. --team, --no-prefix)
garry gstack status           show sandbox state
garry gstack teardown         remove the sandbox entirely
garry gstack --help           show help
```

First-run setup uses gstack's defaults. To install with custom flags, run it once explicitly before your first `garry`:

```sh
garry gstack --team --no-prefix
```

### Updating gstack

gstack updates itself from inside a session — just run `/gstack-upgrade` in claude (team-mode installs also auto-update hourly). To refresh from outside, re-run `garry gstack`, which pulls the latest and re-runs setup.

## How it works

garry creates a sandbox directory (default: `~/Library/Application Support/garry-sandbox` on macOS, `~/.local/share/garry-sandbox` on Linux) containing an isolated `HOME`. Inside it:

- A fresh `~/.claude` directory is created — gstack installs here, not in your real `~/.claude`
- Your credentials and settings are copied in at runtime so claude can authenticate
- Tool caches (`.bun`, `.npm`, `.cache`, etc.) are symlinked from your real home to avoid redundant downloads

On each launch, credentials are synced from your real `~/.claude` so you stay authenticated without sharing config.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `GARRY_SANDBOX_DIR` | `~/Library/Application Support/garry-sandbox` (macOS), `~/.local/share/garry-sandbox` (Linux) | Override the sandbox root |
| `XDG_DATA_HOME` | unset | If set, the sandbox root is `$XDG_DATA_HOME/garry-sandbox` on all platforms |

## NixOS

On NixOS, garry skips Playwright's prebuilt Chromium (which can't run against NixOS' non-FHS libraries) and instead points Playwright at the Chromium that nixpkgs builds for NixOS, via `nix-build`. Playwright resolves browsers by a revision tied to its exact version, so garry pins a nixpkgs revision whose `playwright-driver` matches the Playwright version gstack installs — no per-launch Chromium download or library shimming required.

The matching nixpkgs is pinned as the `nixpkgs-playwright` flake input in [`flake.nix`](flake.nix). If gstack bumps its Playwright version, repoint that input at a nixpkgs commit whose `playwright-driver` matches the new version (e.g. via [nixhub](https://www.nixhub.io/packages/playwright-driver)) and run `nix flake lock`. Set `PLAYWRIGHT_BROWSERS_PATH` yourself to override the pinned browsers entirely.

## License

MIT
