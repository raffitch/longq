#!/usr/bin/env python3
"""Parse nutrition report PDFs into structured data."""

from __future__ import annotations

import os
import re
from typing import Any, Dict, Iterable, List, Tuple

import fitz  # PyMuPDF


ITEM_RE = re.compile(
    r"""
    (?P<name>[A-Za-z0-9][A-Za-z0-9\s\-\(\)\/,&']*?)
    (?:[.\s\-]*?)
    \[\s*(?P<value>-?\d+(?:\.\d+)?)\s*\]
    """,
    re.VERBOSE,
)
EXPECTED_FIRST_THREE = ["anthrocyandins", "bioflavonoids", "biotin"]


def _norm_name(s: str) -> str:
    return re.sub(r"\s+", " ", s.strip()).lower()


def _iter_page_lines(doc: fitz.Document) -> Iterable[str]:
    for page in doc:
        text = page.get_text("text")
        if not text:
            continue
        for raw_line in text.splitlines():
            line = raw_line.strip()
            if line:
                yield line


def _clean_item_name(raw: str) -> str:
    cleaned = raw.replace("\u00a0", " ")
    cleaned = re.sub(r"\s{2,}", " ", cleaned)
    cleaned = re.sub(r"[\s.]+$", "", cleaned)
    cleaned = cleaned.strip(" -")
    if cleaned.lower().startswith("rate "):
        cleaned = cleaned[5:].strip()
    return cleaned


def _parse_line(line: str) -> List[Tuple[str, float]]:
    items: List[Tuple[str, float]] = []
    for match in ITEM_RE.finditer(line):
        name = _clean_item_name(match.group("name"))
        if not name:
            continue
        value_raw = match.group("value")
        try:
            value = int(value_raw)
        except ValueError:
            try:
                value = float(value_raw)
            except ValueError:
                continue
        items.append((name, value))
    return items


def _extract_items(path: str) -> List[Tuple[str, float]]:
    doc = fitz.open(path)
    try:
        items: List[Tuple[str, float]] = []
        for line in _iter_page_lines(doc):
            if "[" not in line or "]" not in line:
                continue
            items.extend(_parse_line(line))
        return items
    finally:
        doc.close()


def parse_pdf(input_path: str) -> Dict[str, Any]:
    """Parse the given nutrition PDF and return a structured payload."""
    items = _extract_items(input_path)
    if not items:
        raise ValueError("Unable to locate any nutrition items in supplied PDF.")
    seen: Dict[str, Tuple[str, float]] = {}
    ordered: List[Tuple[str, float]] = []
    for name, value in items:
        key = _norm_name(name)
        if key in seen:
            continue
        seen[key] = (name, value)
        ordered.append((name, value))
    items = ordered
    if len(items) < 3 or [_norm_name(items[i][0]) for i in range(3)] != EXPECTED_FIRST_THREE:
        raise ValueError("Nutrition PDF validation failed: unexpected leading items.")
    return {
        "source_file": os.path.basename(input_path),
        "item_count": len(items),
        "items": [{"name": name.strip(), "value": value} for (name, value) in items],
    }