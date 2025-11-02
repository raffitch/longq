from pydantic import BaseModel
from typing import Optional, Literal, Any, Dict

class SessionCreate(BaseModel):
    first_name: str
    last_name: str
    sex: Literal["male", "female"] = "male"

class SessionUpdate(BaseModel):
    client_name: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    sex: Optional[Literal["male", "female"]] = None

class SessionOut(BaseModel):
    id: int
    code: str
    client_name: str
    first_name: Optional[str]
    last_name: Optional[str]
    folder_name: Optional[str]
    state: Literal["CREATED","INGESTING","VALIDATING","PARSING","READY","PUBLISHED","CLOSED"]
    published: bool
    sex: Literal["male", "female"]

class PublishRequest(BaseModel):
    publish: bool = True
    selected_reports: Optional[Dict[str, bool]] = None

class BannerOut(BaseModel):
    message: str

class FileOut(BaseModel):
    id: int
    kind: str
    filename: str
    status: str
    error: Optional[str] = None

class ParsedOut(BaseModel):
    session_id: int
    kind: str
    data: Any

class ParsedBundleOut(BaseModel):
  session_id: int
  reports: dict[str, Any]

# --- Fixed guest-screen binding schemas ---
class DisplayOut(BaseModel):
  session_id: Optional[int] = None
  client_name: Optional[str] = None
  first_name: Optional[str] = None
  last_name: Optional[str] = None
  published: Optional[bool] = None
  staged_session_id: Optional[int] = None
  staged_first_name: Optional[str] = None
  staged_full_name: Optional[str] = None
  sex: Optional[Literal["male", "female"]] = None
  staged_sex: Optional[Literal["male", "female"]] = None

class DisplaySet(BaseModel):
  session_id: Optional[int] = None  # set null to clear screen
  staged_session_id: Optional[int] = None
  staged_first_name: Optional[str] = None
  staged_full_name: Optional[str] = None
  staged_sex: Optional[Literal["male", "female"]] = None
