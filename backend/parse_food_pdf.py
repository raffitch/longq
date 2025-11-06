#!/usr/bin/env python3
# (See docstring in previous attempt for details.)
import argparse, json, math, re, statistics
from typing import Any, Dict, List, Tuple
import fitz  # PyMuPDF

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


def canon_cat(s: str) -> str:
    return CANON.get(" ".join(s.split()).lower(), s)


def severity(score: int) -> str:
    for cutoff, name in THRESHOLDS:
        if score >= cutoff:
            return name
    return "low"


def page_spans(page: fitz.Page):
    d = page.get_text("dict")
    out = []
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


def cluster_lines(spans, y_tol=Y_LINE_TOL):
    lines = []
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


def find_total_lines(lines):
    totals = []
    for ln in lines:
        txt = " ".join(s["t"] for s in ln)
        if TOTAL_RE.match(txt):
            y = min(s["y0"] for s in ln)
            x0 = min(s["x0"] for s in ln)
            x1 = max(s["x1"] for s in ln)
            totals.append({"y": y, "x0": x0, "x1": x1, "text": txt})
    totals.sort(key=lambda r: r["y"])
    return totals


def detect_headers(lines):
    allowed = set(CATEGORY_NAMES)
    headers = []
    for ln in lines:
        for s in ln:
            nm = canon_cat(s["t"])
            if nm in allowed:
                headers.append({"name": nm, "x0": s["x0"], "y0": s["y0"], "y1": s["y1"]})
    headers.sort(key=lambda h: (h["y0"], h["x0"]))
    return headers


def group_headers_into_rows(headers):
    rows = []
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


def build_row_boxes(rows, page_w: float):
    boxes = {}
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


def find_footer_page_y(lines, page_height: float) -> float:
    for ln in reversed(lines):
        txt = " ".join(s["t"] for s in ln).strip().lower()
        if "page" in txt:
            for sp in ln:
                if "page" in sp["t"].lower():
                    return sp["y0"]
            return min(s["y0"] for s in ln)
    return page_height


def intersect_x(a0, a1, b0, b1) -> float:
    return max(0.0, min(a1, b1) - max(a0, b0))


def clamp_y1_with_totals(cat_boxes, totals):
    new = {}
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


def find_scores_in_box(lines, x0, x1, y0, y1):
    scores = []
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


def cluster_score_rows(scores, tol=ROW_CLUSTER_TOL):
    rows = []
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


def build_row_bands(row_centers, cat_y0, cat_y1):
    bands = []
    if not row_centers:
        return bands
    for i, y in enumerate(row_centers):
        upper = cat_y0 if i == 0 else (row_centers[i - 1] + y) / 2.0
        lower = cat_y1 if i == len(row_centers) - 1 else (y + row_centers[i + 1]) / 2.0
        y_top = max(cat_y0, upper - ROW_PAD_UP)
        y_bot = min(cat_y1, lower + ROW_PAD_DOWN)
        bands.append((y_top, y_bot))
    return bands


def smart_join(parts):
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


def collect_label_window(lines, y_top, y_bot, x_left, x_right, expected_set):
    parts = []
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


def quantiles(values, qs):
    if not values:
        return [0.0] * len(qs)
    vs = sorted(values)
    out = []
    for q in qs:
        i = min(max(int(q * (len(vs) - 1)), 0), len(vs) - 1)
        out.append(vs[i])
    return out


def kmeans1d_median(xs, k=4, iters=20):
    if not xs:
        return []
    xs_sorted = sorted(xs)
    if k <= 1:
        return [statistics.median(xs_sorted)]
    qs = [(i + 0.5) / k for i in range(k)]
    centers = quantiles(xs_sorted, qs)
    for _ in range(iters):
        buckets = [[] for _ in range(k)]
        for x in xs_sorted:
            idx = min(range(k), key=lambda i: abs(x - centers[i]))
            buckets[idx].append(x)
        new_centers = []
        for b in buckets:
            new_centers.append(statistics.median(b) if b else statistics.median(xs_sorted))
        if all(abs(new_centers[i] - centers[i]) < 0.25 for i in range(k)):
            centers = new_centers
            break
        centers = new_centers
    return sorted(centers)


def header_has_items(lines, header, page_w: float, header_row, all_headers):
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


def decide_order_mode(items_xy, row_groups):
    if not items_xy:
        return "row"
    xs = [x for (x, y) in items_xy]
    centers = kmeans1d_median(xs, k=4, iters=25)

    def col_idx(x):
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
) -> Dict[str, Any]:
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
            page_obj = {"page": pno, "section": section, "categories": []}

            for h in headers_by_y:
                cname = h["name"]
                y0, y1, x0, x1 = cat_boxes[cname]
                hy0, hy1 = header_y_map.get(cname, (None, None))

                scores = find_scores_in_box(lines, x0, x1, y0, y1)
                if not scores:
                    page_obj["categories"].append({"name": cname, "items": []})
                    continue
                row_groups = cluster_score_rows(scores, tol=ROW_CLUSTER_TOL)
                row_centers = [sum(s["y"] for s in g) / len(g) for g in row_groups]
                bands = build_row_bands(row_centers, y0, y1)
                bands = [(max(bt, y0), min(bb, y1 - 1.0)) for (bt, bb) in bands]
                if bands and hy1 is not None:
                    bt, bb = bands[0]
                    bands[0] = (max(bt, hy1 + 1.0), bb)

                tmp = []
                for g, (band_top, band_bot) in zip(row_groups, bands):
                    g = sorted(g, key=lambda s: s["x"])
                    xs = [sc["x"] for sc in g]
                    for i, sc in enumerate(g):
                        win_l = max(x0, xs[i] + WINDOW_LEFT_PAD)
                        win_r = min(x1, (xs[i + 1] - WINDOW_RIGHT_PAD) if i + 1 < len(xs) else x1)
                        label = collect_label_window(
                            lines, band_top, band_bot, win_l, win_r, expected_set=allowed_set
                        )
                        if not label and i + 1 < len(xs):
                            pad = 4.0
                            label = collect_label_window(
                                lines,
                                band_top,
                                band_bot,
                                win_l,
                                min(x1, xs[i + 1] - WINDOW_RIGHT_PAD + pad),
                                expected_set=allowed_set,
                            )
                        try:
                            score_val = int(sc["t"])
                        except ValueError:
                            continue
                        tmp.append(
                            {
                                "name": label,
                                "score": score_val,
                                "severity": severity(score_val),
                                "_x": sc["x"],
                                "_ry": sum(s["y"] for s in g) / len(g),
                            }
                        )

                if not tmp:
                    page_obj["categories"].append({"name": cname, "items": []})
                    continue

                # Decide per-category ordering
                mode = order_mode
                if order_mode == "auto":
                    items_xy = [(it["_x"], it["_ry"]) for it in tmp]
                    mode = decide_order_mode(items_xy, row_groups)

                if mode == "row":
                    ordered = sorted(tmp, key=lambda r: (r["_ry"], r["_x"]))
                else:
                    xs_all = [it["_x"] for it in tmp]
                    centers = kmeans1d_median(xs_all, k=4, iters=25)

                    def col_index(x):
                        return min(range(len(centers)), key=lambda i: abs(x - centers[i]))

                    uniq_rows = sorted({round(v, 2) for v in (it["_ry"] for it in tmp)})

                    def row_index(ry):
                        return min(range(len(uniq_rows)), key=lambda i: abs(ry - uniq_rows[i]))

                    for it in tmp:
                        it["_col"] = col_index(it["_x"])
                        it["_row"] = row_index(it["_ry"])
                    ordered = sorted(tmp, key=lambda r: (r["_col"], r["_row"]))

                items = [
                    {"name": it["name"], "score": it["score"], "severity": it["severity"]}
                    for it in ordered
                ]
                page_obj["categories"].append({"name": cname, "items": items})

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


def main():
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
