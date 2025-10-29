# Quantum Qi

Quantum Qi is a two-screen experience built for clinic operators and their patients. The operator console handles session creation, multi-report ingestion, parsing, and staged publishing, while the patient screen stays in sync via WebSockets so new data lands instantly when the operator is ready to “Go Live”.

This document walks through the project layout, local setup, and day-to-day workflows so someone new to the codebase can get productive quickly.

---

# Quick start TL;DR

The fastest way to spin up Quantum Qi locally:

```bash
./scripts/dev.sh
```

The script checks dependencies, frees the default ports, starts FastAPI + Vite, and opens both the operator (`/operator`) and patient (`/patient`) screens in new browser windows. Tweak ports/hosts by exporting these vars before running:

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
│ Patient UI   │  (always listening for WebSocket pushes)
└──────────────┘
```

- **Backend** (`backend/`): FastAPI + SQLModel, handles session lifecycle, PDF storage, parsing (via adapters), and WebSocket fan-out to patients.
- **Frontend** (`frontend/`): Vite-powered React SPA with two routes:
  - `/operator` for staff workflows.
  - `/patient` for the display screen.

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

### Environment variables

Define in `frontend/.env` (or `.env.local`) as needed:

| Variable | Default | Description |
| --- | --- | --- |
| `VITE_API_BASE` | `http://localhost:8000` | URL of the FastAPI backend. |

---

## Operator workflow

1. **Create a session**
   - Visit `http://localhost:5173/operator`.
   - Enter patient first and last name. This fills the staged preview and patient greeting.

2. **Ingest reports**
   - Drag & drop the patient folder or use the “Upload” button.
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
     - `Open Patient Window` / `Go Live` / `Hide`.
     - When staged data is published but not live, the staged card animates forward to encourage promotion.
     - Clicking `Go Live` binds the session and the live monitor message switches to “Live Reports.”
     - `Hide` rolls the staged preview forward again without losing publish history.

6. **Reset**
   - `Start Over` wipes the current session (uploads, selections, status) so you can onboard a new patient quickly.

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
| [`frontend/src/Patient.tsx`](frontend/src/Patient.tsx) | Patient-facing screen, listens to WebSocket + REST. |
| [`frontend/src/api.ts`](frontend/src/api.ts) | Typed API client; sets `VITE_API_BASE`. |
| [`frontend/src/ui/Button.tsx`](frontend/src/ui/Button.tsx) | Shared button component with variant system. |
| [`frontend/src/ui/Chip.tsx`](frontend/src/ui/Chip.tsx) | Status pill component used across tiles. |

---

## Development tips

- **Dummy parsers**: If a specific parser module (e.g., `parse_food_pdf`) isn’t available, the adapter returns a stub payload so you can develop the UI without installing parsing dependencies.
- **WebSocket fallbacks**: Patient screens refresh over `/ws/patient` and also poll every 30 seconds, so they recover even if the socket briefly disconnects.
- **Staged preview testing**: The operator sidebar is designed for ultra-wide (Samsung G9) dashboards. The iframe containers auto-scale while keeping scroll positions centered so you can validate layout regardless of local monitor size.
- **Resetting state**: Removing `data/` clears the SQLite DB and uploaded artifacts; useful when you need a clean slate.
- **Hot reloading**:
  - FastAPI uses `--reload`, so restarting isn’t necessary on code changes.
  - Vite auto-refreshes changes in `/frontend`.

---

Happy building! If you add new report types, parsers, or UI flows, update this README so future contributors can hit the ground running. PRs that change entry points or required environment config should always refresh the relevant sections above.*** End Patch
