#!/usr/bin/env bash

set -e
set -u
if ! set -o pipefail 2>/dev/null; then
  echo "Warning: shell does not support 'pipefail'; continuing without it." >&2
fi

# Regenerate all license inventories and consolidated notice.
# Usage: ./scripts/generate_all_licenses.sh [--full-text] [--group-by-license]
# Requires:
#  - frontend/package-lock.json + installed node_modules
#  - electron/package-lock.json + installed node_modules
#  - backend/.venv or active Python env with dependencies from backend/requirements.txt
# If backend venv isn't active this script will attempt to create one under backend/.venv.

if [ -n "${GENERATE_LICENSES_ROOT:-}" ]; then
  ROOT_DIR="$GENERATE_LICENSES_ROOT"
else
  SCRIPT_SOURCE="${BASH_SOURCE[0]:-$0}"
  SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_SOURCE")" && pwd)"
  ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
fi
cd "$ROOT_DIR"

FULL_TEXT=""
GROUP_BY="--group-by-license"
for arg in "$@"; do
  case "$arg" in
    --full-text) FULL_TEXT="--full-text" ;;
    --group-by-license) GROUP_BY="--group-by-license" ;;
    --no-group-summary) GROUP_BY="" ;;
  esac
  shift || true
done

# Frontend / Electron
if [ ! -d frontend/node_modules ]; then
  echo "Installing frontend dependencies..."
  (cd frontend && npm ci --no-audit --no-fund)
fi
if [ ! -d electron/node_modules ]; then
  echo "Installing electron dependencies..."
  (cd electron && npm ci --no-audit --no-fund)
fi

node scripts/generate_js_licenses.mjs --project frontend --output licenses/frontend_licenses.json
node scripts/generate_js_licenses.mjs --project electron --output licenses/electron_licenses.json

# Backend (ensure consistent Python version)
PY_VERSION_FILE=".python-version"
if [ -f "$PY_VERSION_FILE" ]; then
  PY_SPEC="$(cat $PY_VERSION_FILE | tr -d '\n')"
else
  PY_SPEC="3.13"
fi

if command -v pyenv >/dev/null 2>&1; then
  if ! pyenv versions --bare | grep -q "^${PY_SPEC}$"; then
    echo "pyenv is missing Python ${PY_SPEC}; install it (pyenv install ${PY_SPEC})" >&2
  fi
  echo "Using pyenv Python ${PY_SPEC}"; 
  PYEXEC="$(pyenv which python || echo python3)"
else
  # Fallback: prefer python3.13 then python3.
  PYEXEC="$(command -v python${PY_SPEC} || command -v python3 || command -v python)"
fi

if [ -z "${PYEXEC:-}" ]; then
  echo "Unable to locate a Python interpreter (looked for python${PY_SPEC}, python3, python)." >&2
  exit 1
fi

VENV_DIR="backend/.venv"
if [ -z "${VIRTUAL_ENV:-}" ]; then
  if [ ! -d "$VENV_DIR" ]; then
    echo "Creating backend virtualenv with $PYEXEC..."
    "$PYEXEC" -m venv "$VENV_DIR"
  fi

  ACTIVATE_SCRIPT=""
  if [ -f "$VENV_DIR/bin/activate" ]; then
    ACTIVATE_SCRIPT="$VENV_DIR/bin/activate"
  elif [ -f "$VENV_DIR/Scripts/activate" ]; then
    ACTIVATE_SCRIPT="$VENV_DIR/Scripts/activate"
  fi

  if [ -z "$ACTIVATE_SCRIPT" ]; then
    echo "Unable to locate an activation script in $VENV_DIR." >&2
    echo "Consider removing the directory and re-running this script." >&2
    exit 1
  fi

  if echo "$ACTIVATE_SCRIPT" | grep -q "/Scripts/activate$"; then
    TEMP_ACTIVATE="$(mktemp)"
    # Normalize CRLF endings when sourcing the Windows venv activation script.
    tr -d '\r' < "$ACTIVATE_SCRIPT" > "$TEMP_ACTIVATE"
    # shellcheck disable=SC1090
    source "$TEMP_ACTIVATE"
    rm -f "$TEMP_ACTIVATE"
  else
    # shellcheck disable=SC1090
    source "$ACTIVATE_SCRIPT"
  fi
fi
python -m pip install --upgrade pip

REQ_FILE="backend/requirements.txt"
if ! pip install --require-hashes -r "$REQ_FILE"; then
  UNAME_OUT="$(uname -s 2>/dev/null || echo Windows_NT)"
  case "$UNAME_OUT" in
    CYGWIN*|MINGW*|MSYS*|Windows*)
      echo "pip install failed; attempting to skip uvloop (unsupported on Windows)." >&2
      TMP_REQ="$(mktemp)"
    python - "$REQ_FILE" "$TMP_REQ" <<'PY'
import sys
from pathlib import Path

in_path = Path(sys.argv[1])
out_path = Path(sys.argv[2])

skip_block = False

def strip_continuation(text: str) -> str:
  base = text.rstrip('\n')
  if base.rstrip().endswith('\\'):
    base = base.rstrip()
    base = base[:-1].rstrip()
  return base + '\n'

with in_path.open('r', encoding='utf-8') as src, out_path.open('w', encoding='utf-8') as dst:
  for original in src:
    stripped = original.strip()
    if skip_block:
      if not stripped or original.startswith((' ', '\t')) or stripped.startswith('#'):
        continue
      skip_block = False

    if stripped.startswith('--hash='):
      continue

    if stripped.startswith('uvloop=='):
      skip_block = True
      continue

    line = original
    if stripped.startswith('uvicorn[standard]=='):
      line = original.replace('uvicorn[standard]==', 'uvicorn==')

    dst.write(strip_continuation(line))
PY
    if ! pip install -r "$TMP_REQ"; then
        echo "pip install still failed after removing uvloop." >&2
        rm -f "$TMP_REQ"
        exit 1
      fi
      rm -f "$TMP_REQ"
      ;;
    *)
      echo "pip install failed; see logs above." >&2
      exit 1
      ;;
  esac
fi
python scripts/generate_backend_licenses.py --output licenses/backend_licenses.json

# Consolidated Notice
python scripts/generate_third_party_notice.py --output licenses/THIRD_PARTY_NOTICES.md $FULL_TEXT $GROUP_BY

echo "All license artifacts regenerated successfully."
