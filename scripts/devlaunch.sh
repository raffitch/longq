#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
ELECTRON_DIR="$ROOT_DIR/electron"
BACKEND_VENV="$BACKEND_DIR/.venv"
BACKEND_PYTHON="$BACKEND_VENV/bin/python"
LONGQ_ROOT="${LONGQ_ROOT:-$ROOT_DIR/data}"
LONGQ_PERSIST="${LONGQ_PERSIST:-0}"
export LONGQ_ROOT
export LONGQ_PERSIST
export PYTHONPATH="$ROOT_DIR:$ROOT_DIR/backend:${PYTHONPATH:-}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
FRONTEND_HOST="${FRONTEND_HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
IDLE_SHUTDOWN_DELAY="${IDLE_SHUTDOWN_DELAY:-5}"

resolve_host_python() {
  local candidate
  if [[ -n "${LONGQ_PYTHON:-}" ]]; then
    candidate="${LONGQ_PYTHON}"
    if [[ -x "$candidate" ]]; then
      HOST_PYTHON="$candidate"
      return
    fi
    if command -v "$candidate" >/dev/null 2>&1; then
      HOST_PYTHON="$(command -v "$candidate")"
      return
    fi
    echo "LONGQ_PYTHON points to '$candidate' but it is not executable." >&2
    exit 1
  fi

  for candidate in python3.13 python3; do
    if command -v "$candidate" >/dev/null 2>&1; then
      HOST_PYTHON="$(command -v "$candidate")"
      return
    fi
  done

  echo "Python 3.13 is required but was not found in PATH. Install python3.13 or set LONGQ_PYTHON." >&2
  exit 1
}

HOST_PYTHON=""
resolve_host_python

resolve_auth_token_file() {
  (cd "$ROOT_DIR" && "$HOST_PYTHON" - <<'PY'
from paths import backend_dir
print(backend_dir() / "auth_token.json")
PY
  )
}

AUTH_TOKEN_FILE="$(resolve_auth_token_file)"

if ! "$HOST_PYTHON" - <<'PY' >/dev/null 2>&1; then
import sys
if (sys.version_info.major, sys.version_info.minor) >= (3, 13):
    raise SystemExit(0)
raise SystemExit(1)
PY
  echo "Detected Python at '$HOST_PYTHON', but it is not Python 3.13+. Install Python 3.13 and rerun." >&2
  exit 1
fi

: "${LONGQ_PYTHON:=$HOST_PYTHON}"

reset_runtime_root() {
  if [[ "${LONGQ_PERSIST}" == "1" ]]; then
    return
  fi
  if [[ -d "$LONGQ_ROOT" ]]; then
    echo "Clearing runtime data under $LONGQ_ROOT"
    rm -rf "$LONGQ_ROOT"
  fi
}

read_token_file() {
  if [[ ! -f "$AUTH_TOKEN_FILE" ]]; then
    return 0
  fi
  "$HOST_PYTHON" - "$AUTH_TOKEN_FILE" <<'PY'
import json, sys, pathlib
path = pathlib.Path(sys.argv[1])
try:
    data = json.loads(path.read_text(encoding="utf-8"))
except Exception:
    print("")
else:
    token = (data.get("token") or "").strip()
    print(token)
PY
}

write_token_file() {
  "$HOST_PYTHON" - "$AUTH_TOKEN_FILE" <<'PY'
import json, pathlib, secrets, sys
path = pathlib.Path(sys.argv[1])
path.parent.mkdir(parents=True, exist_ok=True)
token = secrets.token_hex(24)
path.write_text(json.dumps({"token": token}, indent=2), encoding="utf-8")
print(token)
PY
}

ensure_api_token() {
  local token="${LONGQ_API_TOKEN:-}"
  if [[ -z "$token" ]]; then
    token="$(read_token_file)"
  fi
  if [[ -z "$token" ]]; then
    token="$(write_token_file)"
    echo "Generated new API token and wrote to backend/auth_token.json"
  fi
  LONGQ_API_TOKEN="$token"
  export LONGQ_API_TOKEN
}

ensure_python() {
  if [[ ! -x "$BACKEND_PYTHON" ]]; then
    echo "Creating backend virtualenv..."
    (cd "$BACKEND_DIR" && "$HOST_PYTHON" -m venv .venv)
    (cd "$BACKEND_DIR" && "$BACKEND_PYTHON" -m pip install --upgrade pip)
  fi
  local requirements_file="$BACKEND_DIR/requirements.txt"
  if [[ ! -f "$requirements_file" ]]; then
    echo "Missing backend requirements file: $requirements_file"
    exit 1
  fi
  local hash_file="$BACKEND_VENV/.requirements.sha256"
  local current_hash cached_hash=""
  current_hash=$("$HOST_PYTHON" - <<'PY' "$requirements_file"
import hashlib
import pathlib
import sys
path = pathlib.Path(sys.argv[1])
data = path.read_bytes()
print(hashlib.sha256(data).hexdigest())
PY
)
  if [[ -f "$hash_file" ]]; then
    cached_hash=$(<"$hash_file")
  fi
  if [[ "$current_hash" != "$cached_hash" ]]; then
    echo "Installing backend requirements..."
    (cd "$BACKEND_DIR" && "$BACKEND_PYTHON" -m pip install --require-hashes -r requirements.txt)
    printf '%s' "$current_hash" >"$hash_file"
  fi
}

ensure_frontend_deps() {
  if [[ -d "$FRONTEND_DIR/node_modules" ]]; then
    return
  fi
  echo "Installing frontend dependencies..."
  (cd "$FRONTEND_DIR" && npm install)
}

ensure_electron_deps() {
  if [[ -d "$ELECTRON_DIR/node_modules" ]]; then
    return
  fi
  echo "Installing electron dependencies..."
  (cd "$ELECTRON_DIR" && npm install)
}

kill_process_tree() {
  local pid="$1"
  if [[ -z "$pid" ]]; then
    return
  fi
  if ! kill -0 "$pid" 2>/dev/null; then
    return
  fi
  local pgid
  pgid=$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')
  if [[ -z "$pgid" ]]; then
    kill "$pid" 2>/dev/null || true
    sleep 0.2
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null || true
    fi
    return
  fi
  kill "$pid" 2>/dev/null || true
  kill -TERM -- "-$pgid" 2>/dev/null || true
  sleep 0.5
  local members
  members=$(ps -o pid= -g "$pgid" 2>/dev/null | tr -s '\n' ' ')
  if kill -0 "$pid" 2>/dev/null || [[ -n "${members// }" ]]; then
    kill -KILL -- "-$pgid" 2>/dev/null || true
  fi
}

ensure_port_free() {
  local port="$1"
  local label="$2"
  local label_upper
  label_upper=$(printf '%s' "$label" | tr '[:lower:]' '[:upper:]')
  if command -v lsof >/dev/null 2>&1; then
    local pids
    pids=$(lsof -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | tr '\n' ' ' || true)
    if [[ -n "$pids" ]]; then
      echo "$label port $port is in use by: $pids"
      for pid in $pids; do
        kill_process_tree "$pid"
      done
      sleep 0.5
      if lsof -t -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
        echo "$label port $port is still busy. Set ${label_upper}_PORT to override."
        exit 1
      else
        echo "$label port $port has been freed."
      fi
    fi
  else
    "$HOST_PYTHON" - <<PY >/dev/null 2>&1 || exit 1
import socket
s = socket.socket()
try:
    s.bind(("", $port))
finally:
    s.close()
PY
  fi
}

wait_for_frontend() {
  local host="$1"
  local port="$2"
  "$BACKEND_PYTHON" - "$host" "$port" <<'PY'
import socket, sys, time
host = sys.argv[1]
port = int(sys.argv[2])
deadline = time.time() + 60
while time.time() < deadline:
    try:
        with socket.create_connection((host, port), timeout=1):
            sys.exit(0)
    except OSError:
        time.sleep(0.5)
sys.exit(1)
PY
}

ensure_python
reset_runtime_root
ensure_api_token
ensure_frontend_deps
ensure_electron_deps

generate_licenses() {
  echo "Generating backend license inventory..."
  (cd "$ROOT_DIR" && "$BACKEND_PYTHON" scripts/generate_backend_licenses.py --output licenses/backend_licenses.json || true)
  if command -v node >/dev/null 2>&1; then
    echo "Generating frontend license inventory..."
    (cd "$ROOT_DIR" && node scripts/generate_js_licenses.mjs --project frontend --output licenses/frontend_licenses.json || true)
    echo "Generating electron license inventory..."
    (cd "$ROOT_DIR" && node scripts/generate_js_licenses.mjs --project electron --output licenses/electron_licenses.json || true)
  else
    echo "Skipping frontend/electron license generation (node not found)."
  fi
  (cd "$ROOT_DIR" && "$BACKEND_PYTHON" scripts/generate_third_party_notice.py --output licenses/THIRD_PARTY_NOTICES.md --group-by-license || true)
}
generate_licenses

ensure_port_free "$BACKEND_PORT" "Backend"
ensure_port_free "$FRONTEND_PORT" "Frontend"

# Cleanup handler
cleanup() {
  trap - INT TERM EXIT
  kill_process_tree "$FRONTEND_PID"
  kill_process_tree "$BACKEND_PID"
}

trap 'cleanup; exit 130' INT TERM
trap cleanup EXIT

echo "Starting Quantum Qi™ dev environment..."
echo "  Backend → http://127.0.0.1:$BACKEND_PORT"
echo "  Frontend → http://$FRONTEND_HOST:$FRONTEND_PORT"

(cd "$BACKEND_DIR" && EXIT_WHEN_IDLE=true EXIT_IDLE_DEBOUNCE_SEC="$IDLE_SHUTDOWN_DELAY" EXIT_IDLE_SUPERVISOR_PID="$$" WATCHFILES_FORCE_POLLING=1 LONGQ_API_TOKEN="$LONGQ_API_TOKEN" "$BACKEND_PYTHON" -m uvicorn app:app --host 127.0.0.1 --port "$BACKEND_PORT") &
BACKEND_PID=$!

(cd "$FRONTEND_DIR" && VITE_API_BASE="http://127.0.0.1:$BACKEND_PORT" VITE_LONGQ_API_TOKEN="$LONGQ_API_TOKEN" npm run dev -- --host "$FRONTEND_HOST" --port "$FRONTEND_PORT" --strictPort) &
FRONTEND_PID=$!

launch_browser() {
  local url="$1"
  case "$OSTYPE" in
    darwin*)
      local chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      if [[ -x "$chrome" ]]; then
        "$chrome" --new-window "$url" >/dev/null 2>&1 &
      else
        open -na "Google Chrome" --args --new-window "$url" >/dev/null 2>&1 || open "$url" >/dev/null 2>&1 || true
      fi
      ;;
    msys*|cygwin*)
      local ps
      ps=$(command -v powershell.exe || true)
      if [[ -n "$ps" ]]; then
        "$ps" -NoProfile -ExecutionPolicy Bypass -Command "Start-Process 'chrome' -ArgumentList '--new-window','$url'" >/dev/null 2>&1 || \
        "$ps" -NoProfile -ExecutionPolicy Bypass -Command "Start-Process '$url'" >/dev/null 2>&1
      else
        cmd.exe /C start "" "chrome" "--new-window" "$url" >/dev/null 2>&1 || cmd.exe /C start "" "$url" >/dev/null 2>&1 || true
      fi
      ;;
    *)
      if command -v google-chrome >/dev/null 2>&1; then
        google-chrome --new-window "$url" >/dev/null 2>&1 &
      elif command -v chromium >/dev/null 2>&1; then
        chromium --new-window "$url" >/dev/null 2>&1 &
      else
        xdg-open "$url" >/dev/null 2>&1 || true
      fi
      ;;
  esac
}

(
  if wait_for_frontend "$FRONTEND_HOST" "$FRONTEND_PORT"; then
    launch_browser "http://$FRONTEND_HOST:$FRONTEND_PORT/operator"
    launch_browser "http://$FRONTEND_HOST:$FRONTEND_PORT/guest"
  fi
) &

if command -v wait >/dev/null 2>&1 && wait --help 2>&1 | grep -q "--n"; then
  wait -n "$BACKEND_PID" "$FRONTEND_PID"
else
  wait "$BACKEND_PID"
  wait "$FRONTEND_PID"
fi

cleanup
