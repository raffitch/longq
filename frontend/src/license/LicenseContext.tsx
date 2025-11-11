import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import {
  activateLicense,
  getLicenseStatus,
  refreshLicense,
  type LicenseApiError,
  type LicenseStatus,
} from "../api";

export type LicenseMode = "activate" | "refresh";

type LicenseContextValue = {
  status: LicenseStatus | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  activate: (email: string, mode?: LicenseMode) => Promise<LicenseStatus>;
};

const LicenseContext = createContext<LicenseContextValue | undefined>(undefined);

export function LicenseProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await getLicenseStatus();
      setStatus(next);
      setError(null);
    } catch (err) {
      const message =
        (err as LicenseApiError)?.message ?? "Unable to contact the license service.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      if (cancelled) return;
      await load();
    };
    void bootstrap();
    const timer = window.setInterval(() => {
      void load();
    }, 300000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [load]);

  const reload = useCallback(async () => {
    setLoading(true);
    await load();
  }, [load]);

  const activate = useCallback(
    async (email: string, mode: LicenseMode = "activate") => {
      const trimmed = email.trim();
      if (!trimmed) {
        const err = new Error("Email is required.") as LicenseApiError;
        err.code = "email_required";
        throw err;
      }
      const runner = mode === "refresh" ? refreshLicense : activateLicense;
      const next = await runner(trimmed);
      setStatus(next);
      setError(null);
      return next;
    },
    [],
  );

  const value = useMemo<LicenseContextValue>(
    () => ({
      status,
      loading,
      error,
      reload,
      activate,
    }),
    [activate, error, loading, reload, status],
  );

  return <LicenseContext.Provider value={value}>{children}</LicenseContext.Provider>;
}

export function useLicense(): LicenseContextValue {
  const ctx = useContext(LicenseContext);
  if (!ctx) {
    throw new Error("useLicense must be used within a LicenseProvider");
  }
  return ctx;
}
