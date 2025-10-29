#!/usr/bin/env python3
"""Parse Biostar hormones report PDFs into structured data."""

from __future__ import annotations

import re
import os
from typing import Any, Dict, List, Optional, Tuple

import fitz  # PyMuPDF


HYPHEN_CLASS = "[\-\u2010\u2011\u2012\u2013\u2014\u2212]"


def normalize_chars(s: str) -> str:
    if not s:
        return s
    s = re.sub(r"[\u2010\u2011\u2012\u2013\u2014\u2212]", "-", s)
    s = s.replace("β", "Beta").replace("Β", "Beta").replace("\u200b", "")
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def norm_key(s: str) -> str:
    return normalize_chars(s).lower()


RATE_BLOCK_RE = re.compile(r"Rate\s+(.+?)Page", re.IGNORECASE | re.DOTALL)
ITEM_LINE_RE = re.compile(
    r"^\s*(?P<item>.+?)\s*\[\s*(?P<value>-?\d+(?:\.\d+)?)\s*\]\s*$"
)

FIRST3_A = [
    norm_key("(11 Beta)-Hydroxylase"),
    norm_key("(11)-Deoxycorticosterone"),
    norm_key("(11)-Deoxycortisol"),
]
LAST_A = norm_key("Indole-3-Carbinol")
FIRST_B = norm_key("Pregnenolone")
LAST_B = norm_key("Testosterone")


def _page_rate_block(page: fitz.Page) -> Optional[str]:
    text = page.get_text("text")
    if not text:
        return None
    m = RATE_BLOCK_RE.search(text)
    return m.group(1) if m else None


def _parse_items(block_text: str) -> List[Tuple[str, float]]:
    items: List[Tuple[str, float]] = []
    for raw in block_text.splitlines():
        line = normalize_chars(raw)
        if not line:
            continue
        m = ITEM_LINE_RE.match(line)
        if not m:
            continue
        item = normalize_chars(m.group("item"))
        try:
            value_s = m.group("value")
            value = int(value_s) if re.fullmatch(r"-?\d+", value_s) else float(value_s)
        except Exception:
            continue
        items.append((item, value))
    return items


def _extract_blocks(doc: fitz.Document, debug: bool = False) -> List[List[Tuple[str, float]]]:
    blocks: List[List[Tuple[str, float]]] = []
    for idx, page in enumerate(doc):
        blk = _page_rate_block(page)
        if not blk:
            continue
        items = _parse_items(blk)
        if items:
            blocks.append(items)
    return blocks


def _find_hormone_blocks(blocks: List[List[Tuple[str, float]]]) -> Optional[Tuple[List[Tuple[str, float]], List[Tuple[str, float]]]]:
    for i in range(len(blocks) - 1):
        block_a = blocks[i]
        if len(block_a) < 4:
            continue
        first_three = [norm_key(block_a[j][0]) for j in range(3)]
        if first_three != FIRST3_A:
            continue
        if norm_key(block_a[-1][0]) != LAST_A:
            continue
        block_b = blocks[i + 1]
        if not block_b:
            continue
        if norm_key(block_b[0][0]) != FIRST_B:
            continue
        if norm_key(block_b[-1][0]) != LAST_B:
            continue
        return block_a, block_b
    return None


def parse_pdf(input_path: str) -> Dict[str, Any]:
    doc = fitz.open(input_path)
    try:
        blocks = _extract_blocks(doc)
    finally:
        doc.close()

    match = _find_hormone_blocks(blocks)
    if not match:
        raise ValueError("Unable to locate hormone sections in supplied PDF.")

    block_a, block_b = match
    items = block_a + block_b

    return {
        "source_file": input_path.split("/")[-1],
        "item_count": len(items),
        "items": [{"name": name, "value": value} for (name, value) in items],
    }
