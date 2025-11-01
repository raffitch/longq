#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

paths=(
  "backend/.venv"
  "frontend/node_modules"
  "frontend/dist"
  "electron/node_modules"
  "electron/dist"
  "data"
  "backend/data"
)

for target in "${paths[@]}"; do
  abs="$ROOT_DIR/$target"
  if [[ -e "$abs" ]]; then
    echo "Removing $target"
    rm -rf "$abs"
  fi
done

echo "Cleanup complete."
