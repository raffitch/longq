from importlib import import_module
from pathlib import Path
from typing import Any, Protocol, cast


class FoodParser(Protocol):
    def __call__(
        self: "FoodParser",
        pdf_path: str,
        start_page: int = ...,
        end_page: int = ...,
        order_mode: str = ...,
    ) -> dict[str, Any]: ...


class SimpleParser(Protocol):
    def __call__(self: "SimpleParser", pdf_path: str) -> dict[str, Any]: ...


class PeekParser(Protocol):
    def __call__(self: "PeekParser", pdf_path: Path) -> dict[str, Any]: ...


parse_food_pdf: FoodParser | None = None
parse_nutrition_pdf: SimpleParser | None = None
parse_hormones_pdf: SimpleParser | None = None
parse_heavy_metals_pdf: SimpleParser | None = None
parse_toxins_pdf: SimpleParser | None = None

_food_import_error: Exception | None = None
_nutrition_import_error: Exception | None = None
_hormones_import_error: Exception | None = None
_heavy_import_error: Exception | None = None
_toxins_import_error: Exception | None = None

try:
    from parse_food_pdf import parse_pdf as _food_parser
except Exception as e:
    _food_import_error = e
else:
    parse_food_pdf = cast(FoodParser, _food_parser)

try:
    from parse_nutrition_pdf import parse_pdf as _nutrition_parser
except Exception as e:
    _nutrition_import_error = e
else:
    parse_nutrition_pdf = cast(SimpleParser, _nutrition_parser)

try:
    from parse_hormones_pdf import parse_pdf as _hormones_parser
except Exception as e:
    _hormones_import_error = e
else:
    parse_hormones_pdf = cast(SimpleParser, _hormones_parser)

try:
    from parse_heavy_metals_pdf import parse_pdf as _heavy_metals_parser
except Exception as e:
    _heavy_import_error = e
else:
    parse_heavy_metals_pdf = cast(SimpleParser, _heavy_metals_parser)

try:
    from parse_toxins_pdf import parse_pdf as _toxins_parser
except Exception as e:
    _toxins_import_error = e
else:
    parse_toxins_pdf = cast(SimpleParser, _toxins_parser)

parse_peek_report: PeekParser | None = None
_peek_import_error: Exception | None = None

for module_name in ("backend.parse_peek_report", "parse_peek_report"):
    try:
        module = import_module(module_name)
    except Exception as exc:  # pragma: no cover - import fallback guard
        _peek_import_error = exc
        continue
    fallback_func = getattr(module, "parse_report", None)
    if callable(fallback_func):
        parse_peek_report = cast(PeekParser, fallback_func)
        _peek_import_error = None
        break


def _fallback(pdf_path: str) -> dict[str, Any]:
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
        data = parse_peek_report(pdf_path)
        if not isinstance(data, dict):
            raise RuntimeError(
                "PEEK parser returned unexpected shape; expected dict with 'organs' and 'chakras'."
            )
        return ("peek-v1", data)

    raise ValueError(f"Unsupported kind: {kind}")
