from pathlib import Path
from typing import Any, Tuple

try:
    from parse_food_pdf import parse_pdf  # your real function
except Exception as e:
    parse_pdf = None
    _import_error = e

def _fallback(pdf_path: str) -> dict:
    return {"meta": {"note": "Fallback parser in use", "file": pdf_path}, "pages": []}

def parse_file(kind: str, pdf_path: Path) -> Tuple[str, Any]:
    if kind != "food":
        raise ValueError(f"Unsupported kind: {kind}")

    if parse_pdf is None:
        return ("fallback", _fallback(str(pdf_path)))

    # ✅ use correct parameter names
    data = parse_pdf(str(pdf_path), start_page=1, end_page=999, order_mode="auto")

    # sanity check
    if not isinstance(data, dict) or "pages" not in data:
        raise RuntimeError("Parser returned unexpected shape; expected dict with 'pages' key.")
    return ("v6g", data)
