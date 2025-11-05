# Bundled Python Runtime

This directory should contain the self-contained Python runtime that ships with
the Electron application. Build it per platform using a virtual environment or a
frozen distribution and keep only the files you need at runtime.

Recommended workflow:

1. From `backend/`, create a clean virtual environment dedicated to packaging.
   ```bash
   python -m venv runtime --upgrade-deps
   source runtime/bin/activate  # Windows: runtime\Scripts\activate
   pip install -r requirements.txt
   ```
2. Strip tests/documentation and verify `python -m backend.runner --help`
   works using the runtime.
3. Run the Electron packaging command so `electron-builder` copies this folder
   into `resources/backend-python/`.

By keeping this environment separate from your development `.venv` you ensure
that packaged builds remain deterministic and relocatable.
