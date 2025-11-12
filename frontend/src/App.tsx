import React, { useState } from "react";
import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import Operator from "./Operator";
import Guest from "./Guest";
import "./index.css";
import { ActivationPage } from "./license/ActivationView";

export default function App() {
  const [, setSessionId] = useState<number | null>(null);
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={
            <div className="flex min-h-screen items-center justify-center bg-logo-background px-6 text-text-primary">
              <div className="w-full max-w-[480px] rounded-3xl border border-border bg-surface/90 p-8 text-center shadow-surface-lg">
                <h1 className="text-[30px] font-semibold">Quantum Qi™</h1>
                <p className="mt-2 text-[14px] text-text-secondary">
                  Desktop companion for the Operator Console and Guest display. Pick a screen to get
                  started.
                </p>
                <div className="mt-6 space-y-3">
                  <Link className="block" to="/operator">
                    <span className="block rounded-xl bg-accent px-4 py-3 text-[15px] font-semibold text-white shadow hover:scale-[1.01]">
                      Launch Operator Console
                    </span>
                  </Link>
                  <Link className="block" to="/guest" target="_blank">
                    <span className="block rounded-xl border border-border px-4 py-3 text-[15px] font-semibold text-text-primary hover:bg-surface-muted">
                      Open Guest Screen
                    </span>
                  </Link>
                  <Link className="block text-[13px] text-accent-info" to="/activation">
                    Manage License
                  </Link>
                </div>
              </div>
            </div>
          }
        />
        <Route path="/activation" element={<ActivationPage />} />
        <Route path="/operator" element={<Operator onSessionReady={setSessionId} />} />
        <Route path="/guest" element={<Guest />} />
      </Routes>
    </BrowserRouter>
  );
}
