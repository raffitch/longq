"""
Maintenance utilities for the LongQ runtime filesystem.

These helpers are designed to keep the per-user storage tree tidy when the
application starts (or crashes) outside Electron.  They can be invoked as a
standalone module:

    python -m backend.maintenance --prune-locks --nuke-tmp
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from paths import ensure_app_dirs, runtime_dir
from session_fs import (
    SESSION_LOCK_NAME,
    default_session_retention_hours,
    iter_session_dirs,
    purge_session_directories,
    remove_session_lock,
    reset_tmp_directory,
)

BACKEND_PID_NAME = "backend.pid"
BACKEND_PORT_NAME = "backend.port"
DEFAULT_LOCK_STALE_SECONDS = 120


@dataclass
class SessionCleanupReport:
    session: str
    lock_removed: bool = False
    tmp_removed: bool = False
    reason: str | None = None
    lock_age_seconds: float | None = None


@dataclass
class RuntimeCleanupReport:
    pid_removed: bool = False
    port_removed: bool = False
    stale_pid: int | None = None
    error: str | None = None


@dataclass
class SessionRetentionReport:
    session: str
    age_hours: float
    removed: bool


def remove_tmp_directory(path: Path, dry_run: bool) -> bool:
    tmp_path = path / "tmp"
    if tmp_path.exists():
        if dry_run:
            return True
        reset_tmp_directory(path.name)
        return True
    return False


def remove_lock_file(path: Path, dry_run: bool) -> bool:
    lock_path = path / SESSION_LOCK_NAME
    if lock_path.exists():
        if dry_run:
            return True
        remove_session_lock(path.name)
        return True
    return False


def _lock_age_seconds(lock_path: Path) -> float | None:
    try:
        stat = lock_path.stat()
    except FileNotFoundError:
        return None
    return max(0.0, time.time() - stat.st_mtime)


def prune_stale_session_locks(
    max_age_seconds: int = DEFAULT_LOCK_STALE_SECONDS, dry_run: bool = False
) -> list[SessionCleanupReport]:
    reports: list[SessionCleanupReport] = []
    for session_dir in iter_session_dirs():
        lock_path = session_dir / SESSION_LOCK_NAME
        if not lock_path.exists():
            continue
        age = _lock_age_seconds(lock_path)
        if age is None or age < max_age_seconds:
            continue
        report = SessionCleanupReport(session=session_dir.name, lock_age_seconds=age)
        report.tmp_removed = remove_tmp_directory(session_dir, dry_run=dry_run)
        report.lock_removed = remove_lock_file(session_dir, dry_run=dry_run)
        report.reason = f"stale lock ({int(age)}s old)"
        reports.append(report)
    return reports


def nuke_all_tmp_dirs(dry_run: bool = False) -> list[SessionCleanupReport]:
    reports: list[SessionCleanupReport] = []
    for session_dir in iter_session_dirs():
        removed = remove_tmp_directory(session_dir, dry_run=dry_run)
        if removed:
            reports.append(
                SessionCleanupReport(
                    session=session_dir.name,
                    tmp_removed=True,
                    reason="nuke tmp",
                )
            )
    return reports


def backend_pid_path() -> Path:
    return runtime_dir() / BACKEND_PID_NAME


def backend_port_path() -> Path:
    return runtime_dir() / BACKEND_PORT_NAME


def read_pid() -> int | None:
    pid_path = backend_pid_path()
    if not pid_path.exists():
        return None
    try:
        return int(pid_path.read_text().strip())
    except Exception:
        return None


def is_process_running(pid: int) -> bool:
    if pid is None or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False
    return True


def remove_runtime_files(dry_run: bool = False) -> RuntimeCleanupReport:
    report = RuntimeCleanupReport()
    pid_path = backend_pid_path()
    port_path = backend_port_path()

    pid = read_pid()
    if pid is not None and not is_process_running(pid):
        report.stale_pid = pid

    if pid_path.exists():
        if dry_run:
            report.pid_removed = True
        else:
            try:
                pid_path.unlink()
                report.pid_removed = True
            except Exception as exc:
                report.error = f"failed to remove pid file: {exc}"

    if port_path.exists():
        if dry_run:
            report.port_removed = True
        else:
            try:
                port_path.unlink()
                report.port_removed = True
            except Exception as exc:
                report.error = f"failed to remove port file: {exc}"
    return report


def clean_all(
    max_lock_age: int = DEFAULT_LOCK_STALE_SECONDS,
    nuke_tmp: bool = False,
    purge_sessions: bool = False,
    session_max_age_hours: float = default_session_retention_hours(),
    dry_run: bool = False,
) -> dict[str, Any]:
    ensure_app_dirs()
    summary: dict[str, Any] = {
        "stale_locks": [],
        "tmp_removed": [],
        "runtime": None,
        "session_retention": [],
    }
    summary["stale_locks"] = [
        report.__dict__
        for report in prune_stale_session_locks(
            max_age_seconds=max_lock_age,
            dry_run=dry_run,
        )
    ]
    if nuke_tmp:
        summary["tmp_removed"] = [report.__dict__ for report in nuke_all_tmp_dirs(dry_run=dry_run)]
    summary["runtime"] = remove_runtime_files(dry_run=dry_run).__dict__
    if purge_sessions:
        summary["session_retention"] = [
            SessionRetentionReport(
                session=res.session,
                age_hours=res.age_hours,
                removed=res.removed,
            ).__dict__
            for res in purge_session_directories(session_max_age_hours, dry_run=dry_run)
        ]
    return summary


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="LongQ maintenance helper.")
    parser.add_argument(
        "--max-lock-age",
        type=int,
        default=DEFAULT_LOCK_STALE_SECONDS,
        help="Age threshold (seconds) for session.lock pruning.",
    )
    parser.add_argument(
        "--prune-locks",
        action="store_true",
        help="Remove stale session.lock files past the threshold.",
    )
    parser.add_argument(
        "--nuke-tmp",
        action="store_true",
        help="Delete every sessions/<id>/tmp directory.",
    )
    parser.add_argument(
        "--clean-runtime",
        action="store_true",
        help="Remove lingering backend runtime metadata (pid/port files).",
    )
    parser.add_argument(
        "--purge-sessions",
        action="store_true",
        help="Remove entire session directories that exceed the retention window.",
    )
    parser.add_argument(
        "--session-max-age-hours",
        type=float,
        default=default_session_retention_hours(),
        help="Retention window (in hours) before a session directory is purged.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Log intended actions without deleting anything.",
    )
    args = parser.parse_args(list(argv) if argv is not None else None)

    ensure_app_dirs()

    results: dict[str, Any] = {}
    if args.prune_locks:
        results["stale_locks"] = [
            r.__dict__
            for r in prune_stale_session_locks(
                max_age_seconds=args.max_lock_age,
                dry_run=args.dry_run,
            )
        ]
    if args.nuke_tmp:
        results["tmp_removed"] = [r.__dict__ for r in nuke_all_tmp_dirs(dry_run=args.dry_run)]
    if args.clean_runtime:
        results["runtime"] = remove_runtime_files(dry_run=args.dry_run).__dict__
    if args.purge_sessions:
        results["session_retention"] = [
            SessionRetentionReport(
                session=res.session,
                age_hours=res.age_hours,
                removed=res.removed,
            ).__dict__
            for res in purge_session_directories(args.session_max_age_hours, dry_run=args.dry_run)
        ]

    if not results:
        results = clean_all(
            max_lock_age=args.max_lock_age,
            nuke_tmp=args.nuke_tmp,
            purge_sessions=args.purge_sessions,
            session_max_age_hours=args.session_max_age_hours,
            dry_run=args.dry_run,
        )

    print(json.dumps(results, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
