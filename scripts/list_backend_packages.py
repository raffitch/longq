#!/usr/bin/env python3
"""Utility script that prints package names from backend/requirements.txt."""
from __future__ import annotations

from pathlib import Path

REQUIREMENTS = Path(__file__).resolve().parent.parent / "backend" / "requirements.txt"


def main() -> None:
    packages: list[str] = []
    for raw_line in REQUIREMENTS.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        package = line.split("==")[0].split("[")[0]
        packages.append(package)
    print(" ".join(packages))


if __name__ == "__main__":
    main()
