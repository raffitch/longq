from __future__ import annotations

import sys
from io import BytesIO
from pathlib import Path

import pytest
from fastapi import UploadFile

ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = ROOT / "backend"
for candidate in (ROOT, BACKEND_ROOT):
    path_str = str(candidate)
    if path_str not in sys.path:
        sys.path.append(path_str)

import app as app_module  # noqa: E402


def _make_upload(payload: bytes, filename: str = "sample.pdf") -> UploadFile:
    return UploadFile(filename=filename, file=BytesIO(payload))


def test_read_upload_payload_accepts_within_limit() -> None:
    upload = _make_upload(b"x" * 128)
    data = app_module._read_upload_payload(upload, max_bytes=256)
    assert data == b"x" * 128


def test_read_upload_payload_rejects_over_limit() -> None:
    upload = _make_upload(b"x" * 512)
    with pytest.raises(app_module.UploadTooLargeError) as excinfo:
        app_module._read_upload_payload(upload, max_bytes=256)
    assert "512 B" in str(excinfo.value)


def test_read_upload_payload_reports_total_size_from_seekable_file() -> None:
    payload = b"x" * (5 * 1024 * 1024)
    upload = _make_upload(payload)
    with pytest.raises(app_module.UploadTooLargeError) as excinfo:
        app_module._read_upload_payload(upload, max_bytes=2 * 1024 * 1024)
    assert "5.0 MB" in str(excinfo.value)
