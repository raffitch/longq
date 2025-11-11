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

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
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

if [ -z "${VIRTUAL_ENV:-}" ]; then
  if [ ! -d backend/.venv ]; then
    echo "Creating backend virtualenv with $PYEXEC..."
    "$PYEXEC" -m venv backend/.venv
  fi
  # shellcheck disable=SC1091
  source backend/.venv/bin/activate
fi
python -m pip install --upgrade pip
pip install --require-hashes -r backend/requirements.txt
python scripts/generate_backend_licenses.py --output licenses/backend_licenses.json

# Consolidated Notice
python scripts/generate_third_party_notice.py --output licenses/THIRD_PARTY_NOTICES.md $FULL_TEXT $GROUP_BY

echo "All license artifacts regenerated successfully."
