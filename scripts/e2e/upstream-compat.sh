#!/usr/bin/env bash
set -euo pipefail

repo=${REPO_ROOT:-/repo}
results=${RESULTS_DIR:-/results}
gstack="$GARRY_SANDBOX_DIR/home/.claude/skills/gstack"

record_revision() {
  if git -C "$gstack" rev-parse HEAD >/dev/null 2>&1; then
    git -C "$gstack" rev-parse HEAD >"$results/upstream-sha"
  fi
}
trap record_revision EXIT

mkdir -p "$HOME" "$results"

# These are Docker mount-boundary checks, not claims about garry itself.
if (exec 2>/dev/null; printf 'write probe\n' > /host-boundary/sentinel); then
  echo "host-boundary mount is unexpectedly writable" >&2
  exit 1
fi
if (exec 2>/dev/null; touch "$repo/.garry-write-probe"); then
  echo "repository mount is unexpectedly writable" >&2
  exit 1
fi

bun "$repo/src/cli.ts" gstack \
  --no-prefix \
  --no-plan-tune-hooks \
  --quiet \
  </dev/null
record_revision

# Garry normally supplies this when it launches Claude; the harness invokes
# browse directly, so reproduce that runtime environment explicitly.
export PLAYWRIGHT_BROWSERS_PATH=${PLAYWRIGHT_BROWSERS_PATH:-$GARRY_SANDBOX_DIR/playwright-browsers}

bash "$repo/scripts/e2e/browser-smoke.sh" \
  "$gstack/browse/dist/browse" \
  "$repo/tests/fixtures/browser-smoke.html"
