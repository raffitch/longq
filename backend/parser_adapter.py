from collections.abc import Callable
from importlib import import_module
from pathlib import Path
from typing import Any

try:
    from parse_food_pdf import parse_pdf as parse_food_pdf  # your real function
except Exception as e:
    parse_food_pdf = None
    _food_import_error = e

try:
    from parse_nutrition_pdf import parse_pdf as parse_nutrition_pdf
except Exception as e:
    parse_nutrition_pdf = None
    _nutrition_import_error = e

try:
    from parse_hormones_pdf import parse_pdf as parse_hormones_pdf
except Exception as e:
    parse_hormones_pdf = None
    _hormones_import_error = e

try:
    from parse_heavy_metals_pdf import parse_pdf as parse_heavy_metals_pdf
except Exception as e:
    parse_heavy_metals_pdf = None
    _heavy_import_error = e

try:
    from parse_toxins_pdf import parse_pdf as parse_toxins_pdf
except Exception as e:
    parse_toxins_pdf = None
    _toxins_import_error = e

parse_peek_report: Callable[[Path], Any] | None = None
_peek_import_error: Exception | None = None

for module_name in ("backend.parse_peek_report", "parse_peek_report"):
    try:
        module = import_module(module_name)
    except Exception as exc:  # pragma: no cover - import fallback guard
        _peek_import_error = exc
        continue
    fallback_func = getattr(module, "parse_report", None)
    if callable(fallback_func):
        parse_peek_report = fallback_func  # type: ignore[assignment]
        _peek_import_error = None
        break


def _fallback(pdf_path: str) -> dict:
    return {"meta": {"note": "Fallback parser in use", "file": pdf_path}, "pages": []}


def parse_file(kind: str, pdf_path: Path) -> tuple[str, Any]:
    if kind == "food":
        if parse_food_pdf is None:
            return ("fallback", _fallback(str(pdf_path)))
        data = parse_food_pdf(str(pdf_path), start_page=1, end_page=999, order_mode="auto")
        if not isinstance(data, dict) or "pages" not in data:
            raise RuntimeError("Food parser returned unexpected shape; expected dict with 'pages'.")
        return ("food-v6g", data)

    if kind == "nutrition":
        if parse_nutrition_pdf is None:
            raise ValueError(
                "Nutrition parser not available; ensure parse_nutrition_pdf is importable."
            )
        data = parse_nutrition_pdf(str(pdf_path))
        if not isinstance(data, dict) or "items" not in data:
            raise RuntimeError(
                "Nutrition parser returned unexpected shape; expected dict with 'items'."
            )
        return ("nutrition-v1", data)

    if kind == "hormones":
        if parse_hormones_pdf is None:
            raise ValueError(
                "Hormones parser not available; ensure parse_hormones_pdf is importable."
            )
        data = parse_hormones_pdf(str(pdf_path))
        if not isinstance(data, dict) or "items" not in data:
            raise RuntimeError(
                "Hormones parser returned unexpected shape; expected dict with 'items'."
            )
        return ("hormones-v1", data)

    if kind == "heavy-metals":
        if parse_heavy_metals_pdf is None:
            raise ValueError(
                "Heavy-metals parser not available; ensure parse_heavy_metals_pdf is importable."
            )
        data = parse_heavy_metals_pdf(str(pdf_path))
        if not isinstance(data, dict) or "items" not in data:
            raise RuntimeError(
                "Heavy-metals parser returned unexpected shape; expected dict with 'items'."
            )
        return ("heavy-metals-v1", data)

    if kind == "toxins":
        if parse_toxins_pdf is None:
            raise ValueError("Toxins parser not available; ensure parse_toxins_pdf is importable.")
        data = parse_toxins_pdf(str(pdf_path))
        if not isinstance(data, dict) or "items" not in data:
            raise RuntimeError(
                "Toxins parser returned unexpected shape; expected dict with 'items'."
            )
        return ("toxins-v1", data)

    if kind == "peek":
        if parse_peek_report is None:
            raise ValueError(
                "PEEK parser not available; ensure parse_peek_report is importable "
                "(python-docx installed?)."
            )
        data = parse_peek_report(Path(pdf_path))  # type: ignore[arg-type]
        if not isinstance(data, dict):
            raise RuntimeError(
                "PEEK parser returned unexpected shape; expected dict with 'organs' and 'chakras'."
            )
        return ("peek-v1", data)

    raise ValueError(f"Unsupported kind: {kind}")
