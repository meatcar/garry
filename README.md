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
nix run github:meatcar/garry -- status
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

```
garry setup     install gstack into the sandbox
garry run       launch claude with gstack (sandboxed)
garry update    pull latest gstack and re-run setup
garry teardown  remove the sandbox entirely
garry status    show sandbox state
```

First time:

```sh
garry setup
garry run
```

Pass arguments through to gstack setup or claude:

```sh
garry setup -- --some-gstack-flag
garry run -- --resume
```

## How it works

garry creates a sandbox directory (default: `~/Library/Application Support/garry-sandbox` on macOS, `~/.local/share/garry-sandbox` on Linux) containing an isolated `HOME`. Inside it:

- A fresh `~/.claude` directory is created — gstack installs here, not in your real `~/.claude`
- Your credentials and settings are copied in at runtime so claude can authenticate
- Tool caches (`.bun`, `.npm`, `.cache`, etc.) are symlinked from your real home to avoid redundant downloads

On each `garry run`, credentials are synced from your real `~/.claude` so you stay authenticated without sharing config.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `GARRY_SANDBOX_DIR` | `~/Library/Application Support/garry-sandbox` (macOS), `~/.local/share/garry-sandbox` (Linux) | Override the sandbox root |
| `XDG_DATA_HOME` | unset | If set, the sandbox root is `$XDG_DATA_HOME/garry-sandbox` on all platforms |
| `PLAYWRIGHT_BROWSERS_PATH` | `<sandbox>/playwright-browsers`, or the nixpkgs bundle on NixOS | Override where Playwright looks for browsers |

## NixOS

On NixOS, garry uses the Playwright browser bundle from nixpkgs (`playwright-driver.browsers`) instead of letting gstack download its own Chromium. These browsers are already patched for NixOS, so there's nothing to rebuild.

To keep things working, garry pins gstack's `playwright` dependency to the version packaged in nixpkgs — the browser revisions are tied to the Playwright version, so the two must match. It also sets `PLAYWRIGHT_BROWSERS_PATH` to the nix bundle and skips the download / host-requirement checks. Set `PLAYWRIGHT_BROWSERS_PATH` yourself to override the bundle garry picks.

## License

MIT
