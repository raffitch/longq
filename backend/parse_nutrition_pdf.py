#!/usr/bin/env python3
"""Parse nutrition report PDFs into structured data."""

from __future__ import annotations

import math
import os
import re
from typing import Any, Dict, List, Tuple

import fitz  # PyMuPDF


RATE_BLOCK_RE = re.compile(r"Rate\s+(.+?)Page", re.DOTALL | re.IGNORECASE)
ITEM_LINE_RE = re.compile(
    r"""^\s*
    (?P<item>[A-Za-z0-9][A-Za-z0-9\s\-\(\)\/]+?[A-Za-z0-9\)])
    \s*\[\s*(?P<value>-?\d+(?:\.\d+)?)\s*\]\s*$
    """,
    re.VERBOSE,
)
EXPECTED_FIRST_THREE = ["anthrocyandins", "bioflavonoids", "biotin"]


def _norm_name(s: str) -> str:
    return re.sub(r"\s+", " ", s.strip()).lower()


def _iter_text_blocks(doc: fitz.Document) -> List[str]:
    blocks: List[str] = []
    for page in doc:
        text = page.get_text("text")
        if text:
            blocks.extend(RATE_BLOCK_RE.findall(text))
    return blocks


def _parse_items(block_text: str) -> List[Tuple[str, float]]:
    items: List[Tuple[str, float]] = []
    for raw in block_text.splitlines():
        line = raw.strip()
        if not line:
            continue
        m = ITEM_LINE_RE.match(line)
        if not m:
            continue
        item = re.sub(r"\s{2,}", " ", m.group("item").strip())
        value_s = m.group("value")
        try:
            value = int(value_s) if re.fullmatch(r"-?\d+", value_s) else float(value_s)
        except Exception:
            continue
        if isinstance(value, float) and math.isfinite(value) or isinstance(value, int):
            items.append((item, value))
    return items


def _extract_items(path: str) -> List[Tuple[str, float]]:
    doc = fitz.open(path)
    try:
        blocks = _iter_text_blocks(doc)
        items: List[Tuple[str, float]] = []
        for block in blocks:
            items.extend(_parse_items(block))
        return items
    finally:
        doc.close()


def parse_pdf(input_path: str) -> Dict[str, Any]:
    """Parse the given nutrition PDF and return a structured payload."""
    items = _extract_items(input_path)
    if not items:
        raise ValueError("Unable to locate any nutrition items in supplied PDF.")
    if len(items) < 3 or [_norm_name(items[i][0]) for i in range(3)] != EXPECTED_FIRST_THREE:
        raise ValueError("Nutrition PDF validation failed: unexpected leading items.")
    return {
        "source_file": os.path.basename(input_path),
        "item_count": len(items),
        "items": [{"name": name.strip(), "value": value} for (name, value) in items],
    }
