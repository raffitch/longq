#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
ELECTRON_DIR="$ROOT_DIR/electron"
BACKEND_VENV="$BACKEND_DIR/.venv"
BACKEND_PYTHON="$BACKEND_VENV/bin/python"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
FRONTEND_HOST="${FRONTEND_HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
IDLE_SHUTDOWN_DELAY="${IDLE_SHUTDOWN_DELAY:-5}"
LONGQ_API_TOKEN="${LONGQ_API_TOKEN:-dev-longq-token}"
export LONGQ_API_TOKEN

ensure_python() {
  if [[ ! -x "$BACKEND_PYTHON" ]]; then
    echo "Creating backend virtualenv..."
    (cd "$BACKEND_DIR" && python3 -m venv .venv)
    (cd "$BACKEND_DIR" && "$BACKEND_PYTHON" -m pip install --upgrade pip)
  fi
  local requirements_file="$BACKEND_DIR/requirements.txt"
  if [[ ! -f "$requirements_file" ]]; then
    echo "Missing backend requirements file: $requirements_file"
    exit 1
  fi
  local hash_file="$BACKEND_VENV/.requirements.sha256"
  local current_hash cached_hash=""
  current_hash=$(python3 - <<'PY' "$requirements_file"
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
    python3 - <<PY >/dev/null 2>&1 || exit 1
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
ensure_frontend_deps
ensure_electron_deps

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
