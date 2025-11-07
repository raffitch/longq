#!/usr/bin/env python3
# (See docstring in previous attempt for details.)
from __future__ import annotations

import argparse
import json
import math
import re
import statistics
from collections.abc import Sequence
from typing import Any, Protocol

import pdfplumber
from pdfplumber.page import Page as PdfPage

CATEGORY_NAMES = [
    "Dairy",
    "Eggs",
    "Fruits",
    "Grains",
    "Legumes",
    "Meats",
    "NutsSeeds",
    "Seafood",
    "Vegetables",
    "Wheat",
    "HeavyMetals",
    "Lectins",
]
CANON = {
    "dairy": "Dairy",
    "eggs": "Eggs",
    "fruits": "Fruits",
    "grains": "Grains",
    "legumes": "Legumes",
    "meats": "Meats",
    "nuts seeds": "NutsSeeds",
    "nuts&seeds": "NutsSeeds",
    "nutsseeds": "NutsSeeds",
    "seafood": "Seafood",
    "vegetables": "Vegetables",
    "wheat": "Wheat",
    "heavy metals": "HeavyMetals",
    "heavymetals": "HeavyMetals",
    "lectins": "Lectins",
}
THRESHOLDS = [(90, "high"), (81, "moderate"), (66, "medium"), (0, "low")]
SCORE_RE = re.compile(r"^\d{1,3}$", re.ASCII)
TOTAL_RE = re.compile(r"^\s*There\s+are\s+Total\s+of", re.IGNORECASE)

Y_LINE_TOL = 5.0
ROW_Y_TOL = 6.0
X_OVERLAP_MIN = 8.0
ROW_CLUSTER_TOL = 10.0
ROW_PAD_UP = 6.0
ROW_PAD_DOWN = 16.0
WINDOW_LEFT_PAD = 2.0
WINDOW_RIGHT_PAD = 2.0
HEADER_VALIDATE_Y_RANGE = 220.0

X_SPACE_FACTOR = 0.45
X_BREAK_FACTOR = 1.25
HEADER_AUGMENT_IF_MISSING = True


def canon_cat(s: str) -> str:
    return CANON.get(" ".join(s.split()).lower(), s)


CATEGORY_CANON_SET = {canon_cat(name) for name in CATEGORY_NAMES}


def severity(score: int) -> str:
    for cutoff, name in THRESHOLDS:
        if score >= cutoff:
            return name
    return "low"


def _normalize_font(fontname: str) -> str:
    return fontname.split("+", 1)[1] if "+" in fontname else fontname


def _merge_line_to_spans(line: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not line:
        return []

    spans: list[dict[str, Any]] = []

    def avg_char_width(widths: list[float]) -> float:
        good = [w for w in widths if w > 0.0]
        if good:
            return max(1.0, sum(good) / len(good))
        sizes = [float(c.get("_size", 0.0)) for c in line]
        if sizes:
            return max(3.0, (sum(sizes) / len(sizes)) * 0.5)
        return 4.0

    line.sort(key=lambda c: c["_x0"])
    cur: dict[str, Any] | None = None
    widths: list[float] = [line[0]["_w"] or 0.0]
    last_x1: float | None = None
    last_txt = ""

    def flush() -> None:
        nonlocal cur
        if cur and str(cur["text"]).strip():
            spans.append(cur)
        cur = None

    def start_span(ch: dict[str, Any]) -> dict[str, Any]:
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
            same_style = abs(ch["_size"] - cur["size"]) < 0.01 and ch["_font"] == cur["font"]
            if (not same_style) or (gap > X_BREAK_FACTOR * max(1.0, avg_char_width(widths))):
                flush()
                cur = start_span(ch)
                widths = [ch["_w"] or 0.0]
            else:
                this_txt = ch["text"]
                if this_txt != " " and last_txt != " ":
                    no_space_before = "),.:%;!?]&"
                    no_space_after = "([/$"
                    gap_thresh = X_SPACE_FACTOR * max(1.0, avg_char_width(widths))
                    if not (this_txt and this_txt[0] in no_space_before) and not (
                        last_txt and last_txt[-1] in no_space_after
                    ):
                        if gap > gap_thresh:
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
    return [s for s in spans if str(s.get("text", "")).strip()]


def _dedup_header_spans(spans: list[dict[str, Any]]) -> list[dict[str, Any]]:
    kept: list[dict[str, Any]] = []
    for span in sorted(spans, key=lambda s: float(s["bbox"][0])):
        text = (span.get("text") or "").strip()
        canon = canon_cat(text)
        if canon in CATEGORY_CANON_SET:
            x0, y0, x1, y1 = map(float, span["bbox"])
            cx, cy = 0.5 * (x0 + x1), 0.5 * (y0 + y1)
            dup = False
            for kept_span in kept:
                kept_text = (kept_span.get("text") or "").strip()
                if canon_cat(kept_text) != canon:
                    continue
                kx0, ky0, kx1, ky1 = map(float, kept_span["bbox"])
                kcx, kcy = 0.5 * (kx0 + kx1), 0.5 * (ky0 + ky1)
                if abs(cx - kcx) <= 1.5 and abs(cy - kcy) <= 1.5:
                    dup = True
                    break
            if dup:
                continue
        kept.append(span)
    return kept


def _line_center_y(line_obj: dict[str, Any]) -> float:
    ys = [float(span["bbox"][1]) for span in line_obj.get("spans", [])]
    return (sum(ys) / len(ys)) if ys else 0.0


def _line_has_header(line_obj: dict[str, Any], canon: str, near_x: float, tol: float = 3.0) -> bool:
    for span in line_obj.get("spans", []):
        text = (span.get("text") or "").strip()
        if canon_cat(text) == canon:
            x0 = float(span.get("bbox", [0, 0, 0, 0])[0])
            if abs(x0 - near_x) <= tol:
                return True
    return False


def _build_text_dict_from_pdfplumber(pl_page: PdfPage) -> dict[str, Any]:
    chars = list(pl_page.chars or [])
    if not chars:
        return {"blocks": []}

    for ch in chars:
        ch["_x0"] = float(ch["x0"])
        ch["_x1"] = float(ch["x1"])
        ch["_top"] = float(ch["top"])
        ch["_bot"] = float(ch["bottom"])
        ch["_w"] = ch["_x1"] - ch["_x0"]
        ch["_yc"] = 0.5 * (ch["_top"] + ch["_bot"])
        ch["_size"] = float(ch.get("size", 0.0))
        ch["_font"] = _normalize_font(str(ch.get("fontname", "")))
        ch["text"] = str(ch.get("text", ""))
    chars.sort(key=lambda c: (c["_yc"], c["_x0"]))

    lines_chars: list[list[dict[str, Any]]] = []
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

    block_lines: list[dict[str, Any]] = []
    found_header = False
    for line in lines_chars:
        spans = _merge_line_to_spans(line)
        if not found_header:
            for span in spans:
                if canon_cat((span.get("text") or "").strip()) in CATEGORY_CANON_SET:
                    found_header = True
                    break
        spans = _dedup_header_spans(spans)
        block_lines.append({"spans": spans})

    if HEADER_AUGMENT_IF_MISSING and not found_header:
        try:
            words = pl_page.extract_words(
                x_tolerance=1.0,
                y_tolerance=1.0,
                keep_blank_chars=False,
                use_text_flow=True,
            )
        except Exception:
            words = []
        for word in words:
            canon = canon_cat(str(word.get("text", "")).strip())
            if canon not in CATEGORY_CANON_SET:
                continue
            wx0 = float(word["x0"])
            wx1 = float(word["x1"])
            wy = float(word["top"])
            wb = float(word["bottom"])
            if block_lines:
                line_index = min(
                    range(len(block_lines)),
                    key=lambda idx: abs(_line_center_y(block_lines[idx]) - 0.5 * (wy + wb)),
                )
            else:
                line_index = 0
                block_lines.append({"spans": []})
            if not _line_has_header(block_lines[line_index], canon, near_x=wx0):
                span = {
                    "text": canon,
                    "bbox": [wx0, wy, wx1, wb],
                    "size": float(word.get("size", 0.0)),
                    "font": str(word.get("fontname", "")),
                }
                block_lines[line_index].setdefault("spans", []).append(span)
                block_lines[line_index]["spans"].sort(key=lambda s: float(s["bbox"][0]))

    return {"blocks": [{"lines": block_lines}]}


class _Rect:
    __slots__ = ("_h", "_w")

    def __init__(self: _Rect, width: float, height: float) -> None:
        self._w = float(width)
        self._h = float(height)

    @property
    def width(self: _Rect) -> float:
        return self._w

    @property
    def height(self: _Rect) -> float:
        return self._h


class _PageCompat:
    __slots__ = ("_cache", "_pl", "_rect")

    def __init__(self: _PageCompat, pl_page: PdfPage) -> None:
        self._pl = pl_page
        self._rect = _Rect(pl_page.width, pl_page.height)
        self._cache: dict[str, Any] | None = None

    @property
    def rect(self: _PageCompat) -> _Rect:
        return self._rect

    def get_text(self: _PageCompat, mode: str) -> dict[str, Any]:
        if mode != "dict":
            msg = 'Only get_text("dict") is supported.'
            raise NotImplementedError(msg)
        if self._cache is None:
            self._cache = _build_text_dict_from_pdfplumber(self._pl)
        return self._cache


class _DocumentCompat:
    def __init__(self: _DocumentCompat, pl_doc: pdfplumber.PDF) -> None:
        self._doc = pl_doc

    def __len__(self: _DocumentCompat) -> int:
        return len(self._doc.pages)

    def __getitem__(self: _DocumentCompat, index: int) -> _PageCompat:
        return _PageCompat(self._doc.pages[index])

    def close(self: _DocumentCompat) -> None:
        try:
            self._doc.close()
        except Exception:
            pass


class FitzCompat:
    """Backend object exposing a PyMuPDF-like open()."""

    @staticmethod
    def open(path: str) -> _DocumentCompat:
        return _DocumentCompat(pdfplumber.open(path))


class _PageLike(Protocol):
    @property
    def rect(self: _PageLike) -> _Rect: ...

    def get_text(self: _PageLike, mode: str) -> dict[str, Any]: ...


fitz = FitzCompat


def _nearest_index(value: float, candidates: Sequence[float]) -> int:
    return min(range(len(candidates)), key=lambda idx: abs(value - candidates[idx]))


def page_spans(page: _PageLike) -> list[dict[str, Any]]:
    d = page.get_text("dict")
    out: list[dict[str, Any]] = []
    for b in d.get("blocks", []):
        for ln in b.get("lines", []):
            for sp in ln.get("spans", []):
                t = (sp.get("text") or "").strip()
                if not t:
                    continue
                x0, y0, x1, y1 = sp["bbox"]
                out.append(
                    {"t": t, "x0": x0, "y0": y0, "x1": x1, "y1": y1, "size": sp.get("size", 0.0)}
                )
    out.sort(key=lambda s: (s["y0"], s["x0"]))
    return out


def cluster_lines(
    spans: list[dict[str, Any]],
    y_tol: float = Y_LINE_TOL,
) -> list[list[dict[str, Any]]]:
    lines: list[list[dict[str, Any]]] = []
    for sp in spans:
        if not lines:
            lines.append([sp])
            continue
        last = lines[-1]
        y_ref = sum(x["y0"] for x in last) / len(last)
        if abs(sp["y0"] - y_ref) <= y_tol:
            last.append(sp)
        else:
            last.sort(key=lambda s: s["x0"])
            lines.append([sp])
    if lines:
        lines[-1].sort(key=lambda s: s["x0"])
    return lines


def find_total_lines(lines: list[list[dict[str, Any]]]) -> list[dict[str, Any]]:
    totals: list[dict[str, Any]] = []
    for ln in lines:
        txt = " ".join(s["t"] for s in ln)
        if TOTAL_RE.match(txt):
            y = min(s["y0"] for s in ln)
            x0 = min(s["x0"] for s in ln)
            x1 = max(s["x1"] for s in ln)
            totals.append({"y": y, "x0": x0, "x1": x1, "text": txt})
    totals.sort(key=lambda r: r["y"])
    return totals


def detect_headers(lines: list[list[dict[str, Any]]]) -> list[dict[str, Any]]:
    allowed = set(CATEGORY_NAMES)
    headers: list[dict[str, Any]] = []
    for ln in lines:
        for s in ln:
            nm = canon_cat(s["t"])
            if nm in allowed:
                headers.append({"name": nm, "x0": s["x0"], "y0": s["y0"], "y1": s["y1"]})
    headers.sort(key=lambda h: (h["y0"], h["x0"]))
    return headers


def group_headers_into_rows(headers: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    rows: list[list[dict[str, Any]]] = []
    for h in headers:
        if not rows:
            rows.append([h])
            continue
        last_row = rows[-1]
        y_ref = sum(x["y0"] for x in last_row) / len(last_row)
        if abs(h["y0"] - y_ref) <= ROW_Y_TOL:
            last_row.append(h)
        else:
            last_row.sort(key=lambda r: r["x0"])
            rows.append([h])
    if rows:
        rows[-1].sort(key=lambda r: r["x0"])
    return rows


def build_row_boxes(
    rows: list[list[dict[str, Any]]],
    page_w: float,
) -> dict[str, tuple[float, float, float, float]]:
    boxes: dict[str, tuple[float, float, float, float]] = {}
    for row in rows:
        y0 = min(h["y0"] for h in row)
        if len(row) == 1:
            h = row[0]
            boxes[h["name"]] = (y0, math.inf, 0.0, float(page_w))
        else:
            row_sorted = sorted(row, key=lambda r: r["x0"])
            edges = (
                [0.0]
                + [
                    (row_sorted[i]["x0"] + row_sorted[i + 1]["x0"]) / 2.0
                    for i in range(len(row_sorted) - 1)
                ]
                + [float(page_w)]
            )
            for i, h in enumerate(row_sorted):
                x0 = edges[i]
                x1 = edges[i + 1]
                boxes[h["name"]] = (y0, math.inf, x0, x1)
    return boxes


def find_footer_page_y(lines: list[list[dict[str, Any]]], page_height: float) -> float:
    for ln in reversed(lines):
        txt = " ".join(s["t"] for s in ln).strip().lower()
        if "page" in txt:
            for sp in ln:
                if "page" in sp["t"].lower():
                    return float(sp["y0"])
            return min(float(s["y0"]) for s in ln)
    return page_height


def intersect_x(a0: float, a1: float, b0: float, b1: float) -> float:
    return max(0.0, min(a1, b1) - max(a0, b0))


def clamp_y1_with_totals(
    cat_boxes: dict[str, tuple[float, float, float, float]],
    totals: list[dict[str, float]],
) -> dict[str, tuple[float, float, float, float]]:
    new: dict[str, tuple[float, float, float, float]] = {}
    for name, (y0, _, x0, x1) in cat_boxes.items():
        y1 = math.inf
        for t in totals:
            if t["y"] <= y0:
                continue
            if intersect_x(x0, x1, t["x0"], t["x1"]) >= X_OVERLAP_MIN:
                y1 = t["y"]
                break
        new[name] = (y0, y1, x0, x1)
    return new


def find_scores_in_box(
    lines: list[list[dict[str, Any]]],
    x0: float,
    x1: float,
    y0: float,
    y1: float,
) -> list[dict[str, float]]:
    scores: list[dict[str, float]] = []
    for ln in lines:
        ly = min(s["y0"] for s in ln)
        if not (y0 <= ly < y1):
            continue
        for s in ln:
            if s["x1"] < x0 or s["x0"] > x1:
                continue
            if SCORE_RE.match(s["t"]):
                xc = (s["x0"] + s["x1"]) / 2.0
                scores.append({"x": xc, "y": ly, "t": s["t"]})
    scores.sort(key=lambda r: (r["y"], r["x"]))
    return scores


def cluster_score_rows(
    scores: list[dict[str, float]],
    tol: float = ROW_CLUSTER_TOL,
) -> list[list[dict[str, float]]]:
    rows: list[list[dict[str, float]]] = []
    for sc in scores:
        if not rows:
            rows.append([sc])
            continue
        last = rows[-1]
        y_ref = sum(s["y"] for s in last) / len(last)
        if abs(sc["y"] - y_ref) <= tol:
            last.append(sc)
        else:
            last.sort(key=lambda s: s["x"])
            rows.append([sc])
    if rows:
        rows[-1].sort(key=lambda s: s["x"])
    return rows


def build_row_bands(
    row_centers: list[float],
    cat_y0: float,
    cat_y1: float,
) -> list[tuple[float, float]]:
    bands: list[tuple[float, float]] = []
    if not row_centers:
        return bands
    for i, y in enumerate(row_centers):
        upper = cat_y0 if i == 0 else (row_centers[i - 1] + y) / 2.0
        lower = cat_y1 if i == len(row_centers) - 1 else (y + row_centers[i + 1]) / 2.0
        y_top = max(cat_y0, upper - ROW_PAD_UP)
        y_bot = min(cat_y1, lower + ROW_PAD_DOWN)
        bands.append((y_top, y_bot))
    return bands


def smart_join(parts: list[str]) -> str:
    if not parts:
        return ""
    out = parts[0]
    for nxt in parts[1:]:
        if out.endswith("-"):
            out = out + nxt.lstrip()
        elif nxt.startswith((")", ",", ".", ":", ";")):
            out = out + nxt
        elif nxt.startswith(("'", '"')):
            out = out + nxt
        elif nxt.startswith((")",)) or out.endswith(("(", "/")):
            out = out + nxt
        else:
            out = out + " " + nxt
    out = re.sub(r"\s+\)", ")", out)
    out = re.sub(r"\(\s+", "(", out)
    return out.strip(" •·-—")


def collect_label_window(
    lines: list[list[dict[str, Any]]],
    y_top: float,
    y_bot: float,
    x_left: float,
    x_right: float,
    expected_set: set[str],
) -> str:
    parts: list[str] = []
    for ln in lines:
        ly = min(s["y0"] for s in ln)
        if not (y_top <= ly < y_bot):
            continue
        for s in ln:
            if s["x1"] < x_left or s["x0"] > x_right:
                continue
            t = s["t"]
            if SCORE_RE.match(t):
                continue
            if canon_cat(t) in expected_set:
                continue
            parts.append(t)
    return smart_join(parts)


def quantiles(values: list[float], qs: list[float]) -> list[float]:
    if not values:
        return [0.0] * len(qs)
    vs = sorted(values)
    out = []
    for q in qs:
        i = min(max(int(q * (len(vs) - 1)), 0), len(vs) - 1)
        out.append(vs[i])
    return out


def kmeans1d_median(xs: list[float], k: int = 4, iters: int = 20) -> list[float]:
    if not xs:
        return []
    xs_sorted = sorted(xs)
    if k <= 1:
        return [statistics.median(xs_sorted)]
    qs = [(i + 0.5) / k for i in range(k)]
    centers = quantiles(xs_sorted, qs)
    for _ in range(iters):
        buckets: list[list[float]] = [[] for _ in range(k)]
        for x in xs_sorted:
            idx = min(range(k), key=lambda i: abs(x - centers[i]))
            buckets[idx].append(x)
        new_centers: list[float] = []
        for b in buckets:
            new_centers.append(statistics.median(b) if b else statistics.median(xs_sorted))
        if all(abs(new_centers[i] - centers[i]) < 0.25 for i in range(k)):
            centers = new_centers
            break
        centers = new_centers
    return sorted(centers)


def header_has_items(
    lines: list[list[dict[str, Any]]],
    header: dict[str, Any],
    page_w: float,
    header_row: list[dict[str, Any]],
    all_headers: list[dict[str, Any]],
) -> bool:
    row = sorted(header_row, key=lambda r: r["x0"])
    if len(row) == 1:
        x0, x1 = 0.0, float(page_w)
    else:
        edges = (
            [0.0]
            + [(row[i]["x0"] + row[i + 1]["x0"]) / 2.0 for i in range(len(row) - 1)]
            + [float(page_w)]
        )
        hi = next(i for i, h in enumerate(row) if h is header)
        x0, x1 = edges[hi], edges[hi + 1]
    y0 = header["y0"]
    y1 = y0 + HEADER_VALIDATE_Y_RANGE
    for ln in lines:
        ly = min(s["y0"] for s in ln)
        if not (y0 <= ly < y1):
            continue
        for s in ln:
            if s["x1"] < x0 or s["x0"] > x1:
                continue
            if SCORE_RE.match((s.get("t") or "").strip()):
                return True
    return False


def decide_order_mode(
    items_xy: list[tuple[float, float]],
    row_groups: list[list[dict[str, float]]],
) -> str:
    if not items_xy:
        return "row"
    xs = [x for (x, y) in items_xy]
    centers = kmeans1d_median(xs, k=4, iters=25)

    def col_idx(x: float) -> int:
        return min(range(len(centers)), key=lambda i: abs(x - centers[i]))

    cols = [col_idx(x) for (x, _) in items_xy]
    non_empty = len({c for c in cols})
    avg_spread = sum(abs(xs[i] - centers[cols[i]]) for i in range(len(xs))) / max(1, len(xs))
    if non_empty >= 3 and avg_spread < 20.0:
        return "column4"
    if row_groups and statistics.median(len(g) for g in row_groups) >= 3:
        return "row"
    return "row"


def parse_pdf(
    input_path: str, start_page: int = 1, end_page: int = 999, order_mode: str = "auto"
) -> dict[str, Any]:
    doc = fitz.open(input_path)
    try:
        out_pages = []
        allowed_set = set(CATEGORY_NAMES)
        required_headers = {"Dairy", "Eggs"}
        found_required = set()

        for pno in range(start_page, min(end_page, len(doc)) + 1):
            page = doc[pno - 1]
            spans = page_spans(page)
            lines = cluster_lines(spans, y_tol=Y_LINE_TOL)

            headers = detect_headers(lines)
            if not headers:
                continue

            for h in headers:
                if h["name"] in required_headers:
                    found_required.add(h["name"])

            header_rows = group_headers_into_rows(headers)
            cat_boxes = build_row_boxes(header_rows, page.rect.width)

            valid_headers = []
            for row in header_rows:
                for h in row:
                    if header_has_items(lines, h, page.rect.width, row, headers):
                        valid_headers.append(h)
            if not valid_headers:
                continue

            for h in valid_headers:
                if h["name"] in required_headers:
                    found_required.add(h["name"])

            header_rows = group_headers_into_rows(valid_headers)
            cat_boxes = build_row_boxes(header_rows, page.rect.width)

            totals = find_total_lines(lines)
            cat_boxes = clamp_y1_with_totals(cat_boxes, totals)

            headers_by_y = sorted(valid_headers, key=lambda h: h["y0"])
            for i, h in enumerate(headers_by_y):
                name = h["name"]
                y0, y1, x0, x1 = cat_boxes[name]
                next_y0 = headers_by_y[i + 1]["y0"] if (i + 1) < len(headers_by_y) else math.inf
                if next_y0 != math.inf:
                    y1 = min(y1, next_y0)
                if math.isinf(y1):
                    y1 = find_footer_page_y(lines, page.rect.height)
                cat_boxes[name] = (y0, y1, x0, x1)

            header_y_map = {h["name"]: (h["y0"], h["y1"]) for h in valid_headers}
            section = (
                "Toxins"
                if any(h["name"] in ("HeavyMetals", "Lectins") for h in valid_headers)
                else "Foods"
            )
            categories: list[dict[str, Any]] = []
            page_obj = {"page": pno, "section": section, "categories": categories}

            for h in headers_by_y:
                cname = h["name"]
                y0, y1, x0, x1 = cat_boxes[cname]
                _hy0, hy1 = header_y_map.get(cname, (None, None))

                scores = find_scores_in_box(lines, x0, x1, y0, y1)
                if not scores:
                    categories.append({"name": cname, "items": []})
                    continue
                row_groups = cluster_score_rows(scores, tol=ROW_CLUSTER_TOL)
                row_centers = [sum(s["y"] for s in g) / len(g) for g in row_groups]
                bands = build_row_bands(row_centers, y0, y1)
                bands = [(max(bt, y0), min(bb, y1 - 1.0)) for (bt, bb) in bands]
                if bands and hy1 is not None:
                    bt, bb = bands[0]
                    bands[0] = (max(bt, hy1 + 1.0), bb)

                tmp: list[dict[str, Any]] = []
                for g, (band_top, band_bot) in zip(row_groups, bands, strict=False):
                    g = sorted(g, key=lambda s: s["x"])
                    xs = [float(sc["x"]) for sc in g]
                    for idx, sc in enumerate(g):
                        x_coord = float(sc["x"])
                        win_l = max(x0, xs[idx] + WINDOW_LEFT_PAD)
                        win_r = min(
                            x1, (xs[idx + 1] - WINDOW_RIGHT_PAD) if idx + 1 < len(xs) else x1
                        )
                        label = collect_label_window(
                            lines, band_top, band_bot, win_l, win_r, expected_set=allowed_set
                        )
                        if not label and idx + 1 < len(xs):
                            pad = 4.0
                            label = collect_label_window(
                                lines,
                                band_top,
                                band_bot,
                                win_l,
                                min(x1, xs[idx + 1] - WINDOW_RIGHT_PAD + pad),
                                expected_set=allowed_set,
                            )
                        try:
                            score_val = int(sc["t"])
                        except ValueError:
                            continue
                        row_avg = float(sum(s["y"] for s in g) / len(g))
                        tmp.append(
                            {
                                "name": label,
                                "score": score_val,
                                "severity": severity(score_val),
                                "_x": x_coord,
                                "_ry": row_avg,
                            }
                        )

                if not tmp:
                    categories.append({"name": cname, "items": []})
                    continue

                # Decide per-category ordering
                mode = order_mode
                if order_mode == "auto":
                    items_xy = [(float(it["_x"]), float(it["_ry"])) for it in tmp]
                    mode = decide_order_mode(items_xy, row_groups)

                if mode == "row":
                    ordered = sorted(tmp, key=lambda r: (r["_ry"], r["_x"]))
                else:
                    xs_all = [float(it["_x"]) for it in tmp]
                    centers = kmeans1d_median(xs_all, k=4, iters=25)
                    uniq_rows = sorted({round(float(it["_ry"]), 2) for it in tmp})

                    for it in tmp:
                        it["_col"] = _nearest_index(float(it["_x"]), centers)
                        it["_row"] = _nearest_index(float(it["_ry"]), uniq_rows)
                    ordered = sorted(tmp, key=lambda r: (r["_col"], r["_row"]))

                items = [
                    {"name": it["name"], "score": it["score"], "severity": it["severity"]}
                    for it in ordered
                ]
                categories.append({"name": cname, "items": items})

            out_pages.append(page_obj)

        if not out_pages:
            raise ValueError("Unable to locate any food report categories in the supplied PDF.")

        missing = required_headers - found_required
        if missing:
            missing_list = ", ".join(sorted(missing))
            raise ValueError(
                f"Food PDF validation failed: missing expected categories {missing_list}."
            )

        return {"pages": out_pages}
    finally:
        doc.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="Parse PDF → JSON (v6g: per-category AUTO ordering).")
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
