#!/usr/bin/env python3
"""Generate consolidated THIRD_PARTY_NOTICES.md from license JSON inventories.

Reads the machine-readable inventories produced by:
  - scripts/generate_js_licenses.mjs (frontend, electron)
  - scripts/generate_backend_licenses.py (backend)

and emits a Markdown document grouped by ecosystem with tables plus optional
full license texts (truncated by default for brevity, can be expanded with a flag).
"""
from __future__ import annotations

import argparse
import json
from collections.abc import Iterable
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
FRONTEND_JSON = REPO_ROOT / "licenses" / "frontend_licenses.json"
ELECTRON_JSON = REPO_ROOT / "licenses" / "electron_licenses.json"
BACKEND_JSON = REPO_ROOT / "licenses" / "backend_licenses.json"
OUTPUT_MD = REPO_ROOT / "licenses" / "THIRD_PARTY_NOTICES.md"

MAX_LICENSE_CHARS = 1200  # soft truncate length for inline license text blocks


def load_json(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return data
    except json.JSONDecodeError:
        return []
    return []


def truncate(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return text[: limit] + "\n... (truncated)"


def format_table(rows: Iterable[list[str]]) -> list[str]:
    return ["| " + " | ".join(r) + " |" for r in rows]


def build_section(title: str, entries: list[dict[str, Any]], include_text: bool) -> list[str]:
    if not entries:
        return []
    lines: list[str] = [f"## {title}", ""]
    header = ["Package", "Version", "License", "Repository/Homepage"]
    lines.extend(format_table([header, ["---"] * len(header)]))
    for entry in entries:
        name = entry.get("name", "?")
        version = entry.get("version", "?")
        license_name = entry.get("license", entry.get("licenses", "Unknown"))
        repo = entry.get("repository") or entry.get("home_page") or ""\
            or entry.get("homepage") or entry.get("source", "")
        lines.append(f"| `{name}` | `{version}` | {license_name} | {repo} |")
    lines.append("")
    if include_text:
        for entry in entries:
            text = entry.get("licenseText") or entry.get("license_text")
            if not text:
                continue
            name = entry.get("name", "?")
            version = entry.get("version", "?")
            lines.append(f"### License: {name} {version}")
            lines.append("")
            lines.append("````")
            lines.append(truncate(text, MAX_LICENSE_CHARS))
            lines.append("````")
            lines.append("")
    return lines


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate consolidated third-party notices.")
    parser.add_argument("--output", default=str(OUTPUT_MD), help="Output Markdown file path")
    parser.add_argument(
        "--full-text",
        action="store_true",
        help="Include (truncated) license text blocks",
    )
    parser.add_argument(
        "--group-by-license",
        action="store_true",
        help="Add a summary section grouping counts by license identifier",
    )
    args = parser.parse_args()

    frontend = load_json(FRONTEND_JSON)
    electron = load_json(ELECTRON_JSON)
    backend = load_json(BACKEND_JSON)

    # De-duplicate by (name, version) within each ecosystem just in case.
    def dedupe(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
        seen: set[tuple[str, str]] = set()
        out: list[dict[str, Any]] = []
        for e in entries:
            key = (e.get("name", ""), e.get("version", ""))
            if key in seen:
                continue
            seen.add(key)
            out.append(e)
        return out

    frontend = dedupe(frontend)
    electron = dedupe(electron)
    backend = dedupe(backend)

    lines: list[str] = [
        "# Third-Party Notices",
        "",
        (
            "This document lists all third-party dependencies bundled with the "
            "Quantum Qi applications."
        ),
        (
            "It is generated from the JSON inventories committed under `licenses/`. "
            "Regenerate after dependency lock changes."
        ),
        "",
        f"* Frontend packages: {len(frontend)}",
        f"* Electron packages: {len(electron)}",
        f"* Backend Python packages: {len(backend)}",
        "",
    ]

    include_text = bool(args.full_text)
    if args.group_by_license:
        from collections import Counter
        all_entries = frontend + electron + backend
        counter = Counter(
            (e.get("license") or e.get("licenses") or "Unknown") for e in all_entries
        )
        lines.append("## License Summary")
        lines.append("")
        lines.append("| License | Count |")
        lines.append("| --- | --- |")
        for license_name, count in sorted(counter.items(), key=lambda x: (-x[1], x[0].lower())):
            lines.append(f"| {license_name} | {count} |")
        lines.append("")

    lines.extend(build_section("Frontend (React app)", frontend, include_text))
    lines.extend(build_section("Electron (Desktop shell)", electron, include_text))
    lines.extend(build_section("Backend (Python)", backend, include_text))

    output_path = Path(args.output)
    output_path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
    print(f"Wrote consolidated third-party notices to {output_path}")


if __name__ == "__main__":
    main()
