# Quantum Qi™

Quantum Qi™ is a two-screen experience built for clinic operators and their guests. The operator console handles session creation, multi-report ingestion, parsing, and staged publishing, while the guest screen stays in sync via WebSockets so new data lands instantly when the operator is ready to “Go Live”.

This document walks through the project layout, local setup, and day-to-day workflows so someone new to the codebase can get productive quickly.

---

# Quick start TL;DR

The fastest way to spin up Quantum Qi™ locally:

```bash
./scripts/dev.sh
```

The script checks dependencies, frees the default ports, starts FastAPI + Vite, and opens both the operator (`/operator`) and guest (`/guest`) screens in new browser windows. Tweak ports/hosts by exporting these vars before running:

| Variable | Default | Description |
| --- | --- | --- |
| `FRONTEND_HOST` | `127.0.0.1` | Host passed to `vite dev --host`. |
| `FRONTEND_PORT` | `5173` | Port for the Vite dev server (strict). |
| `BACKEND_PORT` | `8000` | Port for the FastAPI backend. |
| `IDLE_SHUTDOWN_DELAY` | `5` | Backend idle shutdown debounce (seconds). |

Prereqs: `backend/.venv` with dependencies installed and `frontend/node_modules` present. The script exits with guidance if those are missing.

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

### Prerequisites

- Python 3.11+
- Node.js 18+ and npm

### Backend (FastAPI)

```bash
cd backend
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Optional: set .env values (see below)
uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

Key paths:
- SQLite database lives under `data/` (`sqlite:///./data/app.db` by default).
- Uploaded PDFs are stored in `data/sessions/<session_id>/<report_kind>.pdf`.

Useful environment overrides (place in `backend/.env` or export before running):

| Variable | Default | Description |
| --- | --- | --- |
| `DB_URL` | `sqlite:///./data/app.db` | Change persistence location (Postgres/SQLite/etc.). |
| `EXIT_WHEN_IDLE` | unset | If `"true"`, server shuts down when no sockets/jobs are active. |
| `EXIT_IDLE_DEBOUNCE_SEC` | `20` | Seconds to wait before idle shutdown fires. |

### Frontend (React + Vite)

```bash
cd frontend
npm install
npm run dev
```

- Vite serves the app at `http://localhost:5173` by default.
- Point the frontend at the backend by setting `VITE_API_BASE`:

  ```bash
  VITE_API_BASE=http://localhost:8000 npm run dev
  ```

- Production build: `npm run build` (outputs to `frontend/dist/`).
- Preview prod build locally: `npm run preview`.

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

#### Packaging

Packaging relies on [electron-builder](https://www.electron.build/). Ensure the production frontend build exists before invoking the packaging scripts.

```bash
# Prepare backend virtualenv (only needed once per machine)
cd backend
python3 -m venv .venv
source .venv/bin/activate            # or .venv\\Scripts\\activate on Windows
pip install -r requirements.txt

cd ..

# Build the React app (only once per revision)
cd frontend
npm install          # first run only
npm run build

# macOS (.dmg written to electron/dist/)
cd ../electron
npm install          # first run only
npm run dist:mac

# Windows (.exe written to electron/dist/)
# Run these commands from PowerShell or Git Bash on a Windows machine
cd electron
npm install          # first run only
npm run dist:win
```

Both targets bundle the backend virtualenv, sources, and the pre-built frontend under the Electron app’s resources directory. The generated installers run the same maintenance and reset routines described above. On Windows you may need the Visual C++ redistributable installed before launching the packaged app.

### Environment variables

Define in `frontend/.env` (or `.env.local`) as needed:

| Variable | Default | Description |
| --- | --- | --- |
| `VITE_API_BASE` | `http://localhost:8000` | URL of the FastAPI backend. |

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
