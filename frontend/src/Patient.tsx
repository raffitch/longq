import React, { useEffect, useRef, useState } from "react";
import { getDisplay } from "./api";

type FoodData = {
  pages: {
    page: number;
    section: string;
    categories: { name: string; items: { name: string; score?: number }[] }[];
  }[];
};

function Circle({ label, score }: { label: string; score?: number }) {
  const size = 90;
  const ring = typeof score === "number" ? Math.max(2, Math.min(10, Math.round((score / 100) * 10))) : 4;
  return (
    <div style={{
      width: size, height: size, borderRadius: "9999px",
      border: `${ring}px solid #35e3b1`,
      display: "flex", alignItems: "center", justifyContent: "center",
      margin: 6, padding: 10, textAlign: "center",
      background: "radial-gradient(60% 60% at 50% 40%, rgba(53,227,177,0.15), rgba(0,0,0,0))",
      color: "#e8fdf6", fontSize: 11, lineHeight: 1.2, boxShadow: "0 0 18px rgba(53,227,177,0.25) inset"
    }}>
      <div style={{overflow: "hidden", textOverflow: "ellipsis"}}>{label}</div>
    </div>
  );
}

export default function Patient() {
  const [clientName, setClientName] = useState<string | null>(null);
  const [data, setData] = useState<FoodData | null>(null);
  const lastSessionId = useRef<number | null>(null);
  const base = (import.meta.env.VITE_API_BASE ?? "http://localhost:8000") as string;

  async function refreshOnce() {
    try {
      const d = await getDisplay();
      if (!d.session_id) {
        lastSessionId.current = null;
        setClientName(null);
        setData(null);
        return;
      }
      setClientName(d.client_name ?? null);

      const sid = d.session_id;
      const r = await fetch(`${base}/sessions/${sid}/parsed/food`);
      if (r.ok) {
        const json = await r.json();
        setData(json.data as FoodData);
      } else {
        setData(null);
      }
      lastSessionId.current = sid;
    } catch {
      /* ignore transient errors */
    }
  }

  useEffect(() => {
    const wsUrl = base.replace(/^http/, "ws") + "/ws/patient";
    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;

    function connect() {
      try {
        ws = new WebSocket(wsUrl);
        ws.onmessage = () => { refreshOnce(); };
        ws.onclose = () => { reconnectTimer = window.setTimeout(connect, 3000); };
        ws.onerror = () => { try { ws?.close(); } catch {} };
      } catch {
        reconnectTimer = window.setTimeout(connect, 3000);
      }
    }

    connect();
    const t = window.setInterval(refreshOnce, 30000);
    refreshOnce();

    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      clearInterval(t);
      try { ws?.close(); } catch {}
    };
  }, []);

  // Welcome screen (no "waiting" text, no status bar)
  if (!data) {
    return (
      <div style={{minHeight:"100vh", background:"#0b0d10", color:"#e8fdf6", fontFamily:"Inter,system-ui",
                   display:"flex", alignItems:"center", justifyContent:"center", textAlign:"center", padding:24}}>
        <div>
          <div style={{fontSize:32, fontWeight:800, letterSpacing:0.2}}>LongevityQ</div>
          <div style={{opacity:.9, marginTop:8, fontSize:22}}>
            {clientName ? <>Hi, {clientName}.</> : "Welcome."}
          </div>
          <div style={{opacity:.7, marginTop:4, fontSize:16}}>
            Your wellness journey is about to begin.
          </div>
        </div>
      </div>
    );
  }

  // Results (no banner above results)
  return (
    <div style={{minHeight:"100vh", background:"#0b0d10", color:"#fff", fontFamily:"Inter,system-ui"}}>
      <div style={{maxWidth:1100, margin:"0 auto", padding:"28px 24px 60px"}}>
        <div style={{display:"flex", alignItems:"center", justifyContent:"space-between"}}>
          <h1 style={{fontSize:26, fontWeight:700, margin:0}}>Food Report</h1>
          {clientName && <div style={{opacity:.85, fontSize:14}}>Client: {clientName}</div>}
        </div>

        {data.pages.map((pg, idx) => (
          <section key={idx} style={{marginTop:18, background:"#11151b", borderRadius:14, padding:"16px 16px 8px",
                                      boxShadow:"0 10px 40px rgba(0,0,0,0.35), inset 0 0 0 1px rgba(255,255,255,0.03)"}}>
            <div style={{display:"flex", alignItems:"baseline", justifyContent:"space-between", marginBottom:10}}>
              <div style={{fontWeight:600}}>{pg.section || `Page ${pg.page}`}</div>
              <div style={{opacity:.6, fontSize:12}}>Page {pg.page}</div>
            </div>

            {pg.categories.map((c, j) => (
              <div key={j} style={{margin:"10px 0 18px"}}>
                <div style={{fontWeight:600, marginBottom:10}}>{c.name}</div>
                <div style={{display:"flex", flexWrap:"wrap"}}>
                  {c.items.map((it, k) => (
                    <Circle key={k} label={it.name} score={it.score} />
                  ))}
                </div>
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
