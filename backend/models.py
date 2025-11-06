# models.py
from __future__ import annotations

from typing import Any, Dict
from datetime import datetime
from enum import Enum
from sqlmodel import SQLModel, Field
from sqlalchemy import Column, JSON, String  # <-- use Column + JSON


class SessionState(str, Enum):
    CREATED = "CREATED"
    INGESTING = "INGESTING"
    VALIDATING = "VALIDATING"
    PARSING = "PARSING"
    READY = "READY"
    PUBLISHED = "PUBLISHED"
    CLOSED = "CLOSED"


class SessionRow(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    code: str = Field(index=True)
    client_name: str = Field(index=True)
    first_name: str | None = Field(default=None, index=True)
    last_name: str | None = Field(default=None, index=True)
    folder_name: str | None = Field(default=None, index=True)
    state: SessionState = Field(default=SessionState.CREATED)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    published: bool = Field(default=False)
    sex: str = Field(
        default="male",
        sa_column=Column(String(16), nullable=False, server_default="male"),
    )
    visible_reports: Dict[str, bool] | None = Field(
        default=None, sa_column=Column(JSON, nullable=True)
    )


class FileRow(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    session_id: int = Field(index=True, foreign_key="sessionrow.id")
    kind: str = Field(index=True)  # e.g., "food"
    filename: str
    filehash: str | None = None
    size: int
    uploaded_at: datetime = Field(default_factory=datetime.utcnow)
    status: str = Field(default="uploaded")  # uploaded|validating|parsed|error
    error: str | None = None
    parser_version: str | None = None


class ParsedRow(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    session_id: int = Field(index=True, foreign_key="sessionrow.id")
    kind: str = Field(index=True)  # "food"
    # IMPORTANT: type is dict for Pydantic; SQL side uses JSON column:
    data: Dict[str, Any] = Field(sa_column=Column(JSON))
    parsed_at: datetime = Field(default_factory=datetime.utcnow)


# --- Fixed guest-screen binding model ---
from sqlmodel import Field as _Field


class DisplayRow(SQLModel, table=True):
    id: int | None = _Field(default=None, primary_key=True)
    code: str = _Field(default="main", index=True, unique=True)  # single guest display
    current_session_id: int | None = _Field(default=None, foreign_key="sessionrow.id")
    staged_session_id: int | None = _Field(default=None, foreign_key="sessionrow.id")
    staged_first_name: str | None = _Field(default=None)
    staged_full_name: str | None = _Field(default=None)
    staged_sex: str | None = _Field(default=None)
