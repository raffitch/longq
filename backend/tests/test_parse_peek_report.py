import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[2]))

from backend.parse_peek_report import (
    CHAKRA_ID_BY_NUM,
    _parse_chakra_tokens,
    _parse_organ_tokens,
    _parse_special_metric,
    _tokenize_line,
)


def test_tokenize_line_handles_arrows_and_chevrons() -> None:
    line = "Organs -> LI -> Large Intestine > 53"
    assert _tokenize_line(line) == ["Organs", "LI", "Large Intestine", "53"]


def test_tokenize_line_handles_table_delimiters() -> None:
    line = "Organs | KI | Kidneys | 48"
    assert _tokenize_line(line) == ["Organs", "KI", "Kidneys", "48"]


def test_parse_organ_tokens_returns_mapped_id_and_value() -> None:
    tokens = ["Organs", "LI", "Large Intestine", "53"]
    assert _parse_organ_tokens(tokens) == ("large_intestine", 53)


def test_parse_organ_tokens_falls_back_to_single_token() -> None:
    tokens = ["Organs", "Pancreas", "41"]
    assert _parse_organ_tokens(tokens) == ("pancreas_placeholder", 41)


def test_parse_chakra_tokens_uses_numeric_mapping() -> None:
    tokens = ["Chakra", "6", "Indigo", "81"]
    parsed = _parse_chakra_tokens(tokens)
    assert parsed is not None
    chakra_id, value = parsed
    assert chakra_id == CHAKRA_ID_BY_NUM[6]
    assert value == 81


def test_parse_special_metric_extracts_inflammatory_score() -> None:
    tokens = ["Organs", "As", "Inflammatory score", "7 (Very Low)"]
    source_line = "Organs -> As -> Inflammatory score > 7 (Very Low)"
    parsed = _parse_special_metric(tokens, source_line)
    assert parsed is not None
    metric_id, metric_values = parsed
    assert metric_id == "inflammatory_score"
    assert metric_values["value"] == 7
    assert metric_values["label"] == "Very Low"


def test_parse_special_metric_extracts_immunal_defense() -> None:
    tokens = ["Organs", "Ai", "Immunal defense", "72 (Normal)"]
    source_line = "Organs -> Ai -> Immunal defense > 72 (Normal)"
    parsed = _parse_special_metric(tokens, source_line)
    assert parsed is not None
    metric_id, metric_values = parsed
    assert metric_id == "immunal_defense"
    assert metric_values["value"] == 72
    assert metric_values["label"] == "Normal"
