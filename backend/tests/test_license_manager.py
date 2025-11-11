from __future__ import annotations

import json
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from nacl.signing import SigningKey

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend import license_manager
from backend.license_manager import (
    ActivationError,
    LicenseManager,
    canonical_payload,
    compute_fingerprint,
    hashlib_sha256,
)


def _sample_payload() -> dict[str, Any]:
    return {
        "license_id": "LIC-TEST",
        "product": license_manager.PRODUCT_CODE,
        "email_hash": "abc123",
        "fingerprint_sha256": "deadbeef",
        "issued_at": "2024-01-01T00:00:00Z",
        "not_before": "2024-01-01T00:00:00Z",
        "never_expires": True,
        "features": ["core"],
        "key_version": 1,
    }


def _sign_payload(signing_key: SigningKey, payload: dict[str, Any]) -> dict[str, Any]:
    data = dict(payload)
    body = canonical_payload(data)
    signature = signing_key.sign(body).signature.hex()
    data["signature"] = signature
    return data


def test_compute_fingerprint_mac(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(license_manager.sys, "platform", "darwin")
    monkeypatch.setattr(license_manager.os, "name", "posix", raising=False)
    monkeypatch.setattr(license_manager, "_mac_uuid", lambda: "UUID")
    monkeypatch.setattr(license_manager, "_mac_cpu_brand", lambda: "CPU")
    monkeypatch.setattr(license_manager, "_mac_computer_name", lambda: "HOST")
    result = compute_fingerprint()
    assert result == hashlib_sha256(b"UUID|CPU|HOST")


def test_compute_fingerprint_windows(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(license_manager.sys, "platform", "win32")
    monkeypatch.setattr(license_manager.os, "name", "nt", raising=False)
    monkeypatch.setattr(license_manager, "_windows_machine_guid", lambda: "GUID")
    monkeypatch.setattr(license_manager, "_windows_cpu_name", lambda: "ZEN")
    monkeypatch.setattr(license_manager, "_windows_host", lambda: "HOSTWIN")
    result = compute_fingerprint()
    assert result == hashlib_sha256(b"GUID|ZEN|HOSTWIN")


def test_canonical_payload_sorts_keys() -> None:
    payload = {"b": 2, "a": 1, "signature": "skip"}
    expected = json.dumps({"a": 1, "b": 2}, sort_keys=True, separators=(",", ":")).encode("utf-8")
    assert canonical_payload(payload) == expected


def test_verify_signature_success(monkeypatch: pytest.MonkeyPatch) -> None:
    signer = SigningKey.generate()
    payload = _sign_payload(signer, _sample_payload())
    monkeypatch.setattr(license_manager, "PUBLIC_KEYS", {1: signer.verify_key.encode()})
    license_manager.verify_signature(payload)


def _write_license(
    tmp_path: Path,
    signer: SigningKey,
    fingerprint: str,
    *,
    product: str | None = None,
) -> bytes:
    base = _sample_payload()
    base["fingerprint_sha256"] = fingerprint
    if product is not None:
        base["product"] = product
    payload = _sign_payload(signer, base)
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    (tmp_path / "client.lic").write_bytes(raw)
    return raw


@pytest.fixture()
def manager_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Callable[[str], LicenseManager]:
    signer = SigningKey.generate()
    monkeypatch.setattr(license_manager, "PUBLIC_KEYS", {1: signer.verify_key.encode()})
    monkeypatch.setattr(license_manager, "PRODUCT_CODE", "quantum_qi_test")
    monkeypatch.setattr(license_manager, "LICENSE_DISABLED", False)
    monkeypatch.setattr(license_manager, "license_file_path", lambda: tmp_path / "client.lic")
    monkeypatch.setattr(license_manager, "compute_fingerprint", lambda: "fp-1234")

    def factory(state: str) -> LicenseManager:
        if state == "valid":
            _write_license(tmp_path, signer, "fp-1234", product="quantum_qi_test")
        elif state == "mismatch":
            _write_license(tmp_path, signer, "wrong", product="quantum_qi_test")
        elif state == "product":
            _write_license(tmp_path, signer, "fp-1234", product="other")
        else:
            (tmp_path / "client.lic").write_text(state)
        return LicenseManager()

    return factory


def test_license_manager_valid(manager_env: Callable[[str], LicenseManager]) -> None:
    manager = manager_env("valid")
    status = manager.status()
    assert status.state == "valid"
    assert status.license is not None
    assert status.license.product == "quantum_qi_test"


def test_license_manager_fingerprint_mismatch(manager_env: Callable[[str], LicenseManager]) -> None:
    manager = manager_env("mismatch")
    status = manager.status()
    assert status.state == "invalid"
    assert status.error_code == "fingerprint_mismatch"


def test_license_manager_product_mismatch(manager_env: Callable[[str], LicenseManager]) -> None:
    manager = manager_env("product")
    status = manager.status()
    assert status.state == "invalid"
    assert status.error_code == "product_mismatch"


def test_license_location(manager_env: Callable[[str], LicenseManager]) -> None:
    manager = manager_env("valid")
    path, exists = manager.license_location()
    assert path.name == "client.lic"
    assert exists is True


def test_license_activation_flow(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    signer = SigningKey.generate()
    monkeypatch.setattr(license_manager, "PUBLIC_KEYS", {1: signer.verify_key.encode()})
    monkeypatch.setattr(license_manager, "PRODUCT_CODE", "quantum_qi_test")
    monkeypatch.setattr(license_manager, "LICENSE_DISABLED", False)
    monkeypatch.setattr(license_manager, "license_file_path", lambda: tmp_path / "client.lic")
    monkeypatch.setattr(license_manager, "compute_fingerprint", lambda: "fp-activate")

    response_bytes = json.dumps(
        _sign_payload(
            signer,
            {
                **_sample_payload(),
                "product": "quantum_qi_test",
                "fingerprint_sha256": "fp-activate",
                "key_version": 1,
            },
        ),
        separators=(",", ":"),
    ).encode("utf-8")

    def fake_issue(self: LicenseManager, *, email: str, fingerprint: str) -> bytes:
        assert fingerprint == "fp-activate"
        assert email.endswith("@example.com")
        return response_bytes

    monkeypatch.setattr(LicenseManager, "_issue_request", fake_issue, raising=False)

    manager = LicenseManager()
    with pytest.raises(ActivationError):
        manager.activate("")
    status = manager.activate("user@example.com")
    assert status.state == "valid"
    saved = (tmp_path / "client.lic").read_bytes()
    assert saved == response_bytes
    manager2 = LicenseManager()
    assert manager2.status().state == "valid"
