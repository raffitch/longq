# LongevityQ

LongevityQ is a two-screen demo that lets an operator upload a lab report PDF and immediately project the parsed results to a patient-facing display. The backend stores the uploaded file, parses it into structured data, and pushes live updates over WebSockets so that the patient screen updates as soon as the operator publishes the session.

## Repository layout

| Path | Description |
| --- | --- |
| `backend/` | FastAPI service, SQLite persistence, PDF parser integration, and patient WebSocket broadcaster. |
| `frontend/` | React + Vite single-page app containing separate operator and patient views. |
| `data/` | Runtime storage for the SQLite database and uploaded PDF assets (created automatically). |

## Backend

The backend is a FastAPI application configured in [`backend/app.py`](backend/app.py). Core features:

* Session lifecycle: create sessions, upload PDF assets, run parsing, and publish results to patients. [`backend/app.py`](backend/app.py)
* SQLite persistence via SQLModel models defined in [`backend/models.py`](backend/models.py) with simple creation helpers in [`backend/db.py`](backend/db.py).
* File management helpers in [`backend/storage.py`](backend/storage.py) that write uploads into `./data/sessions/<id>/<kind>.pdf`.
* Parser integration through [`backend/parser_adapter.py`](backend/parser_adapter.py), which delegates to [`backend/parse_food_pdf.py`](backend/parse_food_pdf.py) when available and falls back to a stub response otherwise.
* Patient update channel: a `/ws/patient` WebSocket broadcasts `published` and `displaySet` events so patient screens refresh instantly when the operator publishes new data. [`backend/app.py`](backend/app.py)

### API overview

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/sessions` | `POST` | Create a new operator session for a client name; returns the short code and session id. |
| `/sessions` | `GET` | List existing sessions (most recent first). |
| `/sessions/{id}` | `GET` | Fetch current state of a session (created, ingesting, parsing, published, etc.). |
| `/sessions/{id}/banner` | `GET` | Greeting banner text for the patient waiting screen. |
| `/sessions/{id}/upload/{kind}` | `POST` | Upload a PDF for a given session (currently only `kind="food"`). Stores the file and records metadata. |
| `/files/{fileId}/parse` | `POST` | Invoke the configured parser on the previously uploaded PDF. On success, structured data is saved in `ParsedRow`. |
| `/sessions/{id}/publish` | `POST` | Mark the session as published and notify patient clients via WebSocket. |
| `/sessions/{id}/parsed/{kind}` | `GET` | Fetch parsed results (gated so only published sessions can be read). |
| `/display/current` | `GET` | Return which session should appear on patient screens and the associated client name. |
| `/display/current` | `POST` | Bind or clear a session for the patient screen; triggers a WebSocket push so connected browsers reload. |

All JSON schemas are declared in [`backend/schemas.py`](backend/schemas.py).

### Running the backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

By default the service uses `sqlite:///./data/app.db`. Override with `DB_URL` if you want a different database backend. Uploaded PDFs are stored relative to the repository in `data/sessions/`.

## Frontend

The frontend lives under `frontend/` and is bootstrapped with Vite + React. The operator and patient experiences are separate routes defined in [`frontend/src/App.tsx`](frontend/src/App.tsx).

* [`frontend/src/Operator.tsx`](frontend/src/Operator.tsx) lets staff create a session, drag & drop a PDF, trigger parsing, publish the results, and assign the active session to the patient display.
* [`frontend/src/Patient.tsx`](frontend/src/Patient.tsx) polls `/display/current`, listens to `/ws/patient` for instant refresh notifications, and renders the parsed food data as category clusters of circular badges.
* [`frontend/src/api.ts`](frontend/src/api.ts) centralizes REST calls and reads `VITE_API_BASE` to locate the backend (default `http://localhost:8000`).

### Running the frontend

```bash
cd frontend
npm install
npm run dev
```

Point the frontend at the backend by defining `VITE_API_BASE` when you run Vite (e.g., `VITE_API_BASE=http://localhost:8000 npm run dev`). The development server serves the app at `http://localhost:5173` by default.

## Typical operator-to-patient flow

1. The operator visits `/operator`, enters the client’s name, and creates a session. [`frontend/src/Operator.tsx`](frontend/src/Operator.tsx)
2. Drag and drop (or manually choose) the client’s PDF report. The backend stores it, updates the session state, and the operator can request parsing. [`backend/storage.py`](backend/storage.py) [`backend/app.py`](backend/app.py)
3. After parsing succeeds, the operator reviews the “Parsed ✓” status and publishes the session. Publishing both flags the session and pushes a WebSocket notification so patient tabs reload. [`backend/app.py`](backend/app.py)
4. The patient display (served at `/patient`) shows a welcome screen until a session is bound and published, then fetches `/sessions/{id}/parsed/food` and renders the structured results. [`frontend/src/Patient.tsx`](frontend/src/Patient.tsx)
5. At any point, the operator can reassign or clear the patient screen via `/display/current`. [`frontend/src/api.ts`](frontend/src/api.ts)

## Testing and development tips

* The parser adapter automatically falls back to a dummy structure if `parse_food_pdf.parse_pdf` cannot be imported, which is useful for frontend development without PDF parsing dependencies. [`backend/parser_adapter.py`](backend/parser_adapter.py)
* You can open the patient screen in another tab or browser window using the “Open Patient Screen” link on the operator console. [`frontend/src/Operator.tsx`](frontend/src/Operator.tsx)
* WebSocket push is complemented by a 30-second polling interval to keep patient screens fresh even if the socket reconnects. [`frontend/src/Patient.tsx`](frontend/src/Patient.tsx)

## License

This repository does not currently declare a license. Add one before distributing or deploying the project.
