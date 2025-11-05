function detectRuntimeApiBase(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const stored = window.sessionStorage?.getItem?.("LONGQ_API_BASE");
    if (stored && stored.startsWith("http")) {
      return stored;
    }
  } catch {
    /* ignore sessionStorage access errors */
  }
  try {
    const params = new URLSearchParams(window.location.search ?? "");
    const fromQuery = params.get("apiBase");
    if (fromQuery && fromQuery.startsWith("http")) {
      try {
        window.sessionStorage?.setItem?.("LONGQ_API_BASE", fromQuery);
      } catch {
        /* sessionStorage may be unavailable */
      }
      return fromQuery;
    }
  } catch {
    /* ignore malformed search params */
  }
  const injected = (globalThis as any).__LONGQ_API_BASE__;
  if (typeof injected === "string" && injected.startsWith("http")) {
    try {
      window.sessionStorage?.setItem?.("LONGQ_API_BASE", injected);
    } catch {
      /* ignore */
    }
    return injected;
  }
  return null;
}

export const API_BASE = detectRuntimeApiBase() ?? (import.meta.env.VITE_API_BASE ?? "http://localhost:8000");

const BASE = API_BASE;

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
      headers: { "Content-Type": "application/json" },
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }));
}
export async function banner(sessionId:number): Promise<BannerOut> {
  return ok(await fetch(`${BASE}/sessions/${sessionId}/banner`));
}
export async function uploadPdf(sessionId:number, kind:ReportKind, file:File): Promise<FileOut> {
  const fd = new FormData();
  fd.append("file", file);
  return ok(await fetch(`${BASE}/sessions/${sessionId}/upload/${kind}`, { method:"POST", body: fd }));
}
export async function parseFile(fileId:number): Promise<ParsedOut> {
  return ok(await fetch(`${BASE}/files/${fileId}/parse`, { method:"POST" }));
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}
export async function getParsedBundle(sessionId: number): Promise<ParsedBundleOut> {
  return ok(await fetch(`${BASE}/sessions/${sessionId}/parsed`));
}

export async function getSession(sessionId:number): Promise<Session> {
  return ok(await fetch(`${BASE}/sessions/${sessionId}`));
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
    headers: { "Content-Type": "application/json" },
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
  const r = await fetch(`${BASE}/display/current`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function notifyOperatorWindowOpen(): Promise<void> {
  try {
    await fetch(`${BASE}/operator/window-open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  } catch {
    /* ignore connectivity errors */
  }
}

export function notifyOperatorWindowClosed(): void {
  const url = `${BASE}/operator/window-closed`;
  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    try {
      let body: BodyInit | null = null;
      if (typeof Blob !== "undefined") {
        body = new Blob(["{}"], { type: "application/json" });
      }
      navigator.sendBeacon(url, body);
      return;
    } catch {
      /* ignore sendBeacon errors */
    }
  }
  if (typeof fetch !== "undefined") {
    try {
      void fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
    headers: { "Content-Type": "application/json" },
  });
  if (!r.ok) {
    throw new Error(await r.text());
  }
}

export async function getDiagnostics(limit = 20): Promise<DiagnosticEntry[]> {
  const r = await fetch(`${BASE}/diagnostics?limit=${limit}`);
  if (!r.ok) {
    throw new Error(await r.text());
  }
  const payload = await r.json();
  const entries = Array.isArray(payload?.entries) ? payload.entries : [];
  return entries as DiagnosticEntry[];
}
