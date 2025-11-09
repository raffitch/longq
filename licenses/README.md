## Third-Party License Inventory

This folder stores machine-readable snapshots of every dependency we ship. The
files are generated automatically so Electron can surface the license text in
its **About → Licenses** dialog and so we have a single source of truth for
compliance reviews.

### Backend (Python)

1. Activate the backend virtualenv (`source backend/.venv/bin/activate`).
2. Install runtime dependencies (if needed): `pip install --require-hashes -r backend/requirements.txt`.
3. From the repo root run:
   ```bash
   python scripts/generate_backend_licenses.py --output licenses/backend_licenses.json
   ```

The script inspects the currently active environment using `importlib.metadata`,
captures the license metadata, and extracts any bundled `LICENSE*` files so we
have the actual text.

### Frontend / Electron (Node.js)

These scripts read `package-lock.json` and the installed `node_modules`
metadata, so run them after installing dependencies.

```bash
# Frontend React app
node scripts/generate_js_licenses.mjs --project frontend --output licenses/frontend_licenses.json

# Electron shell
node scripts/generate_js_licenses.mjs --project electron --output licenses/electron_licenses.json
```

Each JSON entry is shaped like:

```json
{
  "name": "react",
  "version": "18.3.1",
  "license": "MIT",
  "repository": "https://github.com/facebook/react",
  "licenseText": "..."
}
```

### Updating UI / About dialog

Electron can read the JSON files directly (or convert them to Markdown) to
populate an in-app list of open-source acknowledgements. Because the output is
structured, the renderer can group by license or render searchable tables.

### Regenerating

Re-run the scripts whenever dependency lockfiles change:

```
licenses/backend_licenses.json
licenses/frontend_licenses.json
licenses/electron_licenses.json
```

Commit the regenerated files alongside dependency updates so builds and release
artifacts always include the latest license inventory.
