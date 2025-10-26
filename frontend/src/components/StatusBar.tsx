import React from "react";

export function StatusBar({ remaining = 0, step = "", last = "" }: { remaining?: number; step?: string; last?: string }) {
  return (
    <div style={{
      position: "fixed", bottom: 0, left: 0, right: 0,
      background: "#0f1115", color: "#c7cbd1", padding: "10px 16px",
      display: "flex", alignItems: "center", gap: 16, fontFamily: "Inter,system-ui",
      borderTop: "1px solid #1c212b"
    }}>
      <div style={{ opacity: .8 }}>Status: <b>{step || "idle"}</b></div>
      <div style={{ opacity: .8 }}>Remaining: <b>{remaining ?? 0}s</b></div>
      <div style={{ opacity: .6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{last}</div>
    </div>
  );
}
