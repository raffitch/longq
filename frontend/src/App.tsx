import React, { useState } from "react";
import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import Operator from "./Operator";
import Guest from "./Guest";
import "./index.css";

export default function App() {
  const [sessionId, setSessionId] = useState<number | null>(null);
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={
          <div style={{padding:20}}>
            <h1>Quantum Qi</h1>
            <p>Open the console and guest views:</p>
            <ul>
              <li><Link to="/operator">Operator console</Link></li>
              <li><Link to="/guest" target="_blank">Guest screen</Link></li>
            </ul>
          </div>
        } />
        <Route path="/operator" element={<Operator onSessionReady={setSessionId} />} />
        <Route path="/guest" element={<Guest />} />
      </Routes>
    </BrowserRouter>
  );
}
