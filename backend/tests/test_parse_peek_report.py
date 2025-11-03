import sys
from pathlib import Path


sys.path.append(str(Path(__file__).resolve().parents[2]))


from backend.parse_peek_report import (
    _parse_chakra_tokens,
    _parse_organ_tokens,
    _tokenize_line,
    CHAKRA_ID_BY_NUM,
)


def test_tokenize_line_handles_arrows_and_chevrons():
    line = "Organs -> LI -> Large Intestine > 53"
    assert _tokenize_line(line) == ["Organs", "LI", "Large Intestine", "53"]


def test_tokenize_line_handles_table_delimiters():
    line = "Organs | KI | Kidneys | 48"
    assert _tokenize_line(line) == ["Organs", "KI", "Kidneys", "48"]


def test_parse_organ_tokens_returns_mapped_id_and_value():
    tokens = ["Organs", "LI", "Large Intestine", "53"]
    assert _parse_organ_tokens(tokens) == ("large_intestine", 53)


def test_parse_organ_tokens_falls_back_to_single_token():
    tokens = ["Organs", "Pancreas", "41"]
    assert _parse_organ_tokens(tokens) == ("spleen", 41)


def test_parse_chakra_tokens_uses_numeric_mapping():
    tokens = ["Chakra", "6", "Indigo", "81"]
    chakra_id, value = _parse_chakra_tokens(tokens)
    assert chakra_id == CHAKRA_ID_BY_NUM[6]
    assert value == 81
