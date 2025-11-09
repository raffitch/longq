#!/usr/bin/env python3
"""Collect backend Python dependency licenses into a JSON file.

Deterministic mode: we base the inventory on pinned entries in
`backend/requirements.txt` (names and versions), ensuring stability across OSes.
We still attempt to enrich with installed metadata (license fields and LICENSE*
contents) when available, but absence of a package in the active environment
won't drop it from the output; it will be emitted with `license: Unknown`.
"""

from __future__ import annotations

import argparse
import json
import re
from email.message import Message
from importlib.metadata import PackageNotFoundError, metadata
from pathlib import Path
from typing import Any


def _guess_license(meta: Message) -> str | None:
    """Best-effort license lookup using standard metadata fields."""
    license_field = meta.get("License")
    if license_field and license_field.strip():
        return license_field.strip()

    classifiers = meta.get_all("Classifier") or []
    for classifier in classifiers:
        if classifier.startswith("License ::"):
            return classifier.split("::")[-1].strip()
    return None


REQ_LINE = re.compile(r"^([a-zA-Z0-9._-]+)\s*==\s*([^\s;]+)")


def _parse_requirements(req_path: Path) -> list[tuple[str, str]]:
    items: list[tuple[str, str]] = []
    for raw in req_path.read_text(encoding="utf-8").splitlines():
        raw = raw.strip()
        if not raw or raw.startswith("#"):
            continue
        m = REQ_LINE.match(raw)
        if m:
            name, version = m.group(1), m.group(2)
            items.append((name, version))
    # de-duplicate while preserving order
    seen: set[str] = set()
    out: list[tuple[str, str]] = []
    for name, version in items:
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append((name, version))
    return out


def _entry_from_installed(name: str, version: str) -> dict[str, Any]:
    try:
        m = metadata(name)
        # Version from installed may differ in rare cases; prefer pinned
        license_name = _guess_license(m) or "Unknown"
        project_urls = m.get_all("Project-URL") or []
        repo = None
        if m.get("Home-page"):
            repo = m.get("Home-page")
        elif project_urls:
            repo = project_urls[0].split(",")[-1].strip()
        # Skip license text extraction to keep JSON files compact
        entry: dict[str, Any] = {
            "name": name,
            "version": version,
            "license": license_name,
            "summary": m.get("Summary") or "",
            "home_page": repo or "",
        }
        return entry
    except PackageNotFoundError:
        return {
            "name": name,
            "version": version,
            "license": "Unknown",
            "summary": "",
            "home_page": "",
        }


def collect_licenses() -> list[dict[str, Any]]:
    root = Path(__file__).resolve().parent.parent
    req_path = root / "backend" / "requirements.txt"
    pinned = _parse_requirements(req_path)
    entries = [_entry_from_installed(name, version) for name, version in pinned]
    return sorted(entries, key=lambda item: item["name"].lower())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        default="licenses/backend_licenses.json",
        type=Path,
        help="Path for the generated JSON file (default: %(default)s)",
    )
    args = parser.parse_args()
    licenses = collect_licenses()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(licenses, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(licenses)} backend license entries to {args.output}")


if __name__ == "__main__":
    main()
