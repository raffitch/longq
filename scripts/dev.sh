#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
BACKEND_PYTHON="$BACKEND_DIR/.venv/bin/python"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
FRONTEND_HOST="${FRONTEND_HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
IDLE_SHUTDOWN_DELAY="${IDLE_SHUTDOWN_DELAY:-5}"

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

if [[ ! -x "$BACKEND_PYTHON" ]]; then
  cat <<'EOF'
Backend virtual environment is missing the Python entry point.
Create it and install dependencies with:
  cd backend
  python -m venv .venv
  source .venv/bin/activate
  pip install -r requirements.txt
EOF
  exit 1
fi

if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
  cat <<'EOF'
Frontend dependencies are missing.
Install them with:
  cd frontend
  npm install
EOF
  exit 1
fi

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

ensure_port_free "$BACKEND_PORT" "Backend"
ensure_port_free "$FRONTEND_PORT" "Frontend"

echo "Starting LongevityQ dev environment..."
echo "  Backend → http://127.0.0.1:$BACKEND_PORT"
echo "  Frontend → http://$FRONTEND_HOST:$FRONTEND_PORT"

(cd "$BACKEND_DIR" && EXIT_WHEN_IDLE=true EXIT_IDLE_DEBOUNCE_SEC="$IDLE_SHUTDOWN_DELAY" EXIT_IDLE_SUPERVISOR_PID="$$" WATCHFILES_FORCE_POLLING=1 "$BACKEND_PYTHON" -m uvicorn app:app --host 127.0.0.1 --port "$BACKEND_PORT") &
BACKEND_PID=$!

(cd "$FRONTEND_DIR" && VITE_API_BASE="http://127.0.0.1:$BACKEND_PORT" npm run dev -- --host "$FRONTEND_HOST" --port "$FRONTEND_PORT" --strictPort) &
FRONTEND_PID=$!

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

if command -v open >/dev/null 2>&1; then
  (
    if wait_for_frontend "$FRONTEND_HOST" "$FRONTEND_PORT"; then
      open "http://$FRONTEND_HOST:$FRONTEND_PORT/operator" >/dev/null 2>&1 || true
      sleep 0.3
      open "http://$FRONTEND_HOST:$FRONTEND_PORT/patient" >/dev/null 2>&1 || true
    fi
  ) &
fi

terminate_children() {
  trap - INT TERM EXIT

  kill_process_tree "$FRONTEND_PID"
  kill_process_tree "$BACKEND_PID"

  if [[ -n "${FRONTEND_PID:-}" ]]; then
    wait "$FRONTEND_PID" 2>/dev/null || true
  fi
  if [[ -n "${BACKEND_PID:-}" ]]; then
    wait "$BACKEND_PID" 2>/dev/null || true
  fi
}

trap 'terminate_children; exit 130' INT TERM
trap 'terminate_children' EXIT

EXIT_CODE=0
while :; do
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    wait "$BACKEND_PID"
    EXIT_CODE=$?
    break
  fi
  if ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
    wait "$FRONTEND_PID"
    EXIT_CODE=$?
    break
  fi
  sleep 1
done

terminate_children
rm -rf "$ROOT_DIR/data" 2>/dev/null || true
exit "$EXIT_CODE"
