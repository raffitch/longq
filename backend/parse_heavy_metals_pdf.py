#!/usr/bin/env python3
"""Parse Biostar heavy-metals report PDFs into structured data."""

from __future__ import annotations

import os
import re
from typing import Any, Dict, List, Optional, Tuple

import fitz  # PyMuPDF


def _norm_spaces(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def _norm_key(s: str) -> str:
    return _norm_spaces(s).lower()


RATE_BLOCK_RE = re.compile(r"Rate\s+(.+?)Page", re.IGNORECASE | re.DOTALL)
ITEM_LINE_RE = re.compile(r"^\s*(?P<item>.+?)\s*\[\s*(?P<value>-?\d+(?:\.\d+)?)\s*\]\s*$")

FIRST3_A = [_norm_key("Aluminum"), _norm_key("Antimony"), _norm_key("Arsenic")]
LAST_A = _norm_key("Rubidium")
FIRST_B = _norm_key("Silicon")
LAST_B = _norm_key("Zirconium")


def _rate_block(page: fitz.Page) -> Optional[str]:
    text = page.get_text("text")
    if not text:
        return None
    m = RATE_BLOCK_RE.search(text)
    return m.group(1) if m else None


def _parse_items(block_text: str) -> List[Tuple[str, float]]:
    items: List[Tuple[str, float]] = []
    for raw in (block_text or "").splitlines():
        line = _norm_spaces(raw)
        if not line:
            continue
        m = ITEM_LINE_RE.match(line)
        if not m:
            continue
        item = _norm_spaces(m.group("item"))
        value_s = m.group("value")
        try:
            value = int(value_s) if re.fullmatch(r"-?\d+", value_s) else float(value_s)
        except Exception:
            continue
        items.append((item, value))
    return items


def _collect_blocks(doc: fitz.Document) -> List[List[Tuple[str, float]]]:
    blocks: List[List[Tuple[str, float]]] = []
    for page in doc:
        blk = _rate_block(page)
        if not blk:
            continue
        items = _parse_items(blk)
        if items:
            blocks.append(items)
    return blocks


def _match_blocks(blocks: List[List[Tuple[str, float]]]) -> Optional[Tuple[List[Tuple[str, float]], List[Tuple[str, float]]]]:
    for i in range(len(blocks) - 1):
        block_a = blocks[i]
        if len(block_a) < 4:
            continue
        if [_norm_key(block_a[j][0]) for j in range(3)] != FIRST3_A:
            continue
        if _norm_key(block_a[-1][0]) != LAST_A:
            continue
        block_b = blocks[i + 1]
        if not block_b:
            continue
        if _norm_key(block_b[0][0]) != FIRST_B:
            continue
        if _norm_key(block_b[-1][0]) != LAST_B:
            continue
        return block_a, block_b
    return None


def parse_pdf(input_path: str) -> Dict[str, Any]:
    doc = fitz.open(input_path)
    try:
        blocks = _collect_blocks(doc)
    finally:
        doc.close()

    match = _match_blocks(blocks)
    if not match:
        raise ValueError("Unable to locate heavy-metals sections in supplied PDF.")

    block_a, block_b = match
    items = block_a + block_b

    return {
        "source_file": os.path.basename(input_path),
        "item_count": len(items),
        "items": [{"name": name, "value": value} for (name, value) in items],
    }
