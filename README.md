# Quantum Qi™

Quantum Qi™ is a two-screen experience built for clinic operators and their guests. The operator console handles session creation, multi-report ingestion, parsing, and staged publishing, while the guest screen stays in sync via WebSockets so new data lands instantly when the operator is ready to “Go Live”.

This document walks through the project layout, local setup, and day-to-day workflows so someone new to the codebase can get productive quickly.

---

# Quick start TL;DR

The fastest way to spin up Quantum Qi™ locally:

```bash
./scripts/devlaunch.sh
```

The script checks dependencies, frees the default ports, installs anything that is missing, starts FastAPI + Vite, and opens both the operator (`/operator`) and guest (`/guest`) screens in new browser windows. Tweak ports/hosts by exporting these vars before running:

| Variable | Default | Description |
| --- | --- | --- |
| `FRONTEND_HOST` | `127.0.0.1` | Host passed to `vite dev --host`. |
| `FRONTEND_PORT` | `5173` | Port for the Vite dev server (strict). |
| `BACKEND_PORT` | `8000` | Port for the FastAPI backend. |
| `IDLE_SHUTDOWN_DELAY` | `5` | Backend idle shutdown debounce (seconds). |

> **Heads up:** `devlaunch.sh` bootstraps virtualenvs and `node_modules` automatically if they are absent. The first run after a cleanup will take noticeably longer while dependencies install.

Prereqs: Python 3.11+ and Node.js 18+ in your `PATH`. The script exits with guidance if they are missing.

Need a clean slate? Use:

```bash
./scripts/cleanrepo.sh
```

This removes **all** build artifacts, virtualenvs, `node_modules`, and session data under `data/`. It is destructive—run it only when you intentionally want to reinstall everything.

Prefer a manual setup or want more context? Read on.

---

## Architecture overview

```
┌──────────────┐        REST / WS        ┌──────────────┐
│ Operator UI  │ ─────────────────────►  │  FastAPI     │
│ (React)      │ ◄─────────────────────  │  backend     │
└──────────────┘        WebSockets       └──────────────┘
        │                                       │
        │                               SQLite + file store
        │
        ▼
┌──────────────┐
│ Guest UI     │  (always listening for WebSocket pushes)
└──────────────┘
```

- **Backend** (`backend/`): FastAPI + SQLModel, handles session lifecycle, PDF storage, parsing (via adapters), and WebSocket fan-out to guests.
- **Frontend** (`frontend/`): Vite-powered React SPA with two routes:
  - `/operator` for staff workflows.
  - `/guest` for the display screen.
- **Electron** (`electron/`): Desktop shell (developer preview) that launches the backend, runs maintenance, and opens the operator UI.

---

## Local setup (manual)

If you prefer to manage each service yourself instead of `scripts/devlaunch.sh`, follow the steps below.

### Prerequisites

- Python 3.12 (recommended)
- Node.js 18+ and npm

> `scripts/devlaunch.sh` automatically prefers `python3.12`. On macOS it will attempt to install `python@3.12` via Homebrew if it is missing. To override the interpreter, export `LONGQ_PYTHON=/path/to/python` before running the script.

### Backend (FastAPI)

```bash
cd backend
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install --require-hashes -r requirements.txt
# Generate a bearer token the frontend/electron clients will use
export LONGQ_API_TOKEN=$(python -c 'import secrets; print(secrets.token_hex(24))')

# Optional: set .env values (see below)
uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

Dependencies are pinned in `requirements.txt`. When you need to upgrade:

```bash
pip install pip-tools
pip-compile --generate-hashes requirements.in --output-file requirements.txt
pip install --require-hashes -r requirements.txt
```

Backend quality gates can be exercised locally with [tox](https://tox.wiki/):

```bash
tox -e lint     # Ruff
tox -e format   # Black
tox -e type     # mypy
```

> PyMuPDF currently publishes wheels for Python ≤ 3.12. Using 3.13 or newer will force a source build that requires manual TLS configuration. Stick to Python 3.12 unless you are prepared to compile MuPDF yourself.

Key paths:
- SQLite database lives under `data/` (`sqlite:///./data/app.db` by default).
- Uploaded PDFs are stored in `data/sessions/<session_id>/<report_kind>.pdf`.

Useful environment overrides (place in `backend/.env` or export before running):

| Variable | Default | Description |
| --- | --- | --- |
| `DB_URL` | `sqlite:///./data/app.db` | Change persistence location (Postgres/SQLite/etc.). |
| `EXIT_WHEN_IDLE` | unset | If `"true"`, server shuts down when no sockets/jobs are active. |
| `EXIT_IDLE_DEBOUNCE_SEC` | `20` | Seconds to wait before idle shutdown fires. |
| `ALLOWED_ORIGINS` | `http://127.0.0.1:5173,http://localhost:5173` | Comma-separated CORS whitelist. Wildcards are rejected to keep the API locked down. |
| `CORS_ALLOW_CREDENTIALS` | `false` | Enable only if you intentionally rely on browser cookies/credentials. |
| `BACKEND_LOG_FILE` | `backend.jsonl` | File name for rotating JSON logs (written under `data/logs/`). |
| `BACKEND_LOG_MAX_BYTES` | `5242880` | Rotate the log once it exceeds this many bytes. |
| `BACKEND_LOG_BACKUP_COUNT` | `5` | Number of rotated log files to retain. |
| `BACKEND_LOG_LEVEL` | `INFO` | Root logging level for the backend (`DEBUG`, `INFO`, etc.). |
| `BACKEND_LOG_TO_STDOUT` | `1` | Set to `0` to suppress JSON logs on stdout/stderr. |
| `DIAGNOSTICS_MAX_ENTRIES` | `100` | Maximum number of backend error entries kept for the diagnostics panel. |
| `LONGQ_API_TOKEN` | _(required)_ | Bearer token clients must send with API/WebSocket requests (`Authorization: Bearer …`). Generate a strong random value for production. |
| `LONGQ_ALLOW_INSECURE` | unset | Set to `1` only for local experiments to bypass auth (not recommended). |
| `SESSION_FILE_RETENTION_HOURS` | `168` | Hours to retain per-session upload directories before maintenance purges them. |

- Observability endpoints: `GET /metrics` exposes Prometheus counters/gauges/histograms for uploads and parse activity, while `GET /diagnostics` returns the most recent backend error entries surfaced inside the Operator Console diagnostics pane.

### License tracking

Commercial builds ship with a complete list of third-party acknowledgements. Run
the helper scripts whenever dependency lockfiles change to keep the inventory in
`licenses/` up to date:

```bash
# Backend (Python)
python scripts/generate_backend_licenses.py --output licenses/backend_licenses.json

# Frontend React app
node scripts/generate_js_licenses.mjs --project frontend --output licenses/frontend_licenses.json

# Electron shell
node scripts/generate_js_licenses.mjs --project electron --output licenses/electron_licenses.json
```

Each JSON document is structured for easy rendering inside the Electron About
dialog. See `licenses/README.md` for details.

### Frontend (React + Vite)

```bash
cd frontend
npm install
VITE_API_BASE=http://localhost:8000 VITE_LONGQ_API_TOKEN=$LONGQ_API_TOKEN npm run dev
```

- Vite serves the app at `http://localhost:5173` by default.
- Point the frontend at the backend by setting `VITE_API_BASE`:

  ```bash
  VITE_API_BASE=http://localhost:8000 npm run dev
  ```

- Production build: `npm run build` (outputs to `frontend/dist/`).
- Lint: `npm run lint`
- Format: `npm run format`
- Preview prod build locally: `npm run preview`.

> **Auth token:** The backend rejects unauthenticated requests. `scripts/devlaunch.sh` and the Electron shell inject a token automatically; when running manually, set both `LONGQ_API_TOKEN` (backend) and `VITE_LONGQ_API_TOKEN` (frontend) to the same value.
> Always deploy behind HTTPS (e.g., with Nginx/Traefik terminating TLS) so bearer tokens are never sent in clear text.

### Electron (developer preview)

The `electron/` folder contains a minimal Electron main process that starts the FastAPI backend and opens the operator UI. During development it expects the Vite dev server on port `5173`.

```bash
# terminal 1: run the Vite dev server
cd frontend
npm run dev

# terminal 2: run the Electron shell (requires network access the first time to fetch dependencies)
cd electron
npm install
npm start
```

What the launcher does:

1. Computes `app.getPath("userData")/LongQ` and sets `LONGQ_ROOT` so SQLite/uploads live in a per-user sandbox.
2. Calls `python -m backend.maintenance --prune-locks --clean-runtime --nuke-tmp` before every run.
3. Resets the session database by default (set `LONGQ_RESET_DB=0` to keep data between launches).
4. Spawns the backend via `python -m backend.runner`, waits on `/healthz`, and records the pid/port in `runtime/`.
5. Serves the production UI from `frontend/dist` via an internal static server whenever the Vite dev server is absent.
6. Loads the operator and guest routes in separate `BrowserWindow` instances and shows an **About** and **Quit/Exit** menu.
7. On quit it sends `SIGTERM` (or uses `tree-kill` if available) to stop the backend and shuts down the static server.

> **Note:** The repo does not ship pre-installed Electron binaries. Run `npm install` inside `electron/` when you have network access.

### Dependency hygiene helper

Run `./scripts/check-deps.sh` to see which Python or Node packages are outdated across the backend, frontend, and Electron projects.

#### Packaging

Packaging relies on [electron-builder](https://www.electron.build/). Ensure the production frontend build exists before invoking the packaging scripts.

### Automated path

```bash
# macOS or Windows (PowerShell/CMD):
node scripts/electron-package.mjs package
```

This command:

1. Builds a clean `backend/runtime` virtualenv (unless you pass `--skip-runtime`).
2. Builds the production frontend (`frontend/dist`).
3. Runs the appropriate Electron packaging script for the host OS.
4. Optionally deletes `backend/runtime` and `electron/dist` when invoked with `--clean`.

Need to tidy up generated artifacts later? Run:

```bash
node scripts/electron-package.mjs clean
```

### Manual path (advanced)

1. **Build the backend runtime (per platform)**
   ```bash
   cd backend
   rm -rf runtime
   python3 -m venv runtime --upgrade-deps      # Windows: py -3 -m venv runtime --upgrade-deps
   source runtime/bin/activate                 # Windows: runtime\Scripts\activate
   pip install --upgrade pip
   pip install --require-hashes -r requirements.txt
   python -m backend.maintenance --help        # smoke test
   deactivate
   cd ..
   ```
   `electron-builder` copies `backend/runtime` into the packaged app at `resources/backend-python/`, so packaging will fail if the directory is missing.

2. **Build the production frontend**
   ```bash
   cd frontend
   npm install          # first run only
   npm run build
   cd ..
   ```

3. **Package Electron**
   ```bash
   cd electron
   npm install          # first run only
   npm run dist:mac     # on macOS
   npm run dist:win     # on Windows
   ```

Both targets bundle the backend sources, the production frontend, and the dedicated runtime. The generated installers run the same maintenance routines described above. On Windows you may need the Visual C++ redistributable installed before launching the packaged app.

### Environment variables

Define in `frontend/.env` (or `.env.local`) as needed:

| Variable | Default | Description |
| --- | --- | --- |
| `VITE_API_BASE` | `http://localhost:8000` | URL of the FastAPI backend. |

---

## Quality gates

Automated checks run through the GitHub Actions workflow in `.github/workflows/ci.yml`. To execute them locally:

- **Frontend** (`frontend/`): `npm run lint`, `npm run format`, `npm run build`.
- **Backend** (repo root): `ruff check backend`, `black --check backend`, `mypy backend`, `pytest`.

CI executes the same commands on every push and pull request.

## Licensing

This project is released under the MIT License (see [`LICENSE`](LICENSE)). Third-party dependencies are listed in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

To regenerate the notices before a release:

```bash
# JavaScript / TypeScript packages
cd frontend
npx license-checker --production --json > ../THIRD_PARTY_FRONTEND.json

# Python packages
python3 -m pip install pip-licenses
python3 -m piplicenses --format=json --output-file THIRD_PARTY_BACKEND.json \
  --packages $(python3 scripts/list_backend_packages.py)

# Combine JSON into Markdown
python3 scripts/build_third_party_notice.py
```

The helper scripts referenced above live in `scripts/`.

---

## Operator workflow

1. **Create a session**
   - Visit `http://localhost:5173/operator`.
   - Enter guest first and last name. This fills the staged preview and guest greeting.

2. **Ingest reports**
   - Drag & drop the guest folder or use the “Upload” button.
   - The console supports five report types out of the box:
     - `Food`, `Heavy Metals`, `Hormones`, `Nutrition`, `Toxins`.
   - Each upload:
     - Stores the PDF.
     - Auto-selects the report tile.
     - Clears prior parsing state so you can re-run ingest on replacements.

3. **Parse**
   - Parsing is automatically triggered before publishing, but you can manually parse any report from its tile.
   - Status banners keep track of which tiles have succeeded/failed (with per-report error messaging).

4. **Stage & publish**
   - The “Publish Session” card shows when you’re ready to push staged data.
   - Publishing:
     - Parses any outstanding selected reports.
     - Saves the publish state.
     - Refreshes the staged preview iframe in the sidebar.
     - Adds a brief glow to the staged preview card so the operator knows it’s ready to “Go Live”.

5. **Go live / hide**
   - The sidebar offers live monitor controls:
   - `Open Guest Window` / `Go Live` / `Hide`.
     - When staged data is published but not live, the staged card animates forward to encourage promotion.
     - Clicking `Go Live` binds the session and the live monitor message switches to “Live Reports.”
     - `Hide` rolls the staged preview forward again without losing publish history.

6. **Reset**
   - `Start Over` wipes the current session (uploads, selections, status) so you can onboard a new guest quickly.

---

## Codebase tour

### Backend highlights

| File | Purpose |
| --- | --- |
| [`backend/app.py`](backend/app.py) | FastAPI entry point, routes, WebSocket handling, idle shutdown support. |
| [`backend/models.py`](backend/models.py) | SQLModel-backed tables: `SessionRow`, `FileRow`, `ParsedRow`, `DisplayRow`. |
| [`backend/schemas.py`](backend/schemas.py) | Pydantic request/response schemas shared with the frontend. |
| [`backend/parser_adapter.py`](backend/parser_adapter.py) | Dynamically loads report parsers (e.g. food, hormones). |
| [`backend/storage.py`](backend/storage.py) | File-system persistence helpers for uploads and temp artifacts. |
| [`backend/runner.py`](backend/runner.py) | Programmatic uvicorn bootstrap (used by scripts/tests). |

### Frontend highlights

| File | Purpose |
| --- | --- |
| [`frontend/src/Operator.tsx`](frontend/src/Operator.tsx) | Main operator workflow with staged preview + live monitor. |
| [`frontend/src/Guest.tsx`](frontend/src/Guest.tsx) | Guest-facing screen, listens to WebSocket + REST. |
| [`frontend/src/api.ts`](frontend/src/api.ts) | Typed API client; sets `VITE_API_BASE`. |
| [`frontend/src/ui/Button.tsx`](frontend/src/ui/Button.tsx) | Shared button component with variant system. |
| [`frontend/src/ui/Chip.tsx`](frontend/src/ui/Chip.tsx) | Status pill component used across tiles. |

---

## Development tips

- **Dummy parsers**: If a specific parser module (e.g., `parse_food_pdf`) isn’t available, the adapter returns a stub payload so you can develop the UI without installing parsing dependencies.
- **WebSocket fallbacks**: Guest screens refresh over `/ws/guest` and also poll every 30 seconds, so they recover even if the socket briefly disconnects.
- **Staged preview testing**: The operator sidebar is designed for ultra-wide (Samsung G9) dashboards. The iframe containers auto-scale while keeping scroll positions centered so you can validate layout regardless of local monitor size.
- **Resetting state**: Removing `data/` clears the SQLite DB and uploaded artifacts; useful when you need a clean slate.
- **Hot reloading**:
  - FastAPI uses `--reload`, so restarting isn’t necessary on code changes.
  - Vite auto-refreshes changes in `/frontend`.

---

Happy building! If you add new report types, parsers, or UI flows, update this README so future contributors can hit the ground running. PRs that change entry points or required environment config should always refresh the relevant sections above.*** End Patch
# Windows (.exe written to electron/dist/)
# Run these commands from PowerShell or Git Bash on a Windows machine
