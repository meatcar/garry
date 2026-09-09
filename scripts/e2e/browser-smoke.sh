#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <browse executable> <fixture html>" >&2
  exit 2
fi

browse=$1
fixture=$2
port=${BROWSER_SMOKE_PORT:-4173}
fixture_name=$(basename "$fixture")
run_dir=$(mktemp -d "${TMPDIR:-/tmp}/garry-browser-smoke.XXXXXX")
fixture_log="$run_dir/fixture.log"
fixture_pid=""

export BROWSE_STATE_FILE="$run_dir/browse/state.json"
export BROWSE_PARENT_PID=0
export BROWSE_IDLE_TIMEOUT=600000
export BROWSE_START_TIMEOUT=30000

cleanup() {
  status=$?
  set +e
  "$browse" stop >/dev/null 2>&1 || "$browse" --force-restart stop >/dev/null 2>&1 || true
  if [[ -n "$fixture_pid" ]]; then
    kill "$fixture_pid" >/dev/null 2>&1 || true
    wait "$fixture_pid" >/dev/null 2>&1 || true
  fi
  if [[ $status -ne 0 ]]; then
    echo "--- fixture server log ---" >&2
    cat "$fixture_log" >&2 2>/dev/null || true
    echo "--- browse daemon log ---" >&2
    cat "$run_dir/browse/server.log" >&2 2>/dev/null || true
  fi
  rm -rf "$run_dir"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

expect_equal() {
  local actual=$1
  local expected=$2
  local label=$3
  if [[ "$actual" != "$expected" ]]; then
    printf '%s: expected <%s>, got <%s>\n' "$label" "$expected" "$actual" >&2
    return 1
  fi
}

fixture_dir=$(dirname "$fixture")
python3 -m http.server "$port" --bind 127.0.0.1 --directory "$fixture_dir" \
  >"$fixture_log" 2>&1 &
fixture_pid=$!

for _ in {1..50}; do
  if curl --fail --silent --output /dev/null "http://127.0.0.1:$port/$fixture_name"; then
    break
  fi
  sleep 0.1
done
curl --fail --silent --output /dev/null "http://127.0.0.1:$port/$fixture_name"

url="http://127.0.0.1:$port/$fixture_name"
navigation=$("$browse" goto "$url")
[[ "$navigation" == "Navigated to $url (200)" ]]
expect_equal "$("$browse" js 'document.title')" "garry browser smoke" "document title"
expect_equal "$("$browse" js 'document.querySelector("#title").textContent')" \
  "Browser E2E fixture" "heading"
expect_equal "$("$browse" fill '#name' 'ci-value')" "Filled #name" "fill"
"$browse" click '#submit' >/dev/null
expect_equal "$("$browse" js 'document.querySelector("#result").textContent')" \
  "submitted:ci-value" "result text"
expect_equal "$("$browse" is visible '#result')" "true" "result visibility"
expect_equal "$("$browse" url)" "http://127.0.0.1:$port/done?name=ci-value" "current URL"

read -r daemon_pid chromium_pid < <(
  python3 - "$BROWSE_STATE_FILE" <<'PY'
import json
import sys

with open(sys.argv[1]) as file:
    state = json.load(file)
print(state["pid"], state.get("chromiumPid", ""))
PY
)

proc_start() {
  python3 - "$1" <<'PY'
import sys

try:
    with open(f"/proc/{sys.argv[1]}/stat") as file:
        fields = file.read().rsplit(")", 1)[1].split()
    print(fields[19])
except (FileNotFoundError, IndexError):
    raise SystemExit(1)
PY
}

same_process_alive() {
  local pid=$1
  local expected=$2
  local actual
  [[ -n "$pid" && -n "$expected" ]] || return 1
  actual=$(proc_start "$pid") || return 1
  [[ "$actual" == "$expected" ]]
}

daemon_start=$(proc_start "$daemon_pid")
chromium_start=""
if [[ -n "$chromium_pid" ]]; then
  chromium_start=$(proc_start "$chromium_pid")
fi

expect_equal "$("$browse" stop)" "Server stopped" "daemon shutdown"

deadline=$((SECONDS + 15))
while same_process_alive "$daemon_pid" "$daemon_start" || \
  same_process_alive "$chromium_pid" "$chromium_start"; do
  if (( SECONDS >= deadline )); then
    echo "browse processes remained alive after shutdown" >&2
    exit 1
  fi
  sleep 0.1
done
if [[ -e "$BROWSE_STATE_FILE" ]]; then
  echo "browse daemon state remained after shutdown" >&2
  exit 1
fi

stopped_again=$("$browse" stop)
[[ "$stopped_again" == "No daemon running"* ]]

echo "browser smoke test passed"
