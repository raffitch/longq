from __future__ import annotations

import json
import logging
import os
import platform
import re
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from threading import Lock
from types import ModuleType
from typing import Any, Literal, Self, cast

from nacl.exceptions import BadSignatureError
from nacl.signing import VerifyKey

logger = logging.getLogger("longevityq.license")

DEFAULT_PUBLIC_KEY_HEX = "763f46418ac4ffe0214dbfb766f3b8d8406a7aab0e248519593797c8571b2af9"


def _bool_env(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


APP_VENDOR = os.getenv("LONGQ_LICENSE_VENDOR", "LongQ")
APP_NAME = os.getenv("LONGQ_LICENSE_APP_NAME", "QuantumQi")
LICENSE_API_BASE = os.getenv("LONGQ_LICENSE_API_BASE", "https://license-api.hello-326.workers.dev")
ISSUE_PATH = os.getenv("LONGQ_LICENSE_API_PATH", "/issue")
PRODUCT_CODE = os.getenv("LONGQ_LICENSE_PRODUCT", "quantum_qi")
PUBLIC_KEY_HEX = os.getenv("LONGQ_PUBLIC_KEY_HEX", DEFAULT_PUBLIC_KEY_HEX)
LICENSE_DISABLED = _bool_env("LONGQ_LICENSE_DISABLE", False)
LICENSE_POLL_INTERVAL_SEC = float(os.getenv("LONGQ_LICENSE_POLL_INTERVAL", "60"))

PUBLIC_KEYS: dict[int, bytes] = {}


def _register_public_key(version: int, key_hex: str | None) -> None:
    if not key_hex:
        return
    try:
        PUBLIC_KEYS[version] = bytes.fromhex(key_hex.strip())
    except ValueError:
        logger.warning("Ignoring invalid PUBLIC KEY hex for version %s", version)


_register_public_key(1, PUBLIC_KEY_HEX)
_register_public_key(2, os.getenv("LONGQ_PUBLIC_KEY_V2"))


def _current_ts() -> float:
    return time.time()


def _run_command(args: list[str]) -> str | None:
    try:
        completed = subprocess.run(
            args,
            check=False,
            capture_output=True,
            text=True,
        )
    except (FileNotFoundError, PermissionError):
        return None
    if completed.returncode != 0:
        return None
    return completed.stdout.strip()


def _mac_uuid() -> str | None:
    output = _run_command(["ioreg", "-rd1", "-c", "IOPlatformExpertDevice"])
    if not output:
        return None
    match = re.search(r'"IOPlatformUUID"\s*=\s*"([^"]+)"', output)
    return match.group(1) if match else None


def _mac_cpu_brand() -> str | None:
    value = _run_command(["sysctl", "-n", "machdep.cpu.brand_string"])
    if value:
        return value
    return _run_command(["sysctl", "-n", "hw.model"])


def _mac_computer_name() -> str | None:
    value = _run_command(["scutil", "--get", "ComputerName"])
    if value:
        return value
    return socket.gethostname()


def _winreg_module() -> ModuleType | None:
    try:
        import winreg
    except ImportError:  # pragma: no cover - platform dependent
        return None
    return cast(ModuleType, winreg)


def _winreg_value(root: object, path: str, name: str) -> str | None:
    winreg = _winreg_module()
    if winreg is None:
        return None
    winreg_mod = cast(Any, winreg)
    try:
        with winreg_mod.OpenKey(root, path) as key:
            value, _ = winreg_mod.QueryValueEx(key, name)
            return str(value).strip()
    except OSError:
        return None


def _windows_machine_guid() -> str | None:
    winreg = _winreg_module()
    if winreg is None:  # pragma: no cover - platform dependent
        return None
    winreg_mod = cast(Any, winreg)
    return _winreg_value(
        winreg_mod.HKEY_LOCAL_MACHINE,
        r"SOFTWARE\Microsoft\Cryptography",
        "MachineGuid",
    )


def _windows_cpu_name() -> str | None:
    winreg = _winreg_module()
    if winreg is None:  # pragma: no cover - platform dependent
        return None
    winreg_mod = cast(Any, winreg)
    return _winreg_value(
        winreg_mod.HKEY_LOCAL_MACHINE,
        r"HARDWARE\DESCRIPTION\System\CentralProcessor\0",
        "ProcessorNameString",
    )


def _windows_host() -> str | None:
    return os.getenv("COMPUTERNAME") or platform.node()


def _linux_identifier() -> str:
    return platform.node()


def compute_fingerprint() -> str:
    if sys.platform == "darwin":
        parts = [
            _mac_uuid() or "",
            _mac_cpu_brand() or "",
            _mac_computer_name() or "",
        ]
    elif os.name == "nt":
        parts = [
            _windows_machine_guid() or "",
            _windows_cpu_name() or "",
            _windows_host() or "",
        ]
    else:
        parts = [_linux_identifier(), platform.platform(), platform.processor()]
    combined = "|".join(parts)
    digest = hashlib_sha256(combined.encode("utf-8"))
    return digest


def hashlib_sha256(data: bytes) -> str:
    import hashlib

    return hashlib.sha256(data).hexdigest()


def canonical_payload(payload: dict[str, Any]) -> bytes:
    filtered = {k: v for k, v in payload.items() if k != "signature"}
    return json.dumps(filtered, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _determine_key_version(data: dict[str, Any]) -> int:
    version = data.get("pubkey_version")
    if isinstance(version, int) and version > 0:
        return version
    version = data.get("key_version")
    if isinstance(version, int) and version > 0:
        return version
    return 1


def verify_signature(payload: dict[str, Any]) -> None:
    signature_hex = payload.get("signature")
    if not isinstance(signature_hex, str) or not signature_hex:
        raise LicenseValidationError("missing_signature", "License signature missing.")
    key_version = _determine_key_version(payload)
    key_bytes = PUBLIC_KEYS.get(key_version)
    if not key_bytes:
        raise LicenseValidationError(
            "unknown_key",
            f"No public key configured for version {key_version}.",
        )
    try:
        VerifyKey(key_bytes).verify(canonical_payload(payload), bytes.fromhex(signature_hex))
    except BadSignatureError:
        raise LicenseValidationError("invalid_signature", "License signature is invalid.") from None
    except ValueError as exc:
        raise LicenseValidationError(
            "invalid_signature",
            "License signature is malformed.",
        ) from exc


def _license_dir() -> Path:
    override = os.getenv("LONGQ_LICENSE_DIR")
    if override:
        path = Path(override).expanduser()
    elif sys.platform == "darwin":
        path = Path.home() / "Library" / "Application Support" / APP_NAME
    elif os.name == "nt":
        base = os.getenv("APPDATA")
        if base:
            path = Path(base) / APP_VENDOR / APP_NAME
        else:
            path = Path.home() / "AppData" / "Roaming" / APP_VENDOR / APP_NAME
    else:
        path = Path.home() / f".{APP_NAME.lower()}"
    path.mkdir(parents=True, exist_ok=True)
    if os.name != "nt":
        try:
            path.chmod(0o700)
        except OSError:
            pass
    return path


def license_file_path() -> Path:
    return _license_dir() / "client.lic"


@dataclass(slots=True)
class LicenseSummary:
    license_id: str | None = None
    product: str | None = None
    issued_at: str | None = None
    not_before: str | None = None
    never_expires: bool | None = None
    features: list[str] | None = None
    key_version: int | None = None
    fingerprint_sha256: str | None = None

    def to_dict(self: Self) -> dict[str, Any]:
        return {
            "license_id": self.license_id,
            "product": self.product,
            "issued_at": self.issued_at,
            "not_before": self.not_before,
            "never_expires": self.never_expires,
            "features": self.features,
            "key_version": self.key_version,
            "fingerprint_sha256": self.fingerprint_sha256,
        }


LicenseState = Literal["missing", "invalid", "valid", "activating", "error", "disabled"]


@dataclass(slots=True)
class LicenseStatus:
    state: LicenseState
    message: str | None = None
    error_code: str | None = None
    fingerprint_sha256: str | None = None
    license: LicenseSummary | None = None
    checked_at: float = field(default_factory=_current_ts)

    def to_dict(self: Self) -> dict[str, Any]:
        return {
            "state": self.state,
            "message": self.message,
            "error_code": self.error_code,
            "fingerprint_sha256": self.fingerprint_sha256,
            "license": self.license.to_dict() if self.license else None,
            "checked_at": self.checked_at,
        }


class LicenseValidationError(Exception):
    def __init__(self: Self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class ActivationError(Exception):
    def __init__(
        self: Self,
        code: str,
        message: str,
        status_code: int = 400,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.status_code = status_code


class LicenseManager:
    def __init__(self: Self) -> None:
        self._lock = Lock()
        self._last_check: float = 0.0
        self._status = LicenseStatus(state="missing")
        if LICENSE_DISABLED:
            self._status = LicenseStatus(
                state="disabled",
                message="License checks disabled via LONGQ_LICENSE_DISABLE.",
            )
        else:
            self._status = self._verify_from_disk()

    def _set_status(self: Self, status: LicenseStatus) -> None:
        with self._lock:
            self._status = status
            self._last_check = status.checked_at

    def status(self: Self) -> LicenseStatus:
        with self._lock:
            need_refresh = (
                not LICENSE_DISABLED
                and self._status.state == "valid"
                and (time.time() - self._last_check) > LICENSE_POLL_INTERVAL_SEC
            )
            status = self._status if not need_refresh else None
        if status is not None:
            return status
        refreshed = self._verify_from_disk()
        self._set_status(refreshed)
        return refreshed

    def verify_now(self: Self) -> LicenseStatus:
        status = self._verify_from_disk()
        self._set_status(status)
        return status

    def license_location(self: Self) -> tuple[Path, bool]:
        path = license_file_path()
        return path, path.exists()

    def is_valid(self: Self) -> bool:
        return self.status().state in {"valid", "disabled"}

    def activate(self: Self, email: str) -> LicenseStatus:
        email = (email or "").strip()
        if not email:
            raise ActivationError("email_required", "Email is required.", status_code=400)
        fingerprint = compute_fingerprint()
        logger.info("[license] Activating for fingerprint %s", fingerprint)
        response_bytes = self._issue_request(email=email, fingerprint=fingerprint)
        self._write_license_bytes(response_bytes)
        status = self.verify_now()
        logger.info("[license] Verification result after activate: %s", status.state)
        if status.state != "valid":
            raise ActivationError(
                "verification_failed",
                status.message or "License verification failed.",
                500,
            )
        return status

    def _issue_request(
        self: Self,
        *,
        email: str,
        fingerprint: str,
    ) -> bytes:
        payload = json.dumps(
            {"email": email, "fingerprint_sha256": fingerprint, "product": PRODUCT_CODE},
        ).encode("utf-8")
        url = urllib.parse.urljoin(f"{LICENSE_API_BASE.rstrip('/')}/", ISSUE_PATH.lstrip("/"))
        request = urllib.request.Request(
            url,
            data=payload,
            headers={"content-type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=15) as resp:
                body_bytes = cast(bytes, resp.read())
                logger.info(
                    "[license] License API response status=%s bytes=%s",
                    resp.status,
                    len(body_bytes),
                )
                if resp.status not in {200, 201}:
                    raise ActivationError(
                        "server_error",
                        f"Unexpected status {resp.status} from license API.",
                        resp.status,
                    )
                return body_bytes
        except urllib.error.HTTPError as exc:
            body = exc.read() if hasattr(exc, "read") else b""
            try:
                data = json.loads(body.decode("utf-8"))
            except Exception:
                data = None
            code = "server_error"
            message = "License activation failed."
            detail = data.get("error") if isinstance(data, dict) else None
            if exc.code == 403:
                if detail == "seat_limit_reached":
                    code = detail
                    message = "Seat limit reached for this email."
                elif detail == "email_not_allowed":
                    code = detail
                    message = "There are currently no seats associated with this email."
                else:
                    code = "email_forbidden"
                    message = "The use of this email is forbidden."
            elif exc.code == 400:
                code = detail or "invalid_request"
                message = "Validation error. Check the email and try again."
            elif exc.code == 409:
                code = detail or "conflict"
                message = "This device already has an assigned license."
            elif exc.code >= 500:
                code = detail or "server_error"
                message = "License server unavailable. Try again shortly."
            if (
                detail
                and detail != code
                and detail not in {"seat_limit_reached", "email_not_allowed"}
            ):
                message = f"{message} ({detail})"
            raise ActivationError(code, message, status_code=exc.code or 400) from None
        except urllib.error.URLError as exc:  # pragma: no cover - network specific
            raise ActivationError(
                "network_error",
                f"Unable to reach license server: {exc.reason}",
            ) from None

    def _write_license_bytes(self: Self, data: bytes) -> None:
        path = license_file_path()
        tmp_path = path.with_suffix(".tmp")
        try:
            tmp_path.write_bytes(data)
            if os.name != "nt":
                try:
                    tmp_path.chmod(0o600)
                except OSError:
                    pass
            tmp_path.replace(path)
            logger.info("[license] Saved license JSON to %s", path)
        except OSError as exc:
            logger.error("[license] Failed to write license file %s: %s", path, exc)
            raise ActivationError(
                "write_failed",
                f"Failed to write license file: {exc}",
                500,
            ) from exc

    def _verify_from_disk(self: Self) -> LicenseStatus:
        if LICENSE_DISABLED:
            status = LicenseStatus(state="disabled", message="License checks disabled.")
            logger.info("[license] Verification result: %s", status.state)
            return status
        path = license_file_path()
        if not path.exists():
            logger.info("[license] License file not found at %s", path)
            return LicenseStatus(state="missing", message="License file not found.")
        try:
            raw = path.read_text(encoding="utf-8").strip()
        except OSError as exc:
            logger.error("[license] Unable to read license file %s: %s", path, exc)
            return LicenseStatus(
                state="error",
                message=f"Unable to read license file: {exc}",
                error_code="read_error",
            )
        if not raw:
            logger.warning("[license] License file %s is empty", path)
            return LicenseStatus(state="invalid", message="License file empty.", error_code="empty")
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            logger.warning("[license] License file %s contains invalid JSON", path)
            return LicenseStatus(
                state="invalid",
                message="License file corrupted.",
                error_code="invalid_json",
            )
        if not isinstance(data, dict):
            logger.warning("[license] License file %s has invalid structure", path)
            return LicenseStatus(
                state="invalid",
                message="License structure invalid.",
                error_code="invalid_format",
            )
        try:
            verify_signature(data)
        except LicenseValidationError as exc:
            logger.warning("[license] Signature verification failed: %s", exc)
            return LicenseStatus(
                state="invalid",
                message=str(exc),
                error_code=exc.code,
                license=_summarize(data),
                fingerprint_sha256=data.get("fingerprint_sha256"),
            )
        fingerprint = compute_fingerprint()
        recorded = data.get("fingerprint_sha256")
        if recorded != fingerprint:
            logger.warning(
                "[license] Fingerprint mismatch. recorded=%s current=%s",
                recorded,
                fingerprint,
            )
            return LicenseStatus(
                state="invalid",
                message="License fingerprint does not match this device.",
                error_code="fingerprint_mismatch",
                license=_summarize(data),
                fingerprint_sha256=fingerprint,
            )
        product = data.get("product")
        if product != PRODUCT_CODE:
            logger.warning("[license] Product mismatch: %s != %s", product, PRODUCT_CODE)
            return LicenseStatus(
                state="invalid",
                message="License product mismatch.",
                error_code="product_mismatch",
                license=_summarize(data),
                fingerprint_sha256=fingerprint,
            )
        status = LicenseStatus(
            state="valid",
            message=None,
            error_code=None,
            fingerprint_sha256=fingerprint,
            license=_summarize(data),
        )
        logger.info(
            "[license] License verified successfully with ID %s",
            status.license.license_id if status.license else "(unknown)",
        )
        return status


def _summarize(data: dict[str, Any]) -> LicenseSummary:
    features = data.get("features")
    if isinstance(features, list):
        summary_features = [str(item) for item in features]
    else:
        summary_features = None
    return LicenseSummary(
        license_id=str(data.get("license_id") or ""),
        product=str(data.get("product") or ""),
        issued_at=str(data.get("issued_at") or ""),
        not_before=str(data.get("not_before") or ""),
        never_expires=bool(data.get("never_expires")) if "never_expires" in data else None,
        features=summary_features,
        key_version=_determine_key_version(data),
        fingerprint_sha256=str(data.get("fingerprint_sha256") or ""),
    )
