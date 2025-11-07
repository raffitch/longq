import os
import sys
from importlib import import_module
from pathlib import Path
from typing import cast

from fastapi import FastAPI
from uvicorn import Config, Server

BACKEND_DIR = Path(__file__).resolve().parent
REPO_DIR = BACKEND_DIR.parent

for candidate in [str(BACKEND_DIR), str(REPO_DIR)]:
    if candidate not in sys.path:
        sys.path.insert(0, candidate)

try:
    app_module = import_module("app")
except ModuleNotFoundError:
    app_module = import_module("backend.app")

app = cast(FastAPI, app_module.app)


def main() -> None:
    port = int(os.getenv("BACKEND_PORT", "8000"))
    config = Config(app=app, host="0.0.0.0", port=port, reload=False)
    server = Server(config)
    app.state.uvicorn_server = server
    server.run()


if __name__ == "__main__":
    main()
