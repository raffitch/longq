# License API (Cloudflare Workers)

This directory contains everything needed to stand up a free Cloudflare Worker that issues signed, machine-bound license files. The app will call this API later; for now we focus on the service and manual testing workflow.

---

## What the Worker Does

1. Accepts `POST /issue` with JSON `{ email, fingerprint_sha256, product }`.
2. Looks up the lowercase email hash in a KV allowlist to confirm the user and seat limit.
3. Reuses an existing license if the same email + fingerprint was already issued.
4. Enforces the seat cap (number of unique fingerprints per email).
5. Returns a signed license JSON (Ed25519) or an error message.

This keeps all secrets on Cloudflare. The desktop app will verify signatures offline using the public key.

---

## Human-Friendly Overview

### Cloudflare setup
- Run `node scripts/keygen.js` once to mint a private/public Ed25519 pair. The private seed lives only as a Wrangler secret; the public key will ship with the desktop app so it can verify licenses.
- Create three Cloudflare KV namespaces (ALLOW, INDEX, LICENSES). Wrangler prints a unique namespace ID for each; those IDs land in `wrangler.toml` so deploys know exactly which remote store to talk to.
- Deploy with `wrangler deploy`. Wrangler bundles `src/index.js`, uploads it, and binds the namespaces and private seed so the Worker can both store data and sign payloads.

### Managing access
- You manually maintain the allowlist by inserting hashed emails into the ALLOW namespace together with the max seat count for that customer. Nothing happens automatically here—if the email hash is absent, the Worker denies the request.

### Issuing a license
- The client sends the raw email plus a SHA-256 fingerprint. The Worker lowercases and hashes the email, looks it up in ALLOW, and counts how many unique fingerprints already exist in INDEX.
- If the email exists and seats remain, the Worker signs a license JSON with the private seed, stores it in LICENSES, records the fingerprint→license mapping in INDEX, and returns the signed JSON to the caller.
- The response is what the desktop app will save as `client.lic` (or similar) on disk.

### Using the license on the client
- On startup the app loads the saved license file, verifies the Ed25519 signature with the embedded public key, and refuses to run if verification fails or the payload is tampered with.
- Because both the email and fingerprint are hashed before storage, the KV namespaces never hold plaintext personal data, yet the Worker still has stable identifiers for seat tracking.

---

## Quick Start Checklist

1. Install tooling.
2. Initialize npm project.
3. Generate Ed25519 keys.
4. Configure `wrangler.toml`.
5. Create Cloudflare KV namespaces.
6. Allowlist the first email (one seat).
7. Deploy the Worker.
8. Call the endpoint manually from macOS.

The sections below detail every step.

---

## 1. Install Tooling (macOS)

```bash
npm install -g wrangler
wrangler --version
wrangler login
```

- `wrangler login` opens a browser window to authorize the CLI with your Cloudflare account. Homebrew no longer ships Wrangler, so the global npm install keeps this document aligned with the current CLI (`wrangler 4.x`).

---

## 2. Initialize the Worker Project

From repo root:

```bash
cd license-api
npm init -y
npm install tweetnacl
```

This creates `package.json` and installs the Ed25519 library required by the Worker.

---

## 3. Generate Ed25519 Keys

Run the helper script:

```bash
node scripts/keygen.js
```

Output:

- `PRIVATE_SEED_HEX` – **keep secret**; paste when prompted by `wrangler secret put`.
- `PUBLIC_KEY_HEX` – embed in the desktop app for signature verification.

Store the private seed using Wrangler so it never appears in git:

```bash
wrangler secret put PRIVATE_SEED_HEX
# paste the value when prompted
```

---

## 4. Configure `wrangler.toml`

`wrangler.toml` binds the Worker entrypoint and three KV namespaces:

- `ALLOW` – email hash → `{ "max_seats": 1 }`
- `LICENSES` – `lic:<license_id>` → license JSON
- `INDEX` – `idx:<email_hash>:<fingerprint_sha256>` → license ID

After running the namespace creation commands you will replace the placeholder IDs in the file.

---

## 5. Create KV Namespaces

```bash
wrangler kv namespace create ALLOW --binding=ALLOW
wrangler kv namespace create LICENSES --binding=LICENSES
wrangler kv namespace create INDEX --binding=INDEX
```

Each command prints an `id`. Update `wrangler.toml` so the `id` for each binding matches the values returned above.

If you plan to deploy to both production and preview environments, repeat with `--preview` variants and record both IDs.

---

## 6. Allowlist `raffi@hotmail.it` (1 Seat)

Compute the SHA256 hash of the lowercase email:

```bash
node -e "const c=require('crypto');const e='raffi@hotmail.it'.toLowerCase();console.log(c.createHash('sha256').update(e).digest('hex'))"
```

Copy the printed hash (call it `EMAIL_HASH`) and store the allowlist entry:

```bash
wrangler kv key put --binding=ALLOW --remote fa8f727264b47a6b4b3a3c47a42bab6f538140aadab68b8b854be5edc75d4cfa '{"max_seats":1}'
```

- Replace the hash with whatever `node -e "..."` prints. Always pass `--remote` so the key lands in the production namespace; omit it only when intentionally targeting the local dev store.

Seat count defaults to 1 if omitted; we set it explicitly for clarity.

---

## 7. Deploy the Worker

```bash
wrangler deploy
```

- The command automatically targets the remote Worker; add `--remote` if Wrangler ever reports `Resource location: local` during deploy.

The CLI outputs a URL similar to `https://license-api.<subdomain>.workers.dev`. The endpoint we will use is `POST https://license-api.hello-326.workers.dev/issue`.

---

## 8. Manual Testing from macOS

### 8.1 Compute the Machine Fingerprint

#### macOS (Terminal / zsh)

```bash
FPRINT=$(ioreg -rd1 -c IOPlatformExpertDevice | awk '/IOPlatformUUID/{print $3}' | tr -d '"')
CPU=$(sysctl -n machdep.cpu.brand_string 2>/dev/null || sysctl -n hw.model 2>/dev/null)
HOST=$(scutil --get ComputerName 2>/dev/null || hostname)
FP_HASH=$(printf "%s|%s|%s" "$FPRINT" "$CPU" "$HOST" | shasum -a 256 | awk '{print $1}')
echo "fingerprint_sha256=$FP_HASH"
```

#### Windows (PowerShell)

```powershell
$machineGuid = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Cryptography').MachineGuid
$cpu = (Get-CimInstance Win32_Processor | Select-Object -First 1 -ExpandProperty Name)
$host = $env:COMPUTERNAME
$fingerprint = "$machineGuid|$cpu|$host"
$fingerprintSha256 = [BitConverter]::ToString((New-Object Security.Cryptography.SHA256Managed).ComputeHash([Text.Encoding]::UTF8.GetBytes($fingerprint))).Replace('-', '').ToLower()
Write-Output "fingerprint_sha256=$fingerprintSha256"
```

Keep the resulting hash (the characters after `fingerprint_sha256=`). The desktop application will follow the same logic: detect the current OS, build the fingerprint string, hash it, and send that value to the Worker.

### 8.2 Issue a License

```bash
curl -X POST https://license-api.<subdomain>.workers.dev/issue \
  -H 'content-type: application/json' \
  -d "{\"email\":\"raffi@hotmail.it\",\"fingerprint_sha256\":\"$FP_HASH\",\"product\":\"quantum_qi_pro\"}" | jq .
```

- Status `201` with JSON body → success. Save the JSON as `client.lic` for later testing.
- Status `403` → email not allowed or seat limit reached.
- Status `400` → malformed request.
- Status `500` → misconfiguration (check secrets or KV bindings).

### 8.3 Save the License Locally

```bash
curl -sS ...same payload... > client.lic
```

We will later have the Electron app read and verify this file before unlocking features.

---

## Files in this Directory

| Path | Purpose |
| --- | --- |
| `README.md` | These instructions. |
| `wrangler.toml` | Worker + KV configuration (update IDs before deploy). |
| `src/index.js` | Cloudflare Worker (issues licenses). |
| `scripts/keygen.js` | Local helper: emits PRIVATE_SEED_HEX & PUBLIC_KEY_HEX. |
| `.gitignore` | Excludes `node_modules`, `.wrangler`, etc. |
| `package.json` / `package-lock.json` | Node project metadata and dependencies. |

---

## Next Steps

1. Confirm the Worker deploys and responds with a license.
2. Add automated tests (optional) hitting the `/issue` endpoint with mock data.
3. Integrate client-side activation flow (Electron + FastAPI) using the documented API contract.
4. Expand allowlist management (scripts or admin UI) if needed.

Keep this README updated as workflow evolves.
