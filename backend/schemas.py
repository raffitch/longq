from pydantic import BaseModel
from typing import Literal, Any, Dict


class SessionCreate(BaseModel):
    first_name: str
    last_name: str
    sex: Literal["male", "female"] = "male"


class SessionUpdate(BaseModel):
    client_name: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    sex: Literal["male", "female"] | None = None


class SessionOut(BaseModel):
    id: int
    code: str
    client_name: str
    first_name: str | None
    last_name: str | None
    folder_name: str | None
    state: Literal["CREATED", "INGESTING", "VALIDATING", "PARSING", "READY", "PUBLISHED", "CLOSED"]
    published: bool
    sex: Literal["male", "female"]


class PublishRequest(BaseModel):
    publish: bool = True
    selected_reports: Dict[str, bool] | None = None


class BannerOut(BaseModel):
    message: str


class FileOut(BaseModel):
    id: int
    kind: str
    filename: str
    status: str
    error: str | None = None


class ParsedOut(BaseModel):
    session_id: int
    kind: str
    data: Any


class ParsedBundleOut(BaseModel):
    session_id: int
    reports: dict[str, Any]


# --- Fixed guest-screen binding schemas ---
class DisplayOut(BaseModel):
    session_id: int | None = None
    client_name: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    published: bool | None = None
    staged_session_id: int | None = None
    staged_first_name: str | None = None
    staged_full_name: str | None = None
    sex: Literal["male", "female"] | None = None
    staged_sex: Literal["male", "female"] | None = None


class DisplaySet(BaseModel):
    session_id: int | None = None  # set null to clear screen
    staged_session_id: int | None = None
    staged_first_name: str | None = None
    staged_full_name: str | None = None
    staged_sex: Literal["male", "female"] | None = None
