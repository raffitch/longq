import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { getLicenseLocation, type LicenseLocation, type LicenseStatus } from "../api";
import { Button } from "../ui/Button";
import { cn } from "../ui/cn";
import { useLicense, type LicenseMode } from "./LicenseContext";

type ActivationPanelProps = {
  variant?: "full" | "inline";
  initialMode?: LicenseMode;
  onClose?: (() => void) | null;
  compact?: boolean;
};

const LICENSE_READY_STATES = new Set<LicenseStatus["state"]>(["valid", "disabled"]);

const ERROR_MESSAGES: Record<string, string> = {
  email_forbidden: "That email is not allowed or the seat limit has been reached.",
  invalid_request: "Check the email address and try again.",
  network_error: "Unable to reach the activation server. Check your network connection.",
  server_error: "The license server is temporarily unavailable. Try again shortly.",
  conflict: "This computer already has a license assigned. Contact support to reset seats.",
  verification_failed: "The downloaded license failed verification. Try again in a moment.",
};

function describeStatus(status: LicenseStatus | null): string {
  if (!status) {
    return "License status pending.";
  }
  if (status.state === "valid") {
    return status.license?.license_id
      ? `License ${status.license.license_id} verified.`
      : "License verified.";
  }
  if (status.state === "disabled") {
    return "License enforcement disabled for this session.";
  }
  if (status.state === "missing") {
    return "No license file detected on this machine.";
  }
  if (status.state === "invalid") {
    return status.message ?? "The saved license could not be validated.";
  }
  if (status.state === "error") {
    return status.message ?? "The license file could not be read.";
  }
  return "License verification required.";
}

function formatTimestamp(input: string | null): string | null {
  if (!input) {
    return null;
  }
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toLocaleString();
}

const tabBase =
  "flex-1 rounded-full border border-border px-3 py-2 text-center text-[13px] font-semibold transition-colors";

export function ActivationPanel({
  variant = "full",
  initialMode = "activate",
  onClose,
  compact = false,
}: ActivationPanelProps) {
  const { status, loading, error, reload, activate } = useLicense();
  const [mode, setMode] = useState<LicenseMode>(initialMode);
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [folderMessage, setFolderMessage] = useState<string | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [openingFolder, setOpeningFolder] = useState(false);
  const [licenseLocation, setLicenseLocation] = useState<LicenseLocation | null>(null);
  const notifiedRef = useRef(false);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  const ready = status ? LICENSE_READY_STATES.has(status.state) : false;
  const inline = variant === "inline";

  useEffect(() => {
    let cancelled = false;
    const loadLocation = async () => {
      try {
        const loc = await getLicenseLocation();
        if (!cancelled) {
          setLicenseLocation(loc);
        }
      } catch {
        if (!cancelled) {
          setLicenseLocation(null);
        }
      }
    };
    void loadLocation();
    return () => {
      cancelled = true;
    };
  }, [ready]);

  const handleOpenFolder = useCallback(() => {
    setFolderError(null);
    setFolderMessage(null);
    setOpeningFolder(true);

    const run = async () => {
      try {
        const location = await getLicenseLocation();
        setLicenseLocation(location);
        if (!location.exists) {
          throw new Error(
            "License file is missing on disk. Activate or refresh to download it again.",
          );
        }
        const targetFile = location.path;
        const openPathFn = window.longqLicense?.openPath || window.longqLicense?.openDirectory;
        if (!openPathFn) {
          setFolderError(
            `Opening the license file automatically is only supported inside the desktop app. Path: ${targetFile}`,
          );
          return;
        }
        const result = await openPathFn(targetFile);
        if (result?.ok) {
          setFolderMessage("Opened license file in the default editor.");
        } else {
          const reason =
            result?.error ??
            "Unable to open the license file automatically. Please open it manually using the path below.";
          setFolderError(`${reason} Path: ${targetFile}`);
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unable to open license folder. Please try again.";
        setFolderError(message);
      } finally {
        setOpeningFolder(false);
      }
    };

    void run();
  }, []);

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!email.trim()) {
        setFormError("Enter the email associated with your license.");
        return;
      }
      setSubmitting(true);
      setFeedback(mode === "refresh" ? "Refreshing license…" : "Requesting license…");
      setFormError(null);

      const run = async () => {
        try {
          await activate(email.trim(), mode);
          await reload();
          setFeedback("License verified. Opening the console…");
        } catch (err) {
          const code =
            typeof err === "object" && err !== null && "code" in err
              ? (err as { code?: string }).code
              : undefined;
          const fallback = err instanceof Error ? err.message : "Activation failed.";
          setFormError(ERROR_MESSAGES[code as string] ?? fallback);
          setFeedback(null);
        } finally {
          setSubmitting(false);
        }
      };

      void run();
    },
    [activate, email, mode, reload],
  );

  const renderSummary = useMemo(() => {
    if (!status?.license) {
      return null;
    }
    const issued = formatTimestamp(status.license.issued_at);
    return (
      <div className="rounded-2xl border border-border bg-surface/80 p-4 text-[13px] text-text-secondary shadow-sm">
        <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-text-secondary/70">
          Current License
        </div>
        <dl className="mt-3 space-y-1.5">
          <div className="flex justify-between gap-3">
            <dt className="font-medium text-text-primary/80">License ID</dt>
            <dd className="text-right text-text-primary">{status.license.license_id || "—"}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="font-medium text-text-primary/80">Product</dt>
            <dd className="text-right text-text-primary">{status.license.product || "—"}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="font-medium text-text-primary/80">Issued</dt>
            <dd className="text-right text-text-primary">{issued || "—"}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="font-medium text-text-primary/80">Features</dt>
            <dd className="text-right text-text-primary">
              {(status.license.features ?? []).join(", ") || "core"}
            </dd>
          </div>
          {licenseLocation && (
            <div className="flex flex-col gap-1 text-left">
              <dt className="font-medium text-text-primary/80">License Path</dt>
              <dd className="break-all text-text-primary text-[12px]">{licenseLocation.path}</dd>
            </div>
          )}
        </dl>
      </div>
    );
  }, [licenseLocation, status]);

  const shellClasses = cn(
    "rounded-[32px] border border-border bg-surface/90 p-8 text-text-primary shadow-surface-lg backdrop-blur",
    inline && "border-dashed bg-transparent p-6 shadow-none backdrop-blur-0",
    compact && "rounded-2xl p-3 text-[12px]",
  );

  useEffect(() => {
    if (ready && !notifiedRef.current) {
      notifiedRef.current = true;
      try {
        window.longqLicense?.notifyActivated?.();
      } catch {
        /* ignore */
      }
    }
  }, [ready]);

  return (
    <div className={shellClasses}>
      <div className={cn("space-y-4", compact && "space-y-2.5")}>
        <div
          className={cn("space-y-1 text-center lg:text-left", compact && "space-y-0.5 text-left")}
        >
          {compact ? (
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-teal-200">
              <img
                src="/quantum-qi-logo.png"
                alt="Quantum Qi™ logo"
                className="h-8 w-8 rounded-full border border-teal-500/40 bg-black/30 object-contain p-1"
              />
              <div className="flex flex-col">
                <span>Quantum Qi™</span>
                <span className="text-[9px] text-text-secondary">Activation</span>
              </div>
            </div>
          ) : (
            <p className="text-[12px] font-semibold uppercase tracking-[0.35em] text-teal-200">
              Quantum Qi™ Activation
            </p>
          )}
          <h1
            className={cn(
              "text-[28px] font-semibold leading-tight text-text-primary",
              compact && "text-[20px]",
            )}
          >
            {ready ? "License Verified" : "Unlock the Operator Console"}
          </h1>
          {!compact && (
            <p className="text-[14px] text-text-secondary">
              Enter the email that was provisioned for your clinic. The app will contact the secure
              license service, save the response locally, and verify the signature before launching
              the full experience.
            </p>
          )}
        </div>

        <div
          className={cn(
            "rounded-2xl border border-border bg-neutral-dark/60 p-4 text-[13px] text-text-primary shadow-inner",
            compact && "p-3 text-[11px]",
          )}
        >
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-[0.3em] text-text-secondary/80">
                Status
              </div>
              <div className="text-[15px] font-semibold text-white">{describeStatus(status)}</div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="soft"
                size="sm"
                className="whitespace-nowrap"
                type="button"
                disabled={loading}
                onClick={() => {
                  void reload();
                }}
              >
                Refresh Status
              </Button>
            </div>
          </div>
          {error && (
            <p className="mt-3 text-[13px] text-accent-warning">
              Unable to retrieve license status: {error}
            </p>
          )}
        </div>

        {!compact && renderSummary}

        {ready ? (
          <div
            className={cn(
              "rounded-2xl border border-border bg-surface-muted/60 p-5 text-[13px] text-text-secondary",
              compact && "p-3 text-[11px]",
            )}
          >
            <p className="text-text-primary">
              License verified on this device. You may close this window to continue using Quantum
              Qi™.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="primary"
                className="flex-1 min-w-[180px]"
                onClick={handleOpenFolder}
                disabled={openingFolder}
              >
                {openingFolder ? "Opening…" : "Open License File"}
              </Button>
              {onClose && (
                <Button
                  type="button"
                  variant="secondary"
                  className="flex-1 min-w-[140px]"
                  onClick={onClose}
                >
                  Close
                </Button>
              )}
            </div>
            {folderMessage && <p className="mt-2 text-accent-info">{folderMessage}</p>}
            {folderError && <p className="mt-2 text-accent-warning">{folderError}</p>}
          </div>
        ) : (
          <div className={cn("rounded-2xl border border-border bg-surface-muted/60 p-5", compact && "p-4")}>
            <div className="mb-3 flex gap-2">
              <button
                type="button"
                className={cn(
                  tabBase,
                  mode === "activate"
                    ? "bg-surface text-text-primary shadow"
                    : "text-text-secondary",
                )}
                onClick={() => setMode("activate")}
              >
                Activate
              </button>
              <button
                type="button"
                className={cn(
                  tabBase,
                  mode === "refresh"
                    ? "bg-surface text-text-primary shadow"
                    : "text-text-secondary",
                )}
                onClick={() => setMode("refresh")}
              >
                Refresh License
              </button>
            </div>
            <form className={cn("space-y-4", compact && "space-y-2.5")} onSubmit={handleSubmit}>
              <label
                className={cn("block text-[13px] text-text-secondary", compact && "text-[12px]")}
              >
                Email Address
                <input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  className={cn(
                    "mt-1 w-full rounded-xl border border-border bg-neutral-dark px-3 py-2 text-[14px] text-text-primary outline-none focus:border-accent focus:ring-1 focus:ring-accent/50",
                    compact && "py-1.5 text-[13px]",
                  )}
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              {formError && <p className="text-[13px] text-accent-warning">{formError}</p>}
              {feedback && <p className="text-[13px] text-accent-info">{feedback}</p>}
              <Button type="submit" disabled={submitting} className="w-full">
                {mode === "refresh" ? "Refresh License" : "Activate"}
              </Button>
              {!compact && (
                <p className="text-[12px] text-text-secondary">
                  No personal data is stored locally: only the signed license JSON from the server
                  lives on this device. Your email is transmitted directly to the secure activation
                  endpoint.
                </p>
              )}
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

export function ActivationPage() {
  const [params] = useSearchParams();
  const initialMode = params.get("mode") === "refresh" ? "refresh" : "activate";
  const compact = params.get("view") === "compact";
  const containerClasses = compact
    ? "bg-logo-background min-h-screen px-3 py-2 text-text-primary flex items-center justify-center"
    : "min-h-screen bg-logo-background px-4 py-10 text-text-primary flex items-center justify-center";
  const wrapperClasses = compact
    ? "w-full max-w-[500px] space-y-2.5"
    : "w-full max-w-[720px] space-y-8";
  const heroLogoClass = compact ? "w-16" : "w-32";
  const heroSubtitleClass = compact ? "text-[11px]" : "text-[15px]";
  const heroWrapperClass = compact
    ? "flex flex-col items-center gap-1 text-center"
    : "flex flex-col items-center gap-2 text-center";
  return (
    <div className={containerClasses}>
      <div className={wrapperClasses}>
        {!compact && (
          <div className={heroWrapperClass}>
            <div className="relative mx-auto w-fit">
              <div
                className="pointer-events-none absolute inset-0 -z-10 rounded-full bg-cyan-400/40 blur-3xl"
                aria-hidden="true"
              />
              <img
                src="/quantum-qi-logo.png"
                alt="Quantum Qi™ logo"
                className={cn("mx-auto max-w-[60vw]", heroLogoClass)}
              />
            </div>
            <h1
              className={cn(
                "guest-welcome-title font-logo text-text-primary leading-none",
                compact ? "text-[24px]" : "text-[28px]",
              )}
            >
              <span className="inline-flex items-baseline">
                <span>Quantum Qi</span>
                <span className="logo-tm">TM</span>
              </span>
            </h1>
            <span className={cn("guest-welcome-subtitle", heroSubtitleClass)}>
              by Longevity Wellness
            </span>
          </div>
        )}
        <ActivationPanel initialMode={initialMode} compact={compact} />
      </div>
    </div>
  );
}
