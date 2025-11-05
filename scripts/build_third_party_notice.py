#!/usr/bin/env python3
"""Combine frontend/backend dependency license JSON into Markdown."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "THIRD_PARTY_FRONTEND.json"
BACKEND = ROOT / "THIRD_PARTY_BACKEND.json"
OUTPUT = ROOT / "THIRD_PARTY_NOTICES.md"


def load_frontend() -> list[tuple[str, dict[str, str]]]:
    if not FRONTEND.exists():
        return []
    data = json.loads(FRONTEND.read_text())
    return sorted(data.items())


def load_backend() -> list[dict[str, str]]:
    if not BACKEND.exists():
        return []
    return json.loads(BACKEND.read_text())


def main() -> None:
    lines: list[str] = [
        "# Third-Party Notices",
        "",
        "This document lists dependencies bundled with the Quantum Qi applications.",
        "Generated from `npx license-checker --production --json` and `pip-licenses --format=json`.",
        "",
    ]

    frontend = load_frontend()
    if frontend:
        lines.extend([
            "## JavaScript / TypeScript dependencies",
            "",
            "| Package | Version | License | Repository |",
            "| --- | --- | --- | --- |",
        ])
        for full_name, meta in frontend:
            if "@" in full_name:
                pkg, version = full_name.rsplit("@", 1)
            else:
                pkg, version = full_name, ""
            repo = meta.get("repository", "")
            license_ = meta.get("licenses", "")
            lines.append(f"| `{pkg}` | `{version}` | {license_} | {repo} |")
        lines.append("")

    backend = load_backend()
    if backend:
        lines.extend([
            "## Python dependencies",
            "",
            "| Package | Version | License | Homepage |",
            "| --- | --- | --- | --- |",
        ])
        for entry in backend:
            lines.append(
                f"| `{entry['Name']}` | `{entry['Version']}` | {entry['License']} | {entry.get('URL','')} |"
            )
        lines.append("")

    OUTPUT.write_text("\n".join(lines).strip() + "\n")


if __name__ == "__main__":
    main()
