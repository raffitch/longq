import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getDisplay, getParsedBundle, getSession, type Sex } from "./api";

import GuestDashboard from "./guest/GuestDashboard";
import {
  aggregateInsights,
  transformFoodData,
  transformHeavyMetals,
  transformHormones,
  transformNutritionData,
  transformToxins,
} from "./guest/dataTransform";
import type {
  RawFoodData,
  RawHeavyMetalsData,
  RawHormonesData,
  RawNutritionData,
  RawPeekData,
  RawToxinsData,
} from "./guest/types";

export default function Guest() {
  const [firstName, setFirstName] = useState<string | null>(null);
  const [clientFullName, setClientFullName] = useState<string | null>(null);
  const [data, setData] = useState<RawFoodData | null>(null);
  const [nutrition, setNutrition] = useState<RawNutritionData | null>(null);
  const [hormones, setHormones] = useState<RawHormonesData | null>(null);
  const [heavyMetals, setHeavyMetals] = useState<RawHeavyMetalsData | null>(null);
  const [toxins, setToxins] = useState<RawToxinsData | null>(null);
  const [energyMap, setEnergyMap] = useState<RawPeekData | null>(null);
  const [sex, setSex] = useState<Sex>("male");
  const lastSessionId = useRef<number | null>(null);
  const base = (import.meta.env.VITE_API_BASE ?? "http://localhost:8000") as string;
  const [searchParams] = useSearchParams();
  const previewParam = searchParams.get("session");
  const isMonitor = searchParams.has("monitor");
  const parsedPreviewId = previewParam ? Number.parseInt(previewParam, 10) : NaN;
  const previewSessionId = Number.isFinite(parsedPreviewId) ? parsedPreviewId : null;
  const isPreview = previewSessionId !== null;
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [serverDown, setServerDown] = useState(false);
  const [hasConnected, setHasConnected] = useState(false);

  useEffect(() => {
    document.title = "Quantum Qi™ - Guest Portal";
  }, []);

  const aggregated = useMemo(() => {
    const foodMap = transformFoodData(data);
    const nutritionTransformed = transformNutritionData(nutrition);
    const heavyMetalsTransformed = transformHeavyMetals(heavyMetals);
    const hormonesTransformed = transformHormones(hormones);
    const toxinsTransformed = transformToxins(toxins);
    const hasAnyData =
      foodMap.size > 0 ||
      nutritionTransformed.nutrients.length > 0 ||
      heavyMetalsTransformed.length > 0 ||
      hormonesTransformed.length > 0 ||
      toxinsTransformed.length > 0 ||
      Boolean(energyMap && (Object.keys(energyMap.organs ?? {}).length || Object.keys(energyMap.chakras ?? {}).length));
    if (!hasAnyData) {
      return null;
    }
    return aggregateInsights(
      foodMap,
      nutritionTransformed,
      heavyMetalsTransformed,
      hormonesTransformed,
      toxinsTransformed,
      energyMap,
    );
  }, [data, nutrition, heavyMetals, hormones, toxins, energyMap]);

  const formatPreviewMessage = (err: unknown): string => {
    const raw =
      err instanceof Error ? err.message : typeof err === "string" ? err : "";
    if (!raw) return "Preview unavailable.";
    const trimmed = raw.trim();
    if (trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object") {
          if (typeof parsed.detail === "string") return parsed.detail;
          const values = Object.values(parsed)
            .filter((value) => typeof value === "string")
            .join(" • ");
          if (values) return values;
        }
      } catch {
        /* ignore JSON parse errors */
      }
    }
    return trimmed || "Preview unavailable.";
  };

  const isNetworkError = (err: unknown): boolean => {
    if (err instanceof TypeError) return true;
    if (err && typeof err === "object" && "message" in err) {
      const msg = (err as any).message;
      if (typeof msg === "string" && /network|fetch/i.test(msg)) {
        return true;
      }
    }
    return false;
  };

  async function refreshOnce() {
    if (isPreview) return;
    try {
      const d = await getDisplay();
      setServerDown(false);
      setHasConnected(true);
      if (!d.session_id) {
        lastSessionId.current = null;
        const stagedFirst =
          (d.staged_first_name ??
            d.first_name ??
            (d.client_name ? d.client_name.split(" ", 1)[0] : null))?.trim() || null;
        const stagedFull =
          (d.staged_full_name ??
            d.client_name ??
            (d.first_name || d.last_name
              ? [d.first_name, d.last_name].filter(Boolean).join(" ")
              : null))?.trim() || null;
        setFirstName(stagedFirst);
        setClientFullName(stagedFull ?? stagedFirst);
        setSex(d.staged_sex ?? "male");
        setData(null);
        setNutrition(null);
        setHormones(null);
        setHeavyMetals(null);
        setToxins(null);
        setEnergyMap(null);
        return;
      }
      const stagedFirst =
        (d.staged_first_name ?? d.first_name ?? (d.client_name ? d.client_name.split(" ", 1)[0] : null))?.trim() || null;
      const stagedFull =
        (d.staged_full_name ??
          d.client_name ??
          (d.first_name || d.last_name ? [d.first_name, d.last_name].filter(Boolean).join(" ") : null))?.trim() || null;
      setFirstName(stagedFirst ?? null);
      setClientFullName(stagedFull ?? stagedFirst ?? null);
      setSex(d.sex ?? d.staged_sex ?? "male");

      const sid = d.session_id;
      if (sid) {
        try {
          const bundle = await getParsedBundle(sid);
          const reports = bundle.reports ?? {};
          setData((reports["food"] ?? null) as RawFoodData | null);
          setNutrition((reports["nutrition"] ?? null) as RawNutritionData | null);
          setHormones((reports["hormones"] ?? null) as RawHormonesData | null);
          setHeavyMetals((reports["heavy-metals"] ?? null) as RawHeavyMetalsData | null);
          setToxins((reports["toxins"] ?? null) as RawToxinsData | null);
          setEnergyMap((reports["peek"] ?? null) as RawPeekData | null);
        } catch (err) {
          if (isNetworkError(err)) {
            setServerDown(true);
          }
          setData(null);
          setNutrition(null);
          setHormones(null);
          setHeavyMetals(null);
          setToxins(null);
          setEnergyMap(null);
        }
      } else {
        setData(null);
        setNutrition(null);
        setHormones(null);
        setHeavyMetals(null);
        setToxins(null);
        setEnergyMap(null);
        setSex(d.staged_sex ?? "male");
      }
      lastSessionId.current = sid ?? null;
    } catch (err) {
      if (isNetworkError(err)) {
        setServerDown(true);
      }
      lastSessionId.current = null;
      setFirstName(null);
      setClientFullName(null);
      setData(null);
      setNutrition(null);
      setHormones(null);
      setHeavyMetals(null);
      setToxins(null);
      setEnergyMap(null);
      setSex("male");
    }
  }

  useEffect(() => {
    if (isPreview) {
      setData(null);
      setNutrition(null);
      setHormones(null);
      setHeavyMetals(null);
      setToxins(null);
      setEnergyMap(null);
    } else {
      setPreviewError(null);
    }
  }, [isPreview]);

  useEffect(() => {
    if (isPreview || isMonitor) {
      return;
    }
    const key = "longevityq_guest_heartbeat";
    const write = () => {
      try {
        localStorage.setItem(key, `${Date.now()}`);
      } catch {
        /* ignore storage errors */
      }
    };
    const clear = () => {
      try {
        localStorage.removeItem(key);
      } catch {
        /* ignore storage errors */
      }
    };
    write();
    const heartbeat = window.setInterval(write, 4000);
    const handleBeforeUnload = () => {
      clear();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      clearInterval(heartbeat);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      clear();
    };
  }, [isPreview, isMonitor]);

  useEffect(() => {
    if (isPreview) {
      return;
    }
    const wsUrl = base.replace(/^http/, "ws") + "/ws/guest";
    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let disposed = false;

    const noteServerState = (down: boolean) => {
      if (!disposed) {
        setServerDown(down);
        if (!down) {
          setHasConnected(true);
        }
      }
    };

    function connect() {
      try {
        ws = new WebSocket(wsUrl);
        ws.onopen = () => { noteServerState(false); };
        ws.onmessage = () => { refreshOnce(); };
        ws.onclose = () => {
          noteServerState(true);
          reconnectTimer = window.setTimeout(connect, 3000);
        };
        ws.onerror = () => {
          noteServerState(true);
          try { ws?.close(); } catch {}
        };
      } catch {
        noteServerState(true);
        reconnectTimer = window.setTimeout(connect, 3000);
      }
    }

    connect();
    const t = window.setInterval(refreshOnce, 30000);
    refreshOnce();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      clearInterval(t);
      try { ws?.close(); } catch {}
    };
  }, [base, isPreview]);

  useEffect(() => {
    if (!isMonitor) {
      return;
    }

    const scrollToCenter = () => {
      const doc = document.documentElement;
      const target = Math.max(0, (doc.scrollHeight - window.innerHeight) / 2);
      window.scrollTo({ top: target, behavior: "auto" });
    };

    scrollToCenter();
    const delays = [100, 400, 800, 1600, 2400];
    const ids = delays.map((delay) => window.setTimeout(scrollToCenter, delay));
    window.addEventListener("resize", scrollToCenter);
    window.addEventListener("load", scrollToCenter);

    return () => {
      ids.forEach((id) => window.clearTimeout(id));
      window.removeEventListener("resize", scrollToCenter);
      window.removeEventListener("load", scrollToCenter);
    };
  }, [isMonitor, aggregated]);

  useEffect(() => {
    if (!isPreview || previewSessionId === null) {
      return;
    }
    let cancelled = false;
    const activePreviewId = previewSessionId;

    async function loadPreview() {
      try {
        setPreviewError(null);
        const sessionInfo = await getSession(activePreviewId);
        if (cancelled) return;
        setServerDown(false);
        setHasConnected(true);
        const displayFirst =
          sessionInfo.first_name ??
          (sessionInfo.client_name ? sessionInfo.client_name.split(" ", 1)[0] : null);
        setFirstName(displayFirst ?? null);
        setClientFullName(sessionInfo.client_name ?? null);
        setSex(sessionInfo.sex ?? "male");

        if (!sessionInfo.published) {
          setData(null);
          setPreviewError("Publish to generate a preview.");
          setNutrition(null);
          setHormones(null);
          setHeavyMetals(null);
          setToxins(null);
          setEnergyMap(null);
          setSex(sessionInfo.sex ?? "male");
          return;
        }

        try {
          const bundle = await getParsedBundle(activePreviewId);
          if (cancelled) return;
          const reports = bundle.reports ?? {};
          setData((reports["food"] ?? null) as RawFoodData | null);
          setNutrition((reports["nutrition"] ?? null) as RawNutritionData | null);
          setHormones((reports["hormones"] ?? null) as RawHormonesData | null);
          setHeavyMetals((reports["heavy-metals"] ?? null) as RawHeavyMetalsData | null);
          setToxins((reports["toxins"] ?? null) as RawToxinsData | null);
          setEnergyMap((reports["peek"] ?? null) as RawPeekData | null);
          setPreviewError(null);
        } catch (err) {
          if (cancelled) return;
          if (isNetworkError(err)) {
            setServerDown(true);
          }
          setPreviewError(formatPreviewMessage(err));
          setData(null);
          setNutrition(null);
          setHormones(null);
          setHeavyMetals(null);
          setToxins(null);
          setEnergyMap(null);
          setSex("male");
        }
      } catch (err) {
        if (cancelled) return;
        if (isNetworkError(err)) {
          setServerDown(true);
        }
        setPreviewError(formatPreviewMessage(err));
        setData(null);
        setNutrition(null);
        setHormones(null);
        setHeavyMetals(null);
        setToxins(null);
        setEnergyMap(null);
        setSex("male");
      }
    }

    loadPreview();
    const timer = window.setInterval(loadPreview, 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isPreview, previewSessionId]);

  if (serverDown) {
    if (!hasConnected) {
      const waitingName = clientFullName ?? firstName;
      return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-[#0f1114] px-6 text-center text-slate-100">
          <div className="space-y-6">
            <div className="relative mx-auto w-fit">
              <div
                className="pointer-events-none absolute inset-0 -z-10 rounded-full bg-cyan-400/40 blur-3xl"
                aria-hidden="true"
              />
              <img src="/quantum-qi-logo.png" alt="Quantum Qi™ logo" className="mx-auto w-40 max-w-[60vw]" />
            </div>
            <div className="flex flex-col items-center gap-1">
              <h1 className="font-logo text-3xl font-semibold tracking-wider text-text-primary leading-none">
                <span className="inline-flex items-baseline">
                  <span>Quantum Qi</span>
                  <span className="logo-tm">TM</span>
                </span>
              </h1>
              <span className="text-xs font-medium tracking-[0.12em] text-teal-300">by Longevity Wellness</span>
            </div>
            <div className="flex flex-col items-center gap-4">
              <div
                className="h-12 w-12 animate-spin rounded-full border-4 border-teal-300 border-t-transparent"
                aria-hidden="true"
              />
              <p className="text-lg text-slate-300">
                {waitingName ? `Preparing ${waitingName}'s experience…` : "Preparing your experience…"}
              </p>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#0f1114] px-6 text-center text-slate-100">
        <div className="max-w-md space-y-4">
          <h1 className="text-3xl font-bold">Connection Lost</h1>
          <p className="text-lg text-slate-300">
            This session has been terminated. Close this window and restart the program once the console is back online.
          </p>
        </div>
      </div>
    );
  }

  if (!aggregated) {
    if (isPreview) {
      const message = previewError ?? "Waiting for live data…";
      return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-[#0f1114] px-6 text-center text-slate-100">
          <div className="max-w-lg space-y-4">
            <span className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-300">Staged Preview</span>
            {clientFullName && <h1 className="text-3xl font-semibold text-text-primary">{clientFullName}</h1>}
            <p className="text-lg text-slate-300">{message}</p>
          </div>
        </div>
      );
    }
    const displayName = clientFullName ?? firstName;
    const hasActiveSession = lastSessionId.current !== null;
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#0f1114] px-6 text-center text-slate-100">
        <div className="space-y-4">
          <div className="relative mx-auto w-fit">
            <div
              className="pointer-events-none absolute inset-0 -z-10 rounded-full bg-cyan-400/40 blur-3xl"
              aria-hidden="true"
            />
            <img src="/quantum-qi-logo.png" alt="Quantum Qi™ logo" className="mx-auto w-52 max-w-[70vw]" />
          </div>
          <div className="flex flex-col items-center gap-1">
            <h1 className="font-logo text-4xl font-semibold tracking-wider text-text-primary leading-none">
              <span className="inline-flex items-baseline">
                <span>Quantum Qi</span>
                <span className="logo-tm">TM</span>
              </span>
            </h1>
            <span className="text-xs font-medium tracking-[0.12em] text-teal-300">by Longevity Wellness</span>
          </div>
          <p className="text-2xl text-slate-200">
            {displayName ? `Welcome ${displayName}` : "Welcome"}
          </p>
          <p className="text-lg text-slate-300">
            {hasActiveSession ? "Your wellness journey is in process" : "Your wellness journey is about to begin"}
          </p>
        </div>
      </div>
    );
  }

  const displayFullName = clientFullName ?? firstName ?? null;

  return (
    <GuestDashboard
      clientFullName={displayFullName}
      reportDate={null}
      aggregated={aggregated}
      isPreview={isPreview}
      sex={sex}
    />
  );
}
