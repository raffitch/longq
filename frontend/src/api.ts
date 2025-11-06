const DEV_MODE = Boolean(import.meta.env.DEV);

const STORAGE_KEYS = {
  base: "LONGQ_API_BASE",
  token: "LONGQ_API_TOKEN",
} as const;

const globalScope = typeof globalThis !== "undefined" ? (globalThis as Record<string, unknown>) : {};

function persistValue(key: string, value: string | null): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    if (value) {
      window.sessionStorage?.setItem?.(key, value);
      window.localStorage?.setItem?.(key, value);
    } else {
      window.sessionStorage?.removeItem?.(key);
      window.localStorage?.removeItem?.(key);
    }
  } catch {
    /* ignore storage errors */
  }
}

function readInjectedBase(): string | null {
  const injected = globalScope.__LONGQ_API_BASE__;
  return typeof injected === "string" && injected.startsWith("http") ? injected : null;
}

function readInjectedToken(): string | null {
  const injected = globalScope.__LONGQ_API_TOKEN__;
  if (typeof injected === "string" && injected.length > 0) {
    persistValue(STORAGE_KEYS.token, injected);
    return injected;
  }
  return null;
}

function readStoredValue(key: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  const read = (storage: Storage | undefined | null) => {
    if (!storage) return null;
    try {
      const value = storage.getItem(key);
      return typeof value === "string" && value.length > 0 ? value : null;
    } catch {
      return null;
    }
  };
  return read(window.sessionStorage) ?? read(window.localStorage);
}

function detectRuntimeApiBase(): string {
  const injected = readInjectedBase();
  if (injected) {
    return injected;
  }
  const stored = readStoredValue(STORAGE_KEYS.base);
  if (stored) {
    return stored;
  }
  if (DEV_MODE && typeof window !== "undefined") {
    try {
      const params = new URLSearchParams(window.location.search ?? "");
      const fromQuery = params.get("apiBase");
      if (fromQuery && fromQuery.startsWith("http")) {
        return fromQuery;
      }
    } catch {
      /* ignore malformed search params */
    }
  }
  const fallback = import.meta.env.VITE_API_BASE;
  if (typeof fallback === "string" && fallback.startsWith("http")) {
    return fallback;
  }
  return "http://localhost:8000";
}

function detectInitialApiToken(): string | null {
  const injected = readInjectedToken();
  if (injected) {
    return injected;
  }
  if (DEV_MODE && typeof window !== "undefined") {
    try {
      const params = new URLSearchParams(window.location.search ?? "");
      const fromQuery = params.get("apiToken");
      if (fromQuery && fromQuery.length > 0) {
        persistValue(STORAGE_KEYS.token, fromQuery);
        return fromQuery;
      }
    } catch {
      /* ignore malformed params */
    }
  }
  const envToken = import.meta.env.VITE_LONGQ_API_TOKEN;
  if (typeof envToken === "string" && envToken.length > 0) {
    return envToken;
  }
  const stored = readStoredValue(STORAGE_KEYS.token);
  if (stored) {
    return stored;
  }
  return null;
}

export const API_BASE = detectRuntimeApiBase();
const BASE = API_BASE;

let runtimeToken: string | null = detectInitialApiToken();

if (typeof window !== "undefined") {
  persistValue(STORAGE_KEYS.base, API_BASE);
  if (runtimeToken) {
    persistValue(STORAGE_KEYS.token, runtimeToken);
  }
}

export function getApiToken(): string | null {
  if (runtimeToken && runtimeToken.length > 0) {
    return runtimeToken;
  }
  const injected = readInjectedToken();
  if (injected) {
    runtimeToken = injected;
    return runtimeToken;
  }
  if (DEV_MODE) {
    const stored = readStoredValue(STORAGE_KEYS.token);
    if (stored) {
      runtimeToken = stored;
      return runtimeToken;
    }
  }
  return null;
}

export function setApiToken(token: string | null, persist = true): void {
  runtimeToken = token;
  if (persist) {
    persistValue(STORAGE_KEYS.token, token);
  }
}

function authHeaders(headers: Record<string, string> = {}): Record<string, string> {
  const next = { ...headers };
  const token = getApiToken();
  if (token && !next.Authorization) {
    next.Authorization = `Bearer ${token}`;
  }
  return next;
}

export type ReportKind = "food" | "heavy-metals" | "hormones" | "nutrition" | "toxins" | "peek";
export type Sex = "male" | "female";
export type Session = { id:number; code:string; client_name:string; first_name:string|null; last_name:string|null; folder_name:string|null; state:string; published:boolean; sex: Sex };
export type FileOut = { id:number; kind:string; filename:string; status:string; error?:string };
export type ParsedOut<T=any> = { session_id:number; kind:string; data:T };
export type BannerOut = { message:string };
export type ParsedBundleOut = { session_id:number; reports:Record<string, unknown> };
export type DiagnosticEntry = {
  code: string;
  level: string;
  message: string;
  timestamp: string;
  detail?: string | null;
  logger?: string;
  pathname?: string;
  lineno?: number;
};

async function ok<T>(r: Response): Promise<T> { if (!r.ok) throw new Error(await r.text()); return r.json(); }

export async function createSession(first_name: string, last_name: string, sex: Sex): Promise<Session> {
  return ok(
    await fetch(`${BASE}/sessions`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ first_name, last_name, sex }),
    }),
  );
}
export async function updateSession(
  sessionId:number,
  data:{client_name?:string; first_name?:string; last_name?:string; sex?: Sex},
): Promise<Session> {
  return ok(await fetch(`${BASE}/sessions/${sessionId}`, {
    method: "PATCH",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(data),
  }));
}
export async function banner(sessionId:number): Promise<BannerOut> {
  return ok(await fetch(`${BASE}/sessions/${sessionId}/banner`, { headers: authHeaders() }));
}
export async function uploadPdf(sessionId:number, kind:ReportKind, file:File): Promise<FileOut> {
  const fd = new FormData();
  fd.append("file", file);
  return ok(await fetch(`${BASE}/sessions/${sessionId}/upload/${kind}`, { method:"POST", body: fd, headers: authHeaders() }));
}
export async function parseFile(fileId:number): Promise<ParsedOut> {
  return ok(await fetch(`${BASE}/files/${fileId}/parse`, { method:"POST", headers: authHeaders() }));
}
export async function publish(
  sessionId: number,
  publish = true,
  selected?: Record<ReportKind, boolean>,
): Promise<{ ok: boolean; published: boolean }> {
  const body: Record<string, unknown> = { publish };
  if (selected) {
    body.selected_reports = selected;
  }
  return ok(
    await fetch(`${BASE}/sessions/${sessionId}/publish`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    }),
  );
}
export async function getParsedBundle(sessionId: number): Promise<ParsedBundleOut> {
  return ok(await fetch(`${BASE}/sessions/${sessionId}/parsed`, { headers: authHeaders() }));
}

export async function getSession(sessionId:number): Promise<Session> {
  return ok(await fetch(`${BASE}/sessions/${sessionId}`, { headers: authHeaders() }));
}

export type DisplaySessionPayload = {
  sessionId?: number | null;
  stagedSessionId?: number | null;
  stagedFirstName?: string | null;
  stagedFullName?: string | null;
  stagedSex?: Sex | null;
};

export async function setDisplaySession(payload: DisplaySessionPayload): Promise<{ok:boolean}> {
  const body: Record<string, unknown> = {};
  if ("sessionId" in payload) {
    body.session_id = payload.sessionId;
  }
  if ("stagedSessionId" in payload) {
    body.staged_session_id = payload.stagedSessionId;
  }
  if ("stagedFirstName" in payload) {
    body.staged_first_name = payload.stagedFirstName;
  }
  if ("stagedFullName" in payload) {
    body.staged_full_name = payload.stagedFullName;
  }
  if ("stagedSex" in payload) {
    body.staged_sex = payload.stagedSex;
  }
  const r = await fetch(`${BASE}/display/current`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getDisplay(): Promise<{
  session_id: number | null;
  client_name?: string;
  first_name?: string;
  last_name?: string;
  published?: boolean;
  staged_session_id?: number | null;
  staged_first_name?: string | null;
  staged_full_name?: string | null;
  sex?: Sex | null;
  staged_sex?: Sex | null;
}> {
  const r = await fetch(`${BASE}/display/current`, { headers: authHeaders() });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function notifyOperatorWindowOpen(): Promise<void> {
  try {
    await fetch(`${BASE}/operator/window-open`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: "{}",
    });
  } catch {
    /* ignore connectivity errors */
  }
}

export function notifyOperatorWindowClosed(): void {
  const url = `${BASE}/operator/window-closed`;
  if (typeof fetch !== "undefined") {
    try {
      void fetch(url, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: "{}",
        keepalive: true,
      });
    } catch {
      /* ignore fetch errors */
    }
  }
}

export async function closeSession(sessionId: number): Promise<void> {
  const r = await fetch(`${BASE}/sessions/${sessionId}/close`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
  });
  if (!r.ok) {
    throw new Error(await r.text());
  }
}

export async function getDiagnostics(limit = 20): Promise<DiagnosticEntry[]> {
  const r = await fetch(`${BASE}/diagnostics?limit=${limit}`, { headers: authHeaders() });
  if (!r.ok) {
    throw new Error(await r.text());
  }
  const payload = await r.json();
  const entries = Array.isArray(payload?.entries) ? payload.entries : [];
  return entries as DiagnosticEntry[];
}
