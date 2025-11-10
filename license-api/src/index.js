import nacl from "tweetnacl";

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const hexToBytes = (hex) =>
  Uint8Array.from((hex.match(/.{2}/g) ?? []).map((pair) => parseInt(pair, 16)));

const bytesToHex = (bytes) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

const sha256Hex = async (text) => {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return bytesToHex(new Uint8Array(digest));
};

const canonicalJson = (payload) => {
  const keys = Object.keys(payload).sort();
  return JSON.stringify(payload, keys);
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/issue") {
      let body;
      try {
        body = await request.json();
      } catch (error) {
        return jsonResponse({ error: "invalid_json" }, 400);
      }

      const { email, fingerprint_sha256: fingerprintHash, product = "app" } = body || {};
      if (!email || !fingerprintHash) {
        return jsonResponse({ error: "invalid_request" }, 400);
      }

      const emailHash = await sha256Hex(email.trim().toLowerCase());
      const allowRaw = await env.ALLOW.get(emailHash);
      if (!allowRaw) {
        return jsonResponse({ error: "email_not_allowed" }, 403);
      }
      const allow = JSON.parse(allowRaw);
      const seatLimit = allow.max_seats ?? 1;

      const indexKey = `idx:${emailHash}:${fingerprintHash}`;
      const existingId = await env.INDEX.get(indexKey);
      if (existingId) {
        const licenseJson = await env.LICENSES.get(`lic:${existingId}`);
        if (licenseJson) {
          return new Response(licenseJson, { headers: { "content-type": "application/json" } });
        }
      }

      let seatCount = 0;
      let cursor;
      do {
        const page = await env.INDEX.list({ prefix: `idx:${emailHash}:`, cursor });
        seatCount += page.keys.length;
        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor);

      if (seatCount >= seatLimit) {
        return jsonResponse({ error: "seat_limit_reached" }, 403);
      }

      const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
      const payload = {
        license_id: `LIC-${crypto.randomUUID().split("-")[0]}`,
        product,
        email_hash: emailHash,
        fingerprint_sha256: fingerprintHash,
        issued_at: now,
        not_before: now,
        never_expires: true,
        features: ["core"],
        key_version: 1,
      };

      const seedHex = env.PRIVATE_SEED_HEX;
      if (!seedHex) {
        return jsonResponse({ error: "server_misconfig" }, 500);
      }
      const keyPair = nacl.sign.keyPair.fromSeed(hexToBytes(seedHex));
      const signature = nacl.sign.detached(
        new TextEncoder().encode(canonicalJson(payload)),
        keyPair.secretKey,
      );
      const license = { ...payload, signature: bytesToHex(signature) };

      await env.LICENSES.put(`lic:${license.license_id}`, JSON.stringify(license));
      await env.INDEX.put(indexKey, license.license_id);

      return jsonResponse(license, 201);
    }

    if (request.method === "GET" && url.pathname === "/") {
      return jsonResponse({ ok: true });
    }

    return jsonResponse({ error: "not_found" }, 404);
  },
};
