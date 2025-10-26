import React, { useState } from "react";
import {
  createSession,
  uploadPdf,
  parseFile,
  publish,
  setDisplaySession,
  type Session,
  type FileOut,
} from "./api";

export default function Operator({ onSessionReady }: { onSessionReady: (id: number) => void }) {
  const [clientName, setClientName] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [fileOut, setFileOut] = useState<FileOut | null>(null);
  const [parsedOk, setParsedOk] = useState<boolean>(false);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");

  async function onCreate() {
    try {
      if (!clientName.trim()) return;
      setError("");
      setStatus("Creating session…");
      const s = await createSession(clientName.trim());
      setSession(s);
      onSessionReady(s.id);
      setStatus(`Session #${s.id} ready`);
    } catch (e: any) {
      setError(e.message ?? String(e));
      setStatus("");
    }
  }

  async function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (!session) return;
    const f = e.dataTransfer.files?.[0];
    if (!f) return;
    await handleUpload(f);
  }

  async function handleUpload(file: File) {
    try {
      setError("");
      setParsedOk(false);
      setStatus("Uploading PDF…");
      const up = await uploadPdf(session!.id, "food", file);
      setFileOut(up);
      setStatus(`Uploaded "${up.filename}". Ready to parse.`);
    } catch (e: any) {
      setError(e.message ?? String(e));
      setStatus("");
    }
  }

  async function onParse() {
    try {
      if (!fileOut) return;
      setError("");
      setParsedOk(false);
      setStatus("Parsing…");
      await parseFile(fileOut.id);
      setParsedOk(true);
      setStatus("Parsed. Review if needed, then click Publish when ready.");
    } catch (e: any) {
      setParsedOk(false);
      setError(e.message ?? String(e));
      setStatus("Parsing failed.");
    }
  }

  async function onPublish() {
    try {
      if (!session) return;
      setError("");
      setStatus("Publishing…");
      await publish(session.id, true);
      // broadcast to patient tab(s)
      localStorage.setItem("longevityq_publish", JSON.stringify({ sessionId: session.id, ts: Date.now() }));
      setStatus("Published. Patient screen will now show results.");
    } catch (e: any) {
      setError(e.message ?? String(e));
      setStatus("Publish failed.");
    }
  }

  async function showOnPatient() {
    if (!session) return;
    await setDisplaySession(session.id);
    localStorage.setItem("longevityq_publish", JSON.stringify({ sessionId: session.id, ts: Date.now() }));
    setStatus("Bound current session to patient screen.");
  }

  async function clearPatient() {
    await setDisplaySession(null);
    localStorage.setItem("longevityq_publish", JSON.stringify({ sessionId: 0, ts: Date.now() }));
    setStatus("Cleared patient screen.");
  }

  return (
    <div style={{ padding: "16px" }}>
      <h1 style={{ fontSize: "20px", fontWeight: 700 }}>Operator Console</h1>

      {/* Create session */}
      <div style={{ marginTop: "8px" }}>
        <input
          style={{ border: "1px solid #ccc", padding: "6px", marginRight: "8px" }}
          placeholder="Client name"
          value={clientName}
          onChange={(e) => setClientName(e.target.value)}
        />
        <button
          style={{ padding: "6px 10px", background: "#111", color: "#fff", borderRadius: "6px" }}
          onClick={onCreate}
          disabled={!clientName.trim()}
        >
          Create Session
        </button>
        {session && (
          <>
            <a
              href={`${window.location.origin}/patient`}
              target="_blank"
              rel="noreferrer"
              style={{
                marginLeft: 8,
                padding: "6px 10px",
                background: "#0ea5e9",
                color: "#fff",
                borderRadius: "6px",
                textDecoration: "none",
              }}
              title="Open the patient-facing screen in a new tab"
            >
              Open Patient Screen
            </a>
            <button
              onClick={showOnPatient}
              style={{ marginLeft: 8, padding: "6px 10px", background: "#2563eb", color: "#fff", borderRadius: 6 }}
              title="Bind this session to the patient screen"
            >
              Show on Patient
            </button>
            <button
              onClick={clearPatient}
              style={{ marginLeft: 8, padding: "6px 10px", background: "#6b7280", color: "#fff", borderRadius: 6 }}
              title="Clear the patient screen"
            >
              Hide from Patient
            </button>
          </>
        )}
      </div>

      {/* Drag & drop + optional file input */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        style={{
          marginTop: "16px",
          border: "2px dashed #999",
          borderRadius: "10px",
          padding: "28px",
          textAlign: "center",
          opacity: session ? 1 : 0.5,
        }}
        title={session ? "Drop the FOOD PDF here" : "Create a session first"}
      >
        {session ? (
          <>
            Drag & drop FOOD PDF here
            <div style={{ marginTop: 10, fontSize: 12, color: "#555" }}>or</div>
            <label
              style={{
                display: "inline-block",
                marginTop: 10,
                padding: "6px 10px",
                background: "#eee",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              Choose file…
              <input
                type="file"
                accept="application/pdf"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f && session) handleUpload(f);
                }}
              />
            </label>
          </>
        ) : (
          "Create session first"
        )}
      </div>

      {/* Actions */}
      <div style={{ marginTop: "12px" }}>
        <button
          onClick={onParse}
          disabled={!fileOut}
          style={{
            padding: "6px 10px",
            marginRight: "8px",
            background: "#222",
            color: "#fff",
            borderRadius: "6px",
            opacity: fileOut ? 1 : 0.5,
          }}
        >
          Parse
        </button>
        <button
          onClick={onPublish}
          disabled={!session || !parsedOk}
          style={{
            padding: "6px 10px",
            background: "#16a34a",
            color: "#fff",
            borderRadius: "6px",
            opacity: session && parsedOk ? 1 : 0.5,
          }}
        >
          Publish
        </button>
      </div>

      {/* Status + error */}
      <div style={{ marginTop: "8px", fontSize: "12px", color: "#444" }}>{status}</div>
      {error && (
        <div style={{ marginTop: "6px", fontSize: "12px", color: "#b91c1c" }}>
          Error: {error}
        </div>
      )}

      {/* Session summary */}
      {session && (
        <div style={{ fontSize: "12px", marginTop: "6px" }}>
          Session #{session.id} • {session.client_name}
          {fileOut && (
            <span style={{ marginLeft: 8, color: "#555" }}>
              • File: <em>{fileOut.filename}</em>
            </span>
          )}
          {parsedOk && <span style={{ marginLeft: 8, color: "#16a34a" }}>• Parsed ✓</span>}
        </div>
      )}
    </div>
  );
}
