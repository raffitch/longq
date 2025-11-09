#!/usr/bin/env bash
set -euo pipefail

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
GROUP_BY=""
for arg in "$@"; do
  case "$arg" in
    --full-text) FULL_TEXT="--full-text" ;;
    --group-by-license) GROUP_BY="--group-by-license" ;;
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

# Backend
if [ -z "${VIRTUAL_ENV:-}" ]; then
  if [ ! -d backend/.venv ]; then
    echo "Creating backend virtualenv..."
    python3 -m venv backend/.venv
  fi
  source backend/.venv/bin/activate
fi
pip install --require-hashes -r backend/requirements.txt
python scripts/generate_backend_licenses.py --output licenses/backend_licenses.json

# Consolidated Notice
python scripts/generate_third_party_notice.py --output licenses/THIRD_PARTY_NOTICES.md $FULL_TEXT $GROUP_BY

echo "All license artifacts regenerated successfully."
