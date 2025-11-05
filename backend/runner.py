import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
REPO_DIR = BACKEND_DIR.parent

for candidate in [str(BACKEND_DIR), str(REPO_DIR)]:
    if candidate not in sys.path:
        sys.path.insert(0, candidate)

from uvicorn import Config, Server

try:  # prefer local import when executed from backend directory
    from app import app  # type: ignore
except ModuleNotFoundError:
    from backend.app import app  # type: ignore


def main() -> None:
    port = int(os.getenv("BACKEND_PORT", "8000"))
    config = Config(app=app, host="0.0.0.0", port=port, reload=False)
    server = Server(config)
    app.state.uvicorn_server = server
    server.run()


if __name__ == "__main__":
    main()
