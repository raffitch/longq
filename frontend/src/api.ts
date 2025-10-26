const BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";

export type Session = { id:number; code:string; client_name:string; state:string; published:boolean };
export type FileOut = { id:number; kind:string; filename:string; status:string; error?:string };
export type ParsedOut<T=any> = { session_id:number; kind:string; data:T };
export type BannerOut = { message:string };

async function ok<T>(r: Response): Promise<T> { if (!r.ok) throw new Error(await r.text()); return r.json(); }

export async function createSession(client_name: string): Promise<Session> {
  return ok(await fetch(`${BASE}/sessions`, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ client_name })}));
}
export async function banner(sessionId:number): Promise<BannerOut> {
  return ok(await fetch(`${BASE}/sessions/${sessionId}/banner`));
}
export async function uploadPdf(sessionId:number, kind:"food", file:File): Promise<FileOut> {
  const fd = new FormData(); fd.append("file", file);
  return ok(await fetch(`${BASE}/sessions/${sessionId}/upload/${kind}`, { method:"POST", body: fd }));
}
export async function parseFile(fileId:number): Promise<ParsedOut> {
  return ok(await fetch(`${BASE}/files/${fileId}/parse`, { method:"POST" }));
}
export async function publish(sessionId:number, publish=true): Promise<{ok:boolean;published:boolean}> {
  return ok(await fetch(`${BASE}/sessions/${sessionId}/publish`, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ publish })}));
}
export async function getParsed(sessionId:number, kind:"food"): Promise<ParsedOut> {
  return ok(await fetch(`${BASE}/sessions/${sessionId}/parsed/${kind}`));
}

export async function setDisplaySession(sessionId: number | null): Promise<{ok:boolean}> {
  const r = await fetch(`${BASE}/display/current`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getDisplay(): Promise<{session_id:number|null, client_name?:string, published?:boolean}> {
  const r = await fetch(`${BASE}/display/current`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
