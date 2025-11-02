#!/usr/bin/env python3
"""
parse_word_reports_cardenergymap_v2.py
--------------------------------------
Reads a single Word report (.docx or .doc) and outputs JSON your CardEnergyMap can use.

Fixes:
- Reads both normal paragraphs AND table cells (your rows are in a table).
- Accepts ASCII '->' and Unicode arrows (→ ➔ ➜), and '>' or '›' before the value.
- Keeps strict sequences only:
    Organs -> CODE -> Name > 53
    Chakra -> 6 -> Indigo > 81
- Maps organ names to CardEnergyMap IDs; only known IDs are emitted.

Usage:
  pip install python-docx
  # For .doc files (optional): brew install --cask libreoffice
  python3 parse_word_reports_cardenergymap_v2.py "/path/to/report.docx" -o cardenergymap_values.json
"""
import argparse, json, re, shutil, subprocess, tempfile
from pathlib import Path
from typing import Dict, List, Any

try:
    from docx import Document  # pip install python-docx
except Exception:
    Document = None

# Allow ASCII '->' and common Unicode arrows; allow '>' or '›'
ARROW = r"(?:->|→|➔|➜|:)"
CHEVR = r"(?:>|›)"
VALUE_RE = re.compile(r"(\d{1,3})\b")

# Organ IDs your UI knows
TARGET_ORGAN_IDS = [
    "brain","thyroid","lungs","heart","lymphatic","liver","spleen","stomach",
    "gallbladder","kidneys","small_intestine","large_intestine","bladder",
    "reproductive_male","reproductive_female",
]

# Map report names/synonyms → IDs above
NAME_TO_ID = {
    "brain": "brain",
    "thyroid": "thyroid",
    "lung": "lungs", "lungs": "lungs",
    "heart": "heart",
    "lymphatic": "lymphatic", "lymphatic system": "lymphatic",
    "liver": "liver",
    "spleen": "spleen",
    "stomach": "stomach",
    "gall bladder": "gallbladder", "gallbladder": "gallbladder",
    "kidney": "kidneys", "kidneys": "kidneys",
    "small intestine": "small_intestine", "si": "small_intestine",
    "large intestine": "large_intestine", "li": "large_intestine", "colon": "large_intestine",
    "bladder": "bladder", "urinary bladder": "bladder",

    # TCM / alternates → nearest UI slot
    "san-jiao": "lymphatic", "san jiao": "lymphatic", "triple burner": "lymphatic", "sanjiao": "lymphatic",
    "spleen-pancreas": "spleen", "pancreas": "spleen",
    "duodenum": "small_intestine",
    "intestine (small)": "small_intestine",
    "intestine (large)": "large_intestine",

    # reproductive
    "prostate": "reproductive_male",
    "testes": "reproductive_male", "testicles": "reproductive_male",
    "uterus": "reproductive_female", "ovary": "reproductive_female", "ovaries": "reproductive_female",
    "endometrium": "reproductive_female",
}

CHAKRA_ID_BY_NUM = {
    1: "Chakra_01_Root",
    2: "Chakra_02_Sacral",
    3: "Chakra_03_SolarPlexus",
    4: "Chakra_04_Heart",
    5: "Chakra_05_Throat",
    6: "Chakra_06_ThirdEye",
    7: "Chakra_07_Crown",
}

def _read_doc_all_lines(path: Path) -> List[str]:
    """Read visible text from paragraphs AND table cells, preserving order."""
    if Document is None:
        raise RuntimeError("python-docx is not installed. Run: pip install python-docx")
    doc = Document(str(path))
    lines: List[str] = []

    # Normal paragraphs
    for p in doc.paragraphs:
        t = (p.text or "").strip()
        if t:
            lines.append(t)

    # Tables (each cell has its own paragraphs)
    for tbl in doc.tables:
        for row in tbl.rows:
            cell_texts: List[str] = []
            for cell in row.cells:
                cell_value = " ".join((p.text or "").strip() for p in cell.paragraphs if (p.text or "").strip())
                if cell_value:
                    cell_texts.append(cell_value)
            if cell_texts:
                lines.append(" | ".join(cell_texts))
    return lines

def _has_soffice() -> bool:
    return bool(shutil.which("soffice") or shutil.which("soffice.bin"))

def _convert_doc_to_docx(src_doc: Path, tmpdir: Path) -> Path:
    if not _has_soffice():
        raise RuntimeError("LibreOffice (soffice) not found for .doc conversion. Install it or convert to .docx manually.")
    cmd = [shutil.which("soffice") or "soffice", "--headless", "--convert-to", "docx", "--outdir", str(tmpdir), str(src_doc)]
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"LibreOffice failed to convert {src_doc.name}:\n{proc.stderr or proc.stdout}")
    out_path = tmpdir / (src_doc.stem + ".docx")
    if not out_path.exists():
        raise RuntimeError(f"Converted file not found at {out_path}")
    return out_path

def read_word_lines(path: Path) -> List[str]:
    suf = path.suffix.lower()
    if suf == ".docx":
        return _read_doc_all_lines(path)
    if suf == ".doc":
        with tempfile.TemporaryDirectory() as td:
            td_path = Path(td)
            docx_path = _convert_doc_to_docx(path, td_path)
            return _read_doc_all_lines(docx_path)
    raise RuntimeError(f"Unsupported file type: {path.suffix}")

def _norm(s: str) -> str:
    s = s.strip().lower()
    s = re.sub(r"[.\u200b]", " ", s)
    s = re.sub(r"\s+", " ", s)
    return s

def _map_name_to_id(name: str) -> str | None:
    key = _norm(name)
    if key in NAME_TO_ID:
        return NAME_TO_ID[key]
    base = re.sub(r"\s*\(.*?\)\s*", "", key).strip()
    if base in NAME_TO_ID:
        return NAME_TO_ID[base]
    for part in re.split(r"[-/]", base):
        part = part.strip()
        if part in NAME_TO_ID:
            return NAME_TO_ID[part]
    return None

def parse_report(path: Path) -> Dict[str, Any]:
    lines = read_word_lines(path)
    organs: Dict[str, int] = {}
    chakras: Dict[str, int] = {}

    for raw in lines:
        line = " ".join(raw.replace("\u200b", " ").split())
        tokens = _tokenize_line(raw)

        if tokens:
            header = tokens[0].lower()
            if header.startswith("organs"):
                parsed = _parse_organ_tokens(tokens)
                if parsed:
                    oid, value = parsed
                    organs[oid] = value
                    continue
            if header.startswith("chakra"):
                parsed = _parse_chakra_tokens(tokens)
                if parsed:
                    cid, value = parsed
                    chakras[cid] = value
                    continue

        # Fallback: attempt to parse inline text with arrows/chevrons
        tokens_from_line = _tokenize_line(line)
        if tokens_from_line:
            header = tokens_from_line[0].lower()
            if header.startswith("organs"):
                parsed = _parse_organ_tokens(tokens_from_line)
                if parsed:
                    oid, value = parsed
                    organs[oid] = value
                continue
            if header.startswith("chakra"):
                parsed = _parse_chakra_tokens(tokens_from_line)
                if parsed:
                    cid, value = parsed
                    chakras[cid] = value
                continue

    return {"organs": organs, "chakras": chakras}

def main():
    ap = argparse.ArgumentParser(description="Parse a Word report into CardEnergyMap-ready JSON (tables supported).")
    ap.add_argument("input", help="Path to .docx or .doc file")
    ap.add_argument("-o", "--out", default="cardenergymap_values.json", help="Output JSON path")
    args = ap.parse_args()

    data = parse_report(Path(args.input))
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"Wrote {args.out}")

if __name__ == "__main__":
    main()
