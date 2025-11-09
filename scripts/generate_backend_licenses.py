#!/usr/bin/env python3
"""Collect backend Python dependency licenses into a JSON file."""

from __future__ import annotations

import argparse
import json
import textwrap
from email.message import Message
from importlib.metadata import Distribution, distributions
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


def _license_text(dist: Distribution) -> str | None:
    """Attempt to read the LICENSE file bundled with the distribution."""
    files = getattr(dist, "files", None)
    if not files:
        return None

    candidates = [f for f in files if f.name.lower().startswith("license")]
    for candidate in candidates:
        try:
            text = Path(dist.locate_file(candidate)).read_text(encoding="utf-8")
            stripped = textwrap.dedent(text).strip()
            if stripped:
                return stripped
        except OSError:
            continue
    return None


def collect_licenses() -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for dist in distributions():
        meta = dist.metadata
        name = meta.get("Name")
        version = dist.version
        if not name or not version:
            continue
        license_name = _guess_license(meta)
        project_urls = meta.get_all("Project-URL") or []
        repo = None
        if meta.get("Home-page"):
            repo = meta.get("Home-page")
        elif project_urls:
            repo = project_urls[0].split(",")[-1].strip()

        entry: dict[str, Any] = {
            "name": name,
            "version": version,
            "license": license_name or "Unknown",
            "summary": meta.get("Summary") or "",
            "home_page": repo or "",
        }
        text = _license_text(dist)
        if text:
            entry["license_text"] = text
        entries.append(entry)

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
    args.output.write_text(json.dumps(licenses, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {len(licenses)} backend license entries to {args.output}")


if __name__ == "__main__":
    main()
