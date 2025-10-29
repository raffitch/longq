import os
from sqlmodel import SQLModel, create_engine, Session
from sqlalchemy.pool import StaticPool

from paths import backend_dir

DB_URL = os.getenv("DB_URL")
if not DB_URL and os.getenv("LONGQ_ROOT"):
    db_path = backend_dir() / "app.db"
    DB_URL = f"sqlite:///{db_path}"

if DB_URL:
    connect_args = {"check_same_thread": False} if DB_URL.startswith("sqlite") else {}
    engine = create_engine(DB_URL, connect_args=connect_args)
else:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )


def init_db():
    if DB_URL:
        SQLModel.metadata.create_all(engine)
    else:
        SQLModel.metadata.drop_all(engine)
        SQLModel.metadata.create_all(engine)


def get_session():
    with Session(engine) as session:
        yield session
