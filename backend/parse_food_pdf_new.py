#!/usr/bin/env python3
"""
parse_food_pdf_permissive.py — NO-shim backend injection (MIT stack)

What this is
------------
A permissive replacement runner for your existing `parse_food_pdf.py` that avoids
any `sys.modules` monkeypatch or fake `fitz` module. Instead, it **injects a
backend object** into the already-imported `parse_food_pdf` module by assigning
`parse_food_pdf.fitz = FitzCompat`. Your parsing logic, constants, detection
heuristics, and JSON schema remain **unchanged**.

Why this works
--------------
Inside `parse_food_pdf.py`, your code uses the module-global name `fitz`
(PuMuPDF) in two places only:
  1) `doc = fitz.open(input_path)` to open the PDF
  2) `page_spans(page: fitz.Page)` which calls `page.get_text("dict")`

By assigning `parse_food_pdf.fitz` to a small compat class that uses
**pdfplumber/pdfminer.six (MIT)** under the hood and returns **MuPDF-like**
structures (blocks → lines → spans), we keep your logic intact and licensing
permissive, without module import shims.

Usage
-----
CLI:
    python parse_food_pdf_permissive.py INPUT.pdf -o out.json --start 1 --end 999 --order auto

Library:
    from parse_food_pdf_permissive import parse_pdf
    data = parse_pdf("INPUT.pdf", start_page=1, end_page=999, order_mode="auto")

Tuning knobs (rarely needed)
----------------------------
If NEW!=OLD on your samples, tweak only these thresholds (no logic changes):
    X_SPACE_FACTOR  — insert a space when x-gap > factor × avg_char_width
    X_BREAK_FACTOR  — hard break (new span) when x-gap > factor × avg_char_width
    Y_LINE_TOL      — group chars into the same line if |Δy| ≤ tolerance

Troubleshooting note
--------------------
If headers sometimes fail from char-spans alone, we augment with word-based
spans for **headers only** using pdfplumber.extract_words(), but only when no
header was detected from chars.
"""
from __future__ import annotations

import argparse
import io
import json
from typing import Any, Dict, List

import pdfplumber  # MIT (uses pdfminer.six, MIT)

# Import your original logic as a normal module — we won't touch sys.modules.
import parse_food_pdf as P


# =========================
# TUNING KNOBS (backend only)
# =========================
# Prefer keeping these aligned with your earlier working settings.
X_SPACE_FACTOR = 0.45   # insert a space if gap > 0.45 × avg char width
X_BREAK_FACTOR = 1.25   # start a new span if gap > 1.25 × avg char width
# Use the parser's own line tolerance to remain consistent with your heuristics
Y_LINE_TOL = getattr(P, "Y_LINE_TOL", 5.0)

# Header augmentation toggle
HEADER_AUGMENT_IF_MISSING = True


# =============================
# pdfplumber → MuPDF-like dicts
# =============================
def _normalize_font(fontname: str) -> str:
    return fontname.split("+", 1)[1] if "+" in fontname else fontname

def _merge_line_to_spans(line: List[dict]) -> List[Dict[str, Any]]:
    if not line:
        return []
    spans: List[Dict[str, Any]] = []

    def avg_char_w(widths: List[float]) -> float:
        good = [w for w in widths if w > 0.0]
        if good:
            return max(1.0, sum(good) / len(good))
        sizes = [float(c.get("_size", 0.0)) for c in line]
        return max(3.0, (sum(sizes) / len(sizes) * 0.5) if sizes else 4.0)

    line.sort(key=lambda c: c["_x0"])
    cur = None
    widths: List[float] = [line[0]["_w"] or 0.0]
    last_x1 = None
    last_txt = ""

    def flush():
        nonlocal cur
        if cur and str(cur["text"]).strip():
            spans.append(cur)
        cur = None

    def start_span(ch: dict):
        return {
            "text": ch["text"],
            "bbox": [ch["_x0"], ch["_top"], ch["_x1"], ch["_bot"]],
            "size": ch["_size"],
            "font": ch["_font"],
        }

    for ch in line:
        x0, x1, top, bot = ch["_x0"], ch["_x1"], ch["_top"], ch["_bot"]
        gap = (x0 - last_x1) if last_x1 is not None else 0.0

        if cur is None:
            cur = start_span(ch)
        else:
            same_style = (abs(ch["_size"] - cur["size"]) < 0.01 and ch["_font"] == cur["font"])
            if (not same_style) or (gap > X_BREAK_FACTOR * max(1.0, avg_char_w(widths))):
                flush()
                cur = start_span(ch)
                widths = [ch["_w"] or 0.0]
            else:
                this_txt = ch["text"]
                if this_txt != " " and last_txt != " ":
                    no_space_before = "),.:%;!?]&"
                    no_space_after  = "([/$"
                    if not (this_txt and this_txt[0] in no_space_before) and not (last_txt and last_txt[-1] in no_space_after):
                        if gap > X_SPACE_FACTOR * max(1.0, avg_char_w(widths)):
                            cur["text"] += " "
                            cur["bbox"][2] = max(cur["bbox"][2], x0)
                cur["text"] += this_txt
                cur["bbox"][0] = min(cur["bbox"][0], x0)
                cur["bbox"][1] = min(cur["bbox"][1], top)
                cur["bbox"][2] = max(cur["bbox"][2], x1)
                cur["bbox"][3] = max(cur["bbox"][3], bot)
                widths.append(ch["_w"] or 0.0)

        last_x1 = x1
        last_txt = ch["text"]

    flush()
    return [s for s in spans if str(s.get("text", "")).strip() != ""]


def _dedup_header_spans(spans: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    CATEGORY_SET = set(getattr(P, "CATEGORY_NAMES", []))
    kept: List[Dict[str, Any]] = []
    for sp in sorted(spans, key=lambda s: float(s["bbox"][0])):
        text = (sp.get("text") or "").strip()
        if P.canon_cat(text) in CATEGORY_SET:
            x0, y0, x1, y1 = map(float, sp["bbox"])
            cx, cy = 0.5 * (x0 + x1), 0.5 * (y0 + y1)
            dup = False
            for kp in kept:
                kt = (kp.get("text") or "").strip()
                if P.canon_cat(kt) == P.canon_cat(text):
                    kx0, ky0, kx1, ky1 = map(float, kp["bbox"])
                    kcx, kcy = 0.5 * (kx0 + kx1), 0.5 * (ky0 + ky1)
                    if abs(cx - kcx) <= 1.5 and abs(cy - kcy) <= 1.5:
                        dup = True
                        break
            if dup:
                continue
        kept.append(sp)
    return kept


def _line_center_y(line_obj: Dict[str, Any]) -> float:
    ys = [float(sp["bbox"][1]) for sp in line_obj.get("spans", [])]
    return (sum(ys) / len(ys)) if ys else 0.0


def _line_has_header(line_obj: Dict[str, Any], canon: str, near_x: float, tol: float = 3.0) -> bool:
    for sp in line_obj.get("spans", []):
        t = (sp.get("text") or "").strip()
        if P.canon_cat(t) == canon:
            x0 = float(sp.get("bbox", [0, 0, 0, 0])[0])
            if abs(x0 - near_x) <= tol:
                return True
    return False


def _build_text_dict_from_pdfplumber(pl_page) -> dict:
    # 1) raw chars (highest fidelity geometry)
    chars = list(pl_page.chars or [])
    if not chars:
        return {"blocks": []}

    # normalize and sort
    for ch in chars:
        ch["_x0"] = float(ch["x0"]); ch["_x1"] = float(ch["x1"])
        ch["_top"] = float(ch["top"]); ch["_bot"] = float(ch["bottom"])
        ch["_w"] = ch["_x1"] - ch["_x0"]
        ch["_yc"] = 0.5 * (ch["_top"] + ch["_bot"])
        ch["_size"] = float(ch.get("size", 0.0))
        ch["_font"] = _normalize_font(str(ch.get("fontname", "")))
        ch["text"] = str(ch.get("text", ""))
    chars.sort(key=lambda c: (c["_yc"], c["_x0"]))

    # 2) cluster into lines using the same Y tolerance as your code
    lines_chars: List[List[dict]] = []
    for ch in chars:
        if not lines_chars:
            lines_chars.append([ch])
            continue
        last = lines_chars[-1]
        y_ref = sum(x["_yc"] for x in last) / len(last)
        if abs(ch["_yc"] - y_ref) <= Y_LINE_TOL:
            last.append(ch)
        else:
            last.sort(key=lambda c: c["_x0"])
            lines_chars.append([ch])
    if lines_chars:
        lines_chars[-1].sort(key=lambda c: c["_x0"])

    # 3) merge to spans per line
    block_lines: List[Dict[str, Any]] = []
    found_any_header = False

    for line in lines_chars:
        spans = _merge_line_to_spans(line)
        if not found_any_header:
            for sp in spans:
                if P.canon_cat((sp.get("text") or "").strip()) in set(getattr(P, "CATEGORY_NAMES", [])):
                    found_any_header = True
                    break
        spans = _dedup_header_spans(spans)
        block_lines.append({"spans": spans})

    if HEADER_AUGMENT_IF_MISSING and not found_any_header:
        try:
            words = pl_page.extract_words(x_tolerance=1.0, y_tolerance=1.0, keep_blank_chars=False, use_text_flow=True)
        except Exception:
            words = []
        for w in words:
            canon = P.canon_cat(str(w.get("text", "")).strip())
            if canon in set(getattr(P, "CATEGORY_NAMES", [])):
                wx0 = float(w["x0"]); wx1 = float(w["x1"])
                wy  = float(w["top"]); wb = float(w["bottom"])
                # nearest line by Y
                li = 0
                if block_lines:
                    li = min(range(len(block_lines)), key=lambda i: abs(_line_center_y(block_lines[i]) - 0.5 * (wy + wb)))
                if not _line_has_header(block_lines[li], canon, near_x=wx0):
                    sp = {"text": canon, "bbox": [wx0, wy, wx1, wb], "size": float(w.get("size", 0.0)),
                          "font": str(w.get("fontname", ""))}
                    block_lines[li].setdefault("spans", []).append(sp)
                    block_lines[li]["spans"].sort(key=lambda s: float(s["bbox"][0]))

    return {"blocks": [{"lines": block_lines}]}


# =================================
# A tiny compat "fitz" surface (local)
# =================================
class _Rect:
    __slots__ = ("_w", "_h")
    def __init__(self, w: float, h: float):
        self._w = float(w); self._h = float(h)
    @property
    def width(self) -> float:  return self._w
    @property
    def height(self) -> float: return self._h

class _PageCompat:
    __slots__ = ("_pl", "_rect", "_cache")
    def __init__(self, pl_page):
        self._pl = pl_page
        self._rect = _Rect(pl_page.width, pl_page.height)
        self._cache: dict | None = None
    @property
    def rect(self) -> _Rect:
        return self._rect
    def get_text(self, mode: str) -> dict:
        if mode != "dict":
            raise NotImplementedError('Only get_text("dict") is supported.')
        if self._cache is None:
            self._cache = _build_text_dict_from_pdfplumber(self._pl)
        return self._cache

class _DocumentCompat:
    def __init__(self, pl_doc: pdfplumber.PDF):
        self._d = pl_doc
    def __len__(self) -> int:
        return len(self._d.pages)
    def __getitem__(self, i: int) -> _PageCompat:
        return _PageCompat(self._d.pages[i])
    def close(self) -> None:
        try: self._d.close()
        except Exception: pass

class FitzCompat:
    """Backend object with a minimal `open()` like PyMuPDF's fitz.open()."""
    @staticmethod
    def open(path: str) -> _DocumentCompat:
        return _DocumentCompat(pdfplumber.open(path))


# ==============================
# Public API — mirrors your file
# ==============================
def parse_pdf(input_path: str, start_page: int = 1, end_page: int = 999, order_mode: str = "auto") -> Dict[str, Any]:
    """
    Call your original `parse_food_pdf.parse_pdf` but with a permissive backend.
    No sys.modules shims; we just set P.fitz to our compat object for the duration.
    """
    original = getattr(P, "fitz", None)
    P.fitz = FitzCompat  # inject backend (local to this module's call path)
    try:
        return P.parse_pdf(input_path, start_page, end_page, order_mode)
    finally:
        # restore
        if original is None:
            try:
                delattr(P, "fitz")
            except Exception:
                pass
        else:
            P.fitz = original


# ==========
# CLI Runner
# ==========
def main() -> None:
    ap = argparse.ArgumentParser(description="Parse PDF → JSON using pdfplumber backend (no sys.modules shim).")
    ap.add_argument("pdf")
    ap.add_argument("-o", "--out", default="parsed_food.json")
    ap.add_argument("--start", type=int, default=1)
    ap.add_argument("--end", type=int, default=999)
    ap.add_argument("--order", choices=["auto", "column4", "row"], default="auto")
    args = ap.parse_args()

    data = parse_pdf(args.pdf, args.start, args.end, order_mode=args.order)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print("Wrote", args.out)


if __name__ == "__main__":
    main()
