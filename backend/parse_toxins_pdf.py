#!/usr/bin/env python3
"""Parse Biostar toxins report PDFs into structured data."""

from __future__ import annotations

import os
import re
from typing import Any

import fitz  # PyMuPDF

ITEM_LINE_RE = re.compile(
    r"^\s*(?P<item>[A-Za-z0-9][A-Za-z0-9\s\-\(\)/\.]+?[A-Za-z0-9\)])\s*\[\s*(?P<value>-?\d+(?:\.\d+)?)\s*\]\s*$"
)

EXPECTED_FIRST_THREE = [
    "bromine",
    "candida albicans",
    "candida glabrata",
]

START_ITEM = "bromine"
END_ITEM = "saccharomyces cerevisiae"


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s.strip()).lower()


def _page_lines(page: fitz.Page) -> list[str]:
    text = str(page.get_text("text"))
    if not text:
        return []
    return text.splitlines()


def _parse_items(lines: list[str]) -> list[tuple[str, float]]:
    items: list[tuple[str, float]] = []
    for raw in lines:
        line = raw.strip()
        if not line:
            continue
        m = ITEM_LINE_RE.match(line)
        if not m:
            continue
        item = re.sub(r"\s{2,}", " ", m.group("item").strip())
        val_s = m.group("value")
        try:
            value = int(val_s) if re.fullmatch(r"-?\d+", val_s) else float(val_s)
        except Exception:
            continue
        items.append((item, value))
    return items


def _extract_candidates(doc: fitz.Document) -> list[tuple[str, float]]:
    for page in doc:
        lines = _page_lines(page)
        if not lines:
            continue
        start_idx = end_idx = None
        for idx, raw in enumerate(lines):
            m = ITEM_LINE_RE.match(raw.strip())
            if not m:
                continue
            key = _norm(m.group("item"))
            if start_idx is None and key == START_ITEM:
                start_idx = idx
            if key == END_ITEM:
                end_idx = idx
        if start_idx is not None and end_idx is not None and end_idx >= start_idx:
            block = lines[start_idx : end_idx + 1]
            parsed = _parse_items(block)
            if parsed:
                return parsed
    return []


def parse_pdf(input_path: str) -> dict[str, Any]:
    doc = fitz.open(input_path)
    try:
        items = _extract_candidates(doc)
    finally:
        doc.close()

    if not items:
        raise ValueError("Unable to locate toxins items in supplied PDF.")
    if len(items) < 3 or [_norm(items[i][0]) for i in range(3)] != EXPECTED_FIRST_THREE:
        raise ValueError("Toxins PDF validation failed: unexpected leading items.")

    return {
        "source_file": os.path.basename(input_path),
        "item_count": len(items),
        "items": [{"name": name, "value": value} for (name, value) in items],
    }
