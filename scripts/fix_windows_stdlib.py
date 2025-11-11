#!/usr/bin/env python3
"""Normalize a Python virtualenv so it mirrors Windows layout.

This script runs inside the runtime venv after `pip install` finishes.
It ensures:
  * Lib/ encodings and stdlib directories are present (if copying from macOS).
  * DLLs/ exists (or is empty) to satisfy Python bootstrap on Windows.
  * Removes macOS-specific `lib/pythonX.Y` stdlib tree when running on Windows.

It expects LONGQ_RUNTIME_DIR to be set to the virtualenv root.
"""
from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

def ensure_directory(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)

def copytree(src: Path, dst: Path) -> None:
    if not src.exists():
        return
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst)


def main() -> int:
    runtime_dir = Path(os.environ.get("LONGQ_RUNTIME_DIR", "")).resolve()
    if not runtime_dir.exists():
        print("[fix-windows-stdlib] LONGQ_RUNTIME_DIR missing or invalid:", runtime_dir)
        return 0

    lib_dir = runtime_dir / "Lib"
    lib_dir.mkdir(exist_ok=True)
    dll_dir = runtime_dir / "DLLs"
    dll_dir.mkdir(exist_ok=True)
    scripts_dir = runtime_dir / "Scripts"
    scripts_dir.mkdir(exist_ok=True)

    # If we built the runtime on a Unix host before copying, stdlib may live under lib/pythonX.Y.
    unix_lib_root = runtime_dir / "lib"
    python_version = f"python{sys.version_info.major}.{sys.version_info.minor}"
    unix_stdlib = unix_lib_root / python_version

    if unix_stdlib.exists():
        print("[fix-windows-stdlib] Copying", unix_stdlib, "->", lib_dir)
        # Copy all top-level items from unix_stdlib into Lib/.
        for item in unix_stdlib.iterdir():
            target = lib_dir / item.name
            if item.is_dir():
                copytree(item, target)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(item, target)
        shutil.rmtree(unix_stdlib)

    # Remove macOS sysconfig artifacts that confuse Windows interpreter.
    darwin_marker = lib_dir / "_sysconfigdata__darwin_darwin.py"
    if darwin_marker.exists():
        print("[fix-windows-stdlib] Removing", darwin_marker)
        darwin_marker.unlink()
        cache_entry = lib_dir / "__pycache__" / "_sysconfigdata__darwin_darwin.cpython-313.pyc"
        if cache_entry.exists():
            cache_entry.unlink()

    # Ensure encodings package exists (copy if still under lib/pythonX.Y/).
    unix_encodings = (unix_lib_root / python_version / "encodings")
    if unix_encodings.exists() and not (lib_dir / "encodings").exists():
        print("[fix-windows-stdlib] Copying encodings package")
        copytree(unix_encodings, lib_dir / "encodings")

    return 0

if __name__ == "__main__":
    raise SystemExit(main())
