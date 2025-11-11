import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ManageLicenseModal } from "./license/ManageLicenseModal";
import { useLicense } from "./license/LicenseContext";
import { Button } from "./ui/Button";
import { Chip } from "./ui/Chip";
import { cn } from "./ui/cn";
import {
  useThresholdLimitValue,
  useThresholdMaxValue,
  useVisibleSeverities,
} from "./hooks/useThresholdSettings";
import { setThresholdLimit, setVisibleSeverities } from "./shared/thresholdConfig";
import { GENERAL_SEVERITY_META, GENERAL_SEVERITY_ORDER, type GeneralSeverity } from "./shared/priority";
import {
  createSession,
  updateSession,
  uploadPdf,
  parseFile,
  publish,
  setDisplaySession,
  closeSession,
  notifyOperatorWindowOpen,
  notifyOperatorWindowClosed,
  getDiagnostics,
  API_BASE,
  getApiToken,
  type Session,
  type FileOut,
  type ReportKind,
  type Sex,
  type DiagnosticEntry,
} from "./api";
import type { ElectronDiagnosticsEvent } from "./types/electron";

const REPORT_DEFS: { kind: ReportKind; label: string; aliases: string[] }[] = [
  { kind: "food", label: "Food", aliases: ["food"] },
  { kind: "heavy-metals", label: "Heavy Metals", aliases: ["heavy metals", "heavy-metals", "heavy_metals"] },
  { kind: "hormones", label: "Hormones", aliases: ["hormones"] },
  { kind: "nutrition", label: "Nutrition", aliases: ["nutrition"] },
  { kind: "toxins", label: "Toxins", aliases: ["toxins"] },
  { kind: "peek", label: "PEEK Report", aliases: ["peek", "peek report", "energy", "energy-map", "energy map"] },
];

type PresetKey = "energy-health" | "food" | "health" | "energy" | "custom";

const PRESET_DEFS: Array<{ key: PresetKey; label: string; reports: ReportKind[] | null }> = [
  { key: "energy-health", label: "Energy & Health", reports: ["peek", "nutrition", "hormones", "toxins", "heavy-metals"] },
  { key: "food", label: "Food", reports: ["food"] },
  { key: "health", label: "Health", reports: ["nutrition", "hormones", "toxins", "heavy-metals"] },
  { key: "energy", label: "Energy", reports: ["peek"] },
  { key: "custom", label: "Custom", reports: null },
];

const DEFAULT_PRESET_KEY: PresetKey = "energy-health";

const PRESET_REPORT_SETS: Record<PresetKey, Set<ReportKind>> = PRESET_DEFS.reduce((acc, preset) => {
  acc[preset.key] = new Set(preset.reports ?? []);
  return acc;
}, {} as Record<PresetKey, Set<ReportKind>>);

const LABEL: Record<ReportKind, string> = {
  food: "food",
  "heavy-metals": "heavy metals",
  hormones: "hormones",
  nutrition: "nutrition",
  toxins: "toxins",
  peek: "peek",
};

type UploadMap = Record<ReportKind, FileOut | null>;
type UploadErrorMap = Record<ReportKind, string | null>;
type DroppedFile = { file: File; relativePath: string; name: string };
type SelectionMap = Record<ReportKind, boolean>;
type ParsedMap = Record<ReportKind, boolean>;
const GUEST_HEARTBEAT_KEY = "longevityq_guest_heartbeat";
// Allow extra slack so background-tab timer throttling (which can stretch to >60s) does not trigger false "closed" states.
const GUEST_HEARTBEAT_GRACE_MS = 180000;
const AUTO_OPEN_GRACE_MS = 5000;
const PREVIEW_VIEWPORT = {
  width: 1440,
  height: 5120,
  label: "9:32 • 1440 × 5120",
} as const;
const DEFAULT_PREVIEW_SCALE = 0.55;
const FIT_MAX_DIMENSION = 720;
const MIN_PREVIEW_HEIGHT = 1000;
const FIT_SCALE_MARGIN = 24;
const ORIGINAL_WIDTH_BUFFER = 64;
const darkInputClasses =
  "rounded-lg border border-border-strong bg-neutral-dark px-2.5 py-1.5 text-text-primary shadow-[inset_0_1px_2px_rgba(15,23,42,0.45)] outline-none caret-accent-info focus:ring-2 focus:ring-accent-info/40";
const cardShellClasses = "rounded-2xl border border-border/80 bg-surface text-text-primary shadow-sm";
const statusCardClasses = "rounded-2xl border border-border/80 bg-surface text-text-primary shadow-sm";
const tileBaseClasses =
  "flex h-full min-w-0 flex-col gap-2.5 rounded-3xl border border-border/70 p-3.5 text-text-primary transition-colors duration-200";
type ChipVariant = React.ComponentProps<typeof Chip>["variant"];

function buildMap<T>(initial: T): Record<ReportKind, T> {
  const map = {} as Record<ReportKind, T>;
  for (const def of REPORT_DEFS) {
    map[def.kind] = initial;
  }
  return map;
}

function emptyParsed(): ParsedMap {
  return buildMap(false);
}

function createEmptyUploadMap(): UploadMap {
  return buildMap<FileOut | null>(null);
}

function createEmptyErrorMap(): UploadErrorMap {
  return buildMap<string | null>(null);
}

function createSelectionMap(initial = false): SelectionMap {
  return buildMap<boolean>(initial);
}

function buildSelectionForPreset(key: PresetKey): SelectionMap {
  const base = createSelectionMap(false);
  const reports = PRESET_REPORT_SETS[key];
  if (!reports) {
    return base;
  }
  reports.forEach((kind) => {
    base[kind] = true;
  });
  return base;
}

function detectPreset(selection: SelectionMap): PresetKey {
  for (const preset of PRESET_DEFS) {
    if (!preset.reports) {
      continue;
    }
    const expected = PRESET_REPORT_SETS[preset.key];
    let matches = true;
    for (const def of REPORT_DEFS) {
      const shouldSelect = expected.has(def.kind);
      if ((selection[def.kind] ?? false) !== shouldSelect) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return preset.key;
    }
  }
  return "custom";
}

function selectionsEqual(a: SelectionMap, b: SelectionMap): boolean {
  for (const def of REPORT_DEFS) {
    if ((a[def.kind] ?? false) !== (b[def.kind] ?? false)) {
      return false;
    }
  }
  return true;
}

function currentSessionNames(s: Session): { first: string; last: string } {
  const first = s.first_name ?? (s.client_name?.split(" ", 1)[0] ?? "");
  let last = s.last_name ?? "";
  if (!last && s.client_name) {
    const parts = s.client_name.split(" ");
    if (parts.length > 1) {
      last = parts.slice(1).join(" ");
    }
  }
  return { first, last };
}

function formatErrorMessage(err: unknown): string {
  const raw =
    typeof err === "string"
      ? err
      : err && typeof err === "object" && "message" in err && typeof (err as any).message === "string"
      ? (err as any).message
      : "";

  if (raw) {
    const trimmed = raw.trim();
    if (trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object") {
          if (typeof parsed.detail === "string") return parsed.detail;
          if (Array.isArray(parsed.detail)) return parsed.detail.join("; ");
          const values = Object.values(parsed)
            .filter((v) => typeof v === "string")
            .join("; ");
          if (values) return values;
        }
      } catch {
        // fall through to raw text
      }
    }
    return trimmed;
  }

  try {
    return JSON.stringify(err);
  } catch {
    return "Unexpected error.";
  }
}

function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  if (err && typeof err === "object" && "message" in err) {
    const msg = (err as any).message;
    if (typeof msg === "string" && /network|fetch|failed to fetch/i.test(msg)) {
      return true;
    }
  }
  return false;
}

function detectReportKind(filename: string): ReportKind | null {
  const name = filename.toLowerCase();
  for (const def of REPORT_DEFS) {
    if (def.aliases.some((alias) => name.includes(alias))) {
      return def.kind;
    }
  }
  return null;
}

function formatReportFilename(filename: string, kind: ReportKind): string {
  const dotIndex = filename.lastIndexOf(".");
  const base = dotIndex >= 0 ? filename.slice(0, dotIndex) : filename;
  const extension = dotIndex >= 0 ? filename.slice(dotIndex) : "";
  const totalLimit = 45;
  const maxBaseLength = Math.max(0, totalLimit - extension.length);
  const truncated =
    base.length > maxBaseLength && maxBaseLength > 3
      ? `${base.slice(0, maxBaseLength - 3)}...${extension}`
      : `${base}${extension}`;
  const def = REPORT_DEFS.find((d) => d.kind === kind);
  if (def) {
    const lowerBase = truncated.toLowerCase();
    for (const alias of def.aliases) {
      const idx = lowerBase.lastIndexOf(alias.toLowerCase());
      if (idx !== -1) {
        const aliasEnd = idx + alias.length;
        const before = truncated.slice(0, aliasEnd);
        const after = truncated.slice(aliasEnd).replace(/^[\s._-]+/, "");
        const withBreak = after ? `${before}\n${after}` : before;
        return withBreak;
      }
    }
  }
  return truncated.replace(/[_-]+/g, " ");
}

function formatClientName(raw: string): string {
  const cleaned = raw.replace(/[._]+/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  const fixWord = (word: string) =>
    word
      .split(/-+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join("-");
  return cleaned
    .split(" ")
    .filter(Boolean)
    .map(fixWord)
    .join(" ");
}

function formatFullName(first?: string | null, last?: string | null): string {
  return [first, last].filter(Boolean).join(" ");
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeNameLoose(value: string): string {
  return value
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function getRootFolderName(files: DroppedFile[]): string | null {
  const roots = new Set<string>();
  for (const { relativePath, name } of files) {
    const rel = relativePath || name;
    const parts = rel.split(/[\\/]/);
    if (parts.length > 1) {
      const root = parts[0]?.trim();
      if (root) roots.add(root);
    }
  }
  if (roots.size === 0) return null;
  if (roots.size === 1) return Array.from(roots)[0];
  return null;
}

async function readEntries(reader: any): Promise<any[]> {
  return new Promise((resolve, reject) => {
    reader.readEntries(
      (entries: any[]) => resolve(entries),
      (err: unknown) => reject(err),
    );
  });
}

async function traverseEntry(entry: any, path: string): Promise<DroppedFile[]> {
  if (entry.isFile) {
    return new Promise((resolve) => {
      entry.file(
        (file: File) => {
          const relativePath = path || file.name;
          resolve([{ file, relativePath, name: file.name }]);
        },
        () => resolve([]),
      );
    });
  }

  if (entry.isDirectory) {
    const reader = entry.createReader();
    const results: DroppedFile[] = [];
    // Read entries in batches until directory is exhausted
    for (;;) {
      const batch = await readEntries(reader);
      if (!batch.length) break;
      for (const child of batch) {
        const childPath = path ? `${path}/${child.name}` : child.name;
        const childFiles = await traverseEntry(child, childPath);
        results.push(...childFiles);
      }
    }
    return results;
  }

  return [];
}

async function collectFilesFromDataTransfer(dt: DataTransfer): Promise<DroppedFile[]> {
  const items = Array.from(dt.items ?? []);
  const entries: any[] = [];
  for (const item of items) {
    // @ts-ignore non-standard API supported by Chromium-based browsers
    const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
    if (entry) entries.push(entry);
  }

  if (!entries.length) {
    return filesFromFileList(dt.files);
  }

  const nested = await Promise.all(
    entries.map((entry) => traverseEntry(entry, entry.name || "")),
  );
  return nested.flat();
}

function filesFromFileList(list: FileList | null): DroppedFile[] {
  if (!list) return [];
  return Array.from(list).map((file) => {
    const relativePath = (file as any).webkitRelativePath || file.name;
    return { file, relativePath, name: file.name };
  });
}

export default function Operator({ onSessionReady }: { onSessionReady: (id: number) => void }) {
  const [firstNameInput, setFirstNameInput] = useState("");
  const [lastNameInput, setLastNameInput] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [uploads, setUploads] = useState<UploadMap>(() => createEmptyUploadMap());
  const [uploadErrors, setUploadErrors] = useState<UploadErrorMap>(() => createEmptyErrorMap());
  const [selectedReports, setSelectedReports] = useState<SelectionMap>(() => createSelectionMap(false));
  const [parsedState, setParsedState] = useState<ParsedMap>(() => emptyParsed());
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [isDragActive, setIsDragActive] = useState<boolean>(false);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [isEditingName, setIsEditingName] = useState<boolean>(false);
  const [editedFirstName, setEditedFirstName] = useState<string>("");
  const [editedLastName, setEditedLastName] = useState<string>("");
  const [editedSex, setEditedSex] = useState<Sex | null>(null);
  const [lastDroppedFiles, setLastDroppedFiles] = useState<DroppedFile[]>([]);
  const [backendDown, setBackendDown] = useState(false);
  const [backendReady, setBackendReady] = useState(false);
  const [hasPendingChanges, setHasPendingChanges] = useState(false);
  const [sexSelection, setSexSelection] = useState<Sex | "">("");
  const [fitPreview, setFitPreview] = useState(true);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [licenseModalOpen, setLicenseModalOpen] = useState(false);
  const licenseModal = licenseModalOpen ? <ManageLicenseModal onClose={() => setLicenseModalOpen(false)} /> : null;
  const { status: licenseStatus, loading: licenseLoading } = useLicense();
  const licenseReady = licenseStatus ? licenseStatus.state === "valid" || licenseStatus.state === "disabled" : false;
  const waitingForLicense = licenseLoading && !licenseReady;
  const needsActivation = !licenseLoading && !licenseReady;
  const [diagnosticsEntries, setDiagnosticsEntries] = useState<DiagnosticEntry[]>([]);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [diagnosticsFetchError, setDiagnosticsFetchError] = useState<string | null>(null);
  const [livePreviewArea, setLivePreviewArea] = useState(() => ({
    width: FIT_MAX_DIMENSION,
    height: FIT_MAX_DIMENSION,
  }));
  const [stagedPreviewArea, setStagedPreviewArea] = useState(() => ({
    width: FIT_MAX_DIMENSION,
    height: FIT_MAX_DIMENSION,
  }));
  const [presetsEnabled, setPresetsEnabled] = useState(false);
  const thresholdLimit = useThresholdLimitValue();
  const thresholdMax = useThresholdMaxValue();
  const visibleSeverities = useVisibleSeverities();
  const visibleSeveritiesSet = new Set<GeneralSeverity>(visibleSeverities as GeneralSeverity[]);
  const [showThresholdControls, setShowThresholdControls] = useState(false);
  const viewportWidth = PREVIEW_VIEWPORT.width;
  const viewportHeight = PREVIEW_VIEWPORT.height;
  const currentPreset = useMemo<PresetKey>(() => {
    if (!presetsEnabled) {
      return DEFAULT_PRESET_KEY;
    }
    return detectPreset(selectedReports);
  }, [presetsEnabled, selectedReports]);
  const previewToggleLabel = fitPreview ? "Switch to original size" : "Switch to fit to screen";


  useEffect(() => {
    document.title = "Quantum Qi™ - Operator Portal";
  }, []);
  useEffect(() => {
    if (session?.sex) {
      setSexSelection(session.sex);
    } else {
      setSexSelection("");
    }
  }, [session?.sex]);
  useEffect(() => {
    if (!licenseReady) {
      return undefined;
    }
    let closeNotified = false;

    const notifyClose = () => {
      if (closeNotified) return;
      closeNotified = true;
      notifyOperatorWindowClosed();
    };

    notifyOperatorWindowOpen();

    if (typeof window === "undefined") {
      return () => {
        notifyClose();
      };
    }

    const handleBeforeUnload = () => {
      notifyClose();
    };

    const handlePageHide = () => {
      notifyClose();
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handlePageHide);
      notifyClose();
    };
  }, [licenseReady]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const guestWindowRef = useRef<Window | null>(null);
  const replaceInputsRef = useRef<Record<ReportKind, HTMLInputElement | null>>({} as Record<ReportKind, HTMLInputElement | null>);
  const base = API_BASE;

  const buildWebSocketUrl = useCallback(
    (pathname: string): string | null => {
      const token = getApiToken();
      if (!token) {
        return null;
      }
      const wsBase = base.replace(/^http/, "ws");
      const url = new URL(wsBase);
      const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
      url.pathname = `${url.pathname.replace(/\/$/, "")}${normalizedPath}`;
      url.searchParams.set("token", token);
      return url.toString();
    },
    [base],
  );
  const autoOpenAttemptedRef = useRef(false);
  const autoOpenTimerRef = useRef<number | null>(null);
  const thresholdPanelRef = useRef<HTMLDivElement | null>(null);
  const livePreviewUserScrolledRef = useRef(false);
  const presetAutoAppliedRef = useRef(false);
  const presetSessionRef = useRef<number | null>(null);
  const diagnosticsPollRef = useRef<number | null>(null);
  const electronDiagnosticsSeenRef = useRef<Set<string>>(new Set());

  type OperationContext = { seq: number; signal: AbortSignal };

  const mountedRef = useRef(true);
  const fetchDiagnostics = useCallback(async () => {
    setDiagnosticsLoading(true);
    setDiagnosticsFetchError(null);
  try {
    const entries = await getDiagnostics(25);
    if (!mountedRef.current) {
      return;
    }
    setDiagnosticsEntries(entries);
  } catch (err) {
    if (!mountedRef.current) {
      return;
    }
    if (isNetworkError(err)) {
      setDiagnosticsFetchError("Backend unreachable. Ensure the Quantum Qi™ services are running, then try again.");
      markBackendDown(err);
    } else {
      setDiagnosticsFetchError(formatErrorMessage(err));
    }
  } finally {
    if (mountedRef.current) {
      setDiagnosticsLoading(false);
    }
  }
  }, []);
  const operationSeqRef = useRef(0);
  const operationAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!showThresholdControls) {
      return;
    }
    const handleMouseDown = (event: MouseEvent) => {
      const panel = thresholdPanelRef.current;
      if (panel && !panel.contains(event.target as Node)) {
        setShowThresholdControls(false);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
    };
  }, [showThresholdControls]);

  useEffect(() => {
    const maxAllowed = Math.max(1, thresholdMax);
    if (thresholdLimit > maxAllowed) {
      setThresholdLimit(maxAllowed);
    }
  }, [thresholdMax, thresholdLimit]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (operationAbortRef.current) {
        operationAbortRef.current.abort();
        operationAbortRef.current = null;
      }
      if (diagnosticsPollRef.current !== null) {
        window.clearInterval(diagnosticsPollRef.current);
        diagnosticsPollRef.current = null;
      }
    };
  }, []);

  const abortInFlight = () => {
    if (operationAbortRef.current) {
      operationAbortRef.current.abort();
      operationAbortRef.current = null;
    }
  };

  const beginOperation = (): OperationContext => {
    abortInFlight();
    const controller = new AbortController();
    operationAbortRef.current = controller;
    const nextSeq = operationSeqRef.current + 1;
    operationSeqRef.current = nextSeq;
    return { seq: nextSeq, signal: controller.signal };
  };

  const isOperationActive = (ctx: OperationContext) =>
    mountedRef.current && !ctx.signal.aborted && operationSeqRef.current === ctx.seq;

  const safeSetState = <Setter extends React.Dispatch<React.SetStateAction<any>>>(
    ctx: OperationContext,
    setter: Setter,
    value: Parameters<Setter>[0],
  ) => {
    if (!isOperationActive(ctx)) return;
    setter(value);
  };

  const applyState = <Setter extends React.Dispatch<React.SetStateAction<any>>>(
    setter: Setter,
    value: Parameters<Setter>[0],
    ctx?: OperationContext,
  ) => {
    if (ctx) {
      safeSetState(ctx, setter, value);
    } else {
      setter(value);
    }
  };

  useEffect(() => {
    if (!diagnosticsOpen) {
      if (diagnosticsPollRef.current !== null) {
        window.clearInterval(diagnosticsPollRef.current);
        diagnosticsPollRef.current = null;
      }
      return;
    }
    fetchDiagnostics();
    diagnosticsPollRef.current = window.setInterval(() => {
      fetchDiagnostics();
    }, 15000);
    return () => {
      if (diagnosticsPollRef.current !== null) {
        window.clearInterval(diagnosticsPollRef.current);
        diagnosticsPollRef.current = null;
      }
    };
  }, [diagnosticsOpen, fetchDiagnostics]);

  const setParsedFor = (kind: ReportKind, value: boolean, ctx?: OperationContext) => {
    applyState(setParsedState, (prev) => ({ ...prev, [kind]: value }), ctx);
  };

  const resetParsed = (kind?: ReportKind, ctx?: OperationContext) => {
    if (kind) {
      applyState(setParsedState, (prev) => ({ ...prev, [kind]: false }), ctx);
      return;
    }
    applyState(setParsedState, () => emptyParsed(), ctx);
  };

  const isParsed = (kind: ReportKind) => parsedState[kind];

  const readGuestHeartbeat = () => {
    if (typeof window === "undefined") return null;
    try {
      const stored = window.localStorage.getItem(GUEST_HEARTBEAT_KEY);
      return stored ? Number.parseInt(stored, 10) : null;
    } catch {
      return null;
    }
  };

  const guestHeartbeatAlive = () => {
    const beat = readGuestHeartbeat();
    return beat !== null && !Number.isNaN(beat) && Date.now() - beat < GUEST_HEARTBEAT_GRACE_MS;
  };

  const markBackendUp = (ctx?: OperationContext) => {
    applyState(setBackendDown, false, ctx);
    applyState(setBackendReady, true, ctx);
  };
  const markBackendDown = (err?: unknown, ctx?: OperationContext) => {
    if (err === undefined || isNetworkError(err)) {
      applyState(setBackendDown, true, ctx);
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const bridge = window.longqDiagnostics;
    if (!bridge || typeof bridge.subscribe !== "function") {
      return;
    }

    let cancelled = false;
    const seen = electronDiagnosticsSeenRef.current;

    const pushFromEvent = (event?: ElectronDiagnosticsEvent | null) => {
      if (cancelled || !event || typeof event !== "object") {
        return;
      }
      if (!event.id || seen.has(event.id)) {
        return;
      }
      seen.add(event.id);
      const entry: DiagnosticEntry = {
        code: event.type === "backend-crash" ? "BACKEND_CRASH" : "BACKEND_ERROR",
        level: "ERROR",
        message: event.message,
        timestamp: event.timestamp,
        detail: event.logTail ?? "",
        logger: "electron",
      };
      setDiagnosticsEntries((prev) => {
        const next = [entry, ...prev];
        return next.slice(0, 50);
      });
      setDiagnosticsFetchError(null);
      setError(event.message);
      setBackendDown(true);
      setBackendReady(true);
    };

    const historyPromise = bridge.getHistory?.();
    if (historyPromise && typeof historyPromise.then === "function") {
      historyPromise
        .then((history) => {
          if (cancelled || !history) {
            return;
          }
          history.forEach((event) => pushFromEvent(event));
        })
        .catch(() => {
          /* ignore history errors */
        });
    }

    const unsubscribe = bridge.subscribe((event) => {
      pushFromEvent(event);
    });

    return () => {
      cancelled = true;
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, []);

  const handleDragHighlight = (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    if (!isDragActive) {
      setIsDragActive(true);
    }
  };

  async function uploadReport(
    kind: ReportKind,
    file: File,
    displayName: string,
    ctx?: OperationContext,
  ): Promise<FileOut | null> {
    const operation = ctx ?? beginOperation();
    if (!session) return null;
    resetParsed(kind, operation);
    applyState(setUploadErrors, (prev) => ({ ...prev, [kind]: null }), operation);
    applyState(setStatus, `Uploading "${displayName}"…`, operation);
    try {
      const uploaded = await uploadPdf(session.id, kind, file);
      if (!isOperationActive(operation)) {
        return null;
      }
      applyState(setUploads, (prev) => ({ ...prev, [kind]: uploaded }), operation);
      applyState(setSelectedReports, (prev) => ({ ...prev, [kind]: true }), operation);
      applyState(setUploadErrors, (prev) => ({ ...prev, [kind]: null }), operation);
      markBackendUp(operation);
      applyState(setHasPendingChanges, true, operation);
      if (kind === "food") {
        applyState(setStatus, `Uploaded "${uploaded.filename}". Ready to parse.`, operation);
      } else {
        applyState(setStatus, `Stored "${uploaded.filename}".`, operation);
      }
      return uploaded;
    } catch (e: any) {
      if (operation.signal.aborted || !isOperationActive(operation)) {
        return null;
      }
      const message = formatErrorMessage(e);
      applyState(setUploadErrors, (prev) => ({ ...prev, [kind]: message }), operation);
      applyState(setError, message, operation);
      applyState(setStatus, `Upload failed for "${displayName}".`, operation);
      markBackendDown(e, operation);
      return null;
    }
  }

  async function parseReport(kind: ReportKind, file: FileOut, ctx?: OperationContext): Promise<boolean> {
    const operation = ctx ?? beginOperation();
    resetParsed(kind, operation);
    try {
      applyState(setError, "", operation);
      applyState(setUploadErrors, (prev) => ({ ...prev, [kind]: null }), operation);
      applyState(setStatus, `Parsing ${LABEL[kind]} report…`, operation);
      await parseFile(file.id);
      if (!isOperationActive(operation)) {
        return false;
      }
      setParsedFor(kind, true, operation);
      if (kind === "food") {
        applyState(setStatus, "Food report parsed. Ready to publish.", operation);
      } else if (kind === "nutrition") {
        applyState(setStatus, "Nutrition report parsed.", operation);
      } else if (kind === "hormones") {
        applyState(setStatus, "Hormones report parsed.", operation);
      } else if (kind === "heavy-metals") {
        applyState(setStatus, "Heavy metals report parsed.", operation);
      } else if (kind === "toxins") {
        applyState(setStatus, "Toxins report parsed.", operation);
      }
      markBackendUp(operation);
      return true;
    } catch (e: any) {
      if (operation.signal.aborted || !isOperationActive(operation)) {
        return false;
      }
      const message = formatErrorMessage(e);
      applyState(setError, message, operation);
      applyState(setUploadErrors, (prev) => ({ ...prev, [kind]: message }), operation);
      setParsedFor(kind, false, operation);
      if (kind === "food") {
        applyState(setStatus, "Parsing food report failed.", operation);
      } else if (kind === "nutrition") {
        applyState(setStatus, "Parsing nutrition report failed.", operation);
      } else if (kind === "hormones") {
        applyState(setStatus, "Parsing hormones report failed.", operation);
      } else if (kind === "heavy-metals") {
        applyState(setStatus, "Parsing heavy metals report failed.", operation);
      } else if (kind === "toxins") {
        applyState(setStatus, "Parsing toxins report failed.", operation);
      }
      markBackendDown(e, operation);
      return false;
    }
  }
  const [stagedPreviewSessionId, setStagedPreviewSessionId] = useState<number | null>(null);
  const [stagedPreviewVersion, setStagedPreviewVersion] = useState(0);
  const [hasShownOnGuest, setHasShownOnGuest] = useState(false);
  const [guestWindowOpen, setGuestWindowOpen] = useState<boolean>(() => guestHeartbeatAlive());

  const livePreviewContainerRef = useRef<HTMLDivElement | null>(null);
  const livePreviewContentRef = useRef<HTMLDivElement | null>(null);
  const stagedPreviewContainerRef = useRef<HTMLDivElement | null>(null);

  const displayFullName =
    session ? formatFullName(session.first_name, session.last_name) || session.client_name || "" : "";
  const liveMonitorMessage = (() => {
    if (hasShownOnGuest && session?.published) return "Live Reports.";
    return displayFullName ? `Welcome ${displayFullName}.` : "Welcome.";
  })();

  function resetUploadState() {
    setUploads(createEmptyUploadMap());
    setUploadErrors(createEmptyErrorMap());
    setSelectedReports(createSelectionMap(false));
    resetParsed();
    setLastDroppedFiles([]);
    setHasPendingChanges(false);
    setIsUploading(false);
  }

  function resetSession() {
    const currentSessionId = session?.id ?? null;
    abortInFlight();
    setSession(null);
    setFirstNameInput("");
    setLastNameInput("");
    resetUploadState();
    setStatus("Ready for the next guest folder.");
    setError("");
    setIsEditingName(false);
    setEditedFirstName("");
    setEditedLastName("");
    setEditedSex(null);
    setStagedPreviewSessionId(null);
    setStagedPreviewVersion((v) => v + 1);
    setHasShownOnGuest(false);
    setSexSelection("");
    void (async () => {
      if (currentSessionId) {
        try {
          await closeSession(currentSessionId);
        } catch (err) {
          setError(formatErrorMessage(err));
          markBackendDown(err);
        }
      }
      try {
        await setDisplaySession({
          sessionId: null,
          stagedSessionId: null,
          stagedFirstName: null,
          stagedFullName: null,
          stagedSex: null,
        });
        markBackendUp();
      } catch (err) {
        setError(formatErrorMessage(err));
        markBackendDown(err);
      }
    })();
  }

  useEffect(() => {
    if (guestWindowOpen) {
      autoOpenAttemptedRef.current = true;
      if (autoOpenTimerRef.current) {
        window.clearTimeout(autoOpenTimerRef.current);
        autoOpenTimerRef.current = null;
      }
      return;
    }

    if (autoOpenAttemptedRef.current) {
      return;
    }

    if (autoOpenTimerRef.current) {
      window.clearTimeout(autoOpenTimerRef.current);
    }

    autoOpenTimerRef.current = window.setTimeout(() => {
      autoOpenTimerRef.current = null;
      if (guestWindowRef.current && !guestWindowRef.current.closed) {
        autoOpenAttemptedRef.current = true;
        return;
      }
      if (!guestHeartbeatAlive()) {
        autoOpenAttemptedRef.current = true;
        openGuestWindow();
      }
    }, AUTO_OPEN_GRACE_MS);

    return () => {
      if (autoOpenTimerRef.current) {
        window.clearTimeout(autoOpenTimerRef.current);
        autoOpenTimerRef.current = null;
      }
    };
  }, [guestWindowOpen]);

  useEffect(() => {
    const computeWindowState = () => {
      let open = false;
      const ref = guestWindowRef.current;
      if (ref && ref.closed) {
        guestWindowRef.current = null;
      } else if (ref && !ref.closed) {
        open = true;
      }
      try {
        const stored = localStorage.getItem(GUEST_HEARTBEAT_KEY);
        if (stored) {
          const beat = Number.parseInt(stored, 10);
          if (!Number.isNaN(beat) && Date.now() - beat < GUEST_HEARTBEAT_GRACE_MS) {
            open = true;
          }
        }
      } catch {
        /* ignore storage read errors */
      }
      setGuestWindowOpen(open);
    };

    computeWindowState();
    const monitor = window.setInterval(computeWindowState, 2000);
    const handleStorage = (event: StorageEvent) => {
      if (event.key === GUEST_HEARTBEAT_KEY) {
        computeWindowState();
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => {
      clearInterval(monitor);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  useEffect(() => {
    if (!licenseReady) {
      return undefined;
    }
    const attemptConnect = () => {
      const wsUrl = buildWebSocketUrl("/ws/operator");
      if (!wsUrl) {
        reconnectTimer = window.setTimeout(attemptConnect, 500);
        return;
      }
      connectWithUrl(wsUrl);
    };

    const connectWithUrl = (wsUrl: string) => {
      try {
        ws = new WebSocket(wsUrl);
        ws.onopen = () => noteState(false);
        ws.onmessage = () => {};
        ws.onclose = () => {
          noteState(true);
          reconnectTimer = window.setTimeout(attemptConnect, 3000);
        };
        ws.onerror = () => {
          noteState(true);
          try { ws?.close(); } catch {}
        };
      } catch {
        noteState(true);
        reconnectTimer = window.setTimeout(attemptConnect, 3000);
      }
    };

    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let disposed = false;

    const noteState = (down: boolean) => {
      if (disposed) return;
      setBackendDown(down);
      if (!down) {
        setBackendReady(true);
      }
    };

    attemptConnect();
    return () => {
      disposed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      try { ws?.close(); } catch {}
    };
  }, [base, buildWebSocketUrl, licenseReady]);

  const handleDragLeaveArea = (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    const target = e.relatedTarget as Node | null;
    if (!target || !(e.currentTarget as Node).contains(target)) {
      setIsDragActive(false);
    }
  };

  function startEditName() {
    if (!session) return;
    const { first: currentFirst, last: currentLast } = currentSessionNames(session);
    setEditedFirstName(formatClientName(currentFirst));
    setEditedLastName(formatClientName(currentLast));
    setEditedSex(session.sex);
    setIsEditingName(true);
    setStatus("Editing guest name…");
    setError("");
  }

  function cancelEditName() {
    setIsEditingName(false);
    setEditedFirstName("");
    setEditedLastName("");
    setEditedSex(null);
    if (session) {
      const currentName = formatFullName(session.first_name, session.last_name) || session.client_name;
      setStatus(currentName ? `Drop the folder for ${currentName}.` : "Ready for the next guest folder.");
    } else {
      setStatus("");
    }
  }

  async function saveEditName() {
    if (!session) return;
    const first = formatClientName(editedFirstName);
    const last = formatClientName(editedLastName);
    if (!first) {
      setError("Enter the guest's first name.");
      return;
    }
    const nextSex = editedSex ?? session.sex;
    if (!nextSex) {
      setError("Select the guest's gender.");
      return;
    }
    const { first: currentFirst, last: currentLast } = currentSessionNames(session);
    if (
      normalizeName(first) === normalizeName(currentFirst) &&
      normalizeName(last) === normalizeName(currentLast) &&
      nextSex === session.sex
    ) {
      setIsEditingName(false);
      setEditedFirstName("");
      setEditedLastName("");
      setEditedSex(null);
      const currentName = formatFullName(currentFirst, currentLast) || session.client_name;
      setStatus(currentName ? `Drop the folder for ${currentName}.` : "Ready for the next guest folder.");
      return;
    }

    const previous = {
      clientName: session.client_name,
      firstName: session.first_name,
      lastName: session.last_name,
      sex: session.sex,
    };

    try {
      setStatus("Updating guest name…");
      setError("");
      const provisionalFull = formatFullName(first, last);
      setSession((prev) =>
        prev ? { ...prev, first_name: first, last_name: last, client_name: provisionalFull, sex: nextSex } : prev,
      );
      const updated = await updateSession(session.id, { first_name: first, last_name: last, sex: nextSex });
      markBackendUp();
      setSession(updated);
      setSexSelection(updated.sex);
      setIsEditingName(false);
      setEditedFirstName("");
      setEditedLastName("");
      setEditedSex(null);
      setStatus(`Guest name updated to ${formatFullName(updated.first_name, updated.last_name)}. Re-drop the folder if needed.`);
      try {
        await setDisplaySession({
          stagedSessionId: updated.id,
          stagedFirstName: updated.first_name ?? first,
          stagedFullName: formatFullName(updated.first_name, updated.last_name),
          stagedSex: updated.sex,
        });
        markBackendUp();
      } catch (err) {
        setError(formatErrorMessage(err));
        markBackendDown(err);
      }
      if (lastDroppedFiles.length > 0) {
        await processDroppedFiles([...lastDroppedFiles]);
      }
    } catch (e: any) {
      setSession((prev) =>
        prev
          ? {
              ...prev,
              first_name: previous.firstName,
              last_name: previous.lastName,
              client_name: previous.clientName ?? prev.client_name,
              sex: previous.sex,
            }
          : prev,
      );
      setSexSelection(previous.sex ?? "");
      setError(formatErrorMessage(e));
      setStatus("Failed to update guest name.");
      markBackendDown(e);
    }
  }

  function toggleSelection(kind: ReportKind, checked: boolean) {
    setSelectedReports((prev) => ({ ...prev, [kind]: checked }));
    setHasPendingChanges(true);
    const label = REPORT_DEFS.find((d) => d.kind === kind)?.label ?? kind;
    setError("");
    setStatus(
      checked
      ? `${label} report will be included in the guest display.`
        : `${label} report hidden from the guest display until re-selected.`,
    );
  }

  async function processDroppedFiles(dropped: DroppedFile[]) {
    const operation = beginOperation();
    if (!dropped.length) {
      applyState(setStatus, "No files detected. Drop a folder that contains the guest reports.", operation);
      return;
    }
    applyState(setLastDroppedFiles, dropped, operation);

    if (!session) {
      applyState(setStatus, "Create a session first, then drop the guest folder.", operation);
      applyState(setError, "No active session.", operation);
      return;
    }

    applyState(setError, "", operation);
    const rootName = getRootFolderName(dropped);
    if (rootName) {
      const normalizedFolder = normalizeNameLoose(rootName);
      const sessionReference =
        formatFullName(session.first_name, session.last_name) || session.client_name || "";
      const normalizedSession = normalizeNameLoose(sessionReference);
      // if (
      //   normalizedFolder &&
      //   normalizedSession &&
      //   normalizedSession.length > 0 &&
      //   normalizedFolder.indexOf(normalizedSession) === -1
      // ) {
      //   setStatus(
      //     `Folder “${rootName}” does not exactly match ${sessionReference}. Proceeding anyway.`,
      //   );
      // }
      if (normalizedSession) {
        const tokens = (value: string) => new Set(value.split(" ").filter(Boolean));
        const hasAll = (source: Set<string>, target: Set<string>) => [...target].every((token) => source.has(token));
        if (!hasAll(tokens(normalizedFolder), tokens(normalizedSession))) {
          applyState(setStatus, `Folder “${rootName}” doesn’t match ${sessionReference}. Proceeding anyway.`, operation);
        }
      }
    }

    const supportedFiles = dropped.filter(({ name }) => {
      const lower = name.toLowerCase();
      return lower.endsWith(".pdf") || lower.endsWith(".docx") || lower.endsWith(".doc");
    });
    if (!supportedFiles.length) {
      applyState(setStatus, "No supported report files (.pdf, .docx) found inside the folder.", operation);
      return;
    }

    let uploadedAny = false;

    const normalizeRelativePath = (value: string) => value.replace(/\\/g, "/");
    const isNestedEntry = (entry: DroppedFile) => {
      const relative = normalizeRelativePath(entry.relativePath || entry.name);
      if (!relative) return false;
      const withoutRoot =
        rootName && relative.startsWith(`${rootName}/`)
          ? relative.slice(rootName.length + 1)
          : relative;
      return withoutRoot.includes("/");
    };

    applyState(setIsUploading, true, operation);
    try {
      for (const entry of supportedFiles) {
        if (!isOperationActive(operation)) {
          break;
        }
        if (isNestedEntry(entry)) {
          continue;
        }
        const kind = detectReportKind(entry.name);
        if (!kind) {
          continue;
        }
        const uploaded = await uploadReport(kind, entry.file, entry.name, operation);
        if (!isOperationActive(operation)) {
          return;
        }
        if (uploaded) {
          uploadedAny = true;
        }
      }
    } finally {
      applyState(setIsUploading, false, operation);
    }

    if (uploadedAny) {
      applyState(setStatus, (prev) => prev || "Uploads complete.", operation);
    }
  }

  async function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
    const dt = e.dataTransfer;
    if (!dt) return;
    const dropped = await collectFilesFromDataTransfer(dt);
    await processDroppedFiles(dropped);
  }

  async function handleDirectorySelection(list: FileList | null) {
    const dropped = filesFromFileList(list);
    await processDroppedFiles(dropped);
  }

  async function uploadSingleReport(kind: ReportKind, file: File) {
    const operation = beginOperation();
    if (!session) {
      applyState(setStatus, "Create a session before uploading reports.", operation);
      applyState(setError, "No active session.", operation);
      return;
    }
    applyState(setIsUploading, true, operation);
    try {
      applyState(setError, "", operation);
      await uploadReport(kind, file, file.name, operation);
    } finally {
      applyState(setIsUploading, false, operation);
    }
  }

  async function onFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    await handleDirectorySelection(e.target.files);
    if (e.target) {
      e.target.value = "";
    }
  }

  function onBrowse() {
    fileInputRef.current?.click();
  }

  function onReplace(kind: ReportKind) {
    const input = replaceInputsRef.current[kind];
    if (input) {
      input.click();
    }
  }

  async function onReplaceInput(kind: ReportKind, list: FileList | null) {
    const file = list && list[0];
    if (!file) return;
    await uploadSingleReport(kind, file);
    // reset input so the same file can be chosen again if needed
    const input = replaceInputsRef.current[kind];
    if (input) {
      input.value = "";
    }
  }

  function openGuestWindow() {
    const guestUrl = `${window.location.origin}/guest`;
    const windowName = "longevityq_guest_screen";
    let target = guestWindowRef.current && !guestWindowRef.current.closed ? guestWindowRef.current : null;
    if (!target) {
      try {
        const possible = window.open("", windowName);
        if (possible && !possible.closed) {
          target = possible;
        }
      } catch {
        /* ignore inability to reference existing window */
      }
    }
    if (target) {
      try {
        if (target.location.href === "about:blank") {
          target.location.href = guestUrl;
        } else if (!target.location.href.includes("/guest")) {
          target.location.href = guestUrl;
        }
      } catch {
        target.location.href = guestUrl;
      }
      try {
        target.focus();
      } catch {
        /* focus errors can be ignored */
      }
      guestWindowRef.current = target;
      setGuestWindowOpen(true);
      setStatus("Guest window opened.");
      setError("");
      return;
    }

    const features = "noopener=yes,noreferrer=yes,width=1280,height=720,resizable=yes,scrollbars=yes";
    const opened = window.open(guestUrl, windowName, features);
    if (opened) {
      guestWindowRef.current = opened;
      try {
        opened.focus();
      } catch {
        /* ignore focus errors */
      }
      setGuestWindowOpen(true);
      setStatus("Guest window opened.");
      setError("");
    } else {
      setGuestWindowOpen(false);
      setError("Unable to open guest screen. Allow pop-ups for this site.");
    }
  }

  async function parseSelectedReports(ctx?: OperationContext, selectionOverride?: SelectionMap): Promise<boolean> {
    if (!session) return false;
    const operation = ctx ?? beginOperation();
    if (isUploading) {
      applyState(setStatus, "Upload in progress. Please wait until uploads finish before publishing.", operation);
      return false;
    }

    const selection = selectionOverride ?? selectedReports;
    const targets: Array<{ kind: ReportKind; file: FileOut }> = REPORT_DEFS.flatMap(
      (def) => {
        const file = uploads[def.kind];
        return selection[def.kind] && file
          ? [{ kind: def.kind, file }]
          : [];
      },
    );

    if (!targets.length) {
      if (!session?.published) {
        applyState(setError, "Select at least one uploaded report before publishing.", operation);
        applyState(setStatus, "No reports selected for publishing.", operation);
        return false;
      }
      applyState(setStatus, "No reports selected. Publishing will hide all reports from the guest view.", operation);
      return true;
    }

    let success = true;

    for (const target of targets) {
      if (isParsed(target.kind)) {
        continue;
      }

      const ok = await parseReport(target.kind, target.file, operation);
      if (!ok) {
        success = false;
        break;
      }
      if (!isOperationActive(operation)) {
        success = false;
        break;
      }
    }

    if (success) {
      applyState(setStatus, "Reports parsed successfully.", operation);
    }

    return success;
  }

  async function onPublish(selectionOverride?: SelectionMap, options?: { force?: boolean }) {
    if (!session) return;
    const selection = selectionOverride ?? selectedReports;
    const force = options?.force ?? false;
    const operation = beginOperation();
    if (session.published && !force && !hasPendingChanges) {
      applyState(setStatus, "No changes to publish.", operation);
      return;
    }
    applyState(setError, "", operation);
    const parsed = await parseSelectedReports(operation, selection);
    if (!parsed || !isOperationActive(operation)) {
      return;
    }
    try {
      applyState(setStatus, session.published ? "Updating live session…" : "Publishing…", operation);
      const sessionId = session.id;
      const result = await publish(sessionId, true, selection);
      if (!isOperationActive(operation)) {
        return;
      }
      localStorage.setItem(
        "longevityq_publish",
        JSON.stringify({ sessionId, ts: Date.now() }),
      );
      applyState(setSession, (prev) => (prev ? { ...prev, published: result.published } : prev), operation);
      applyState(setStagedPreviewSessionId, sessionId, operation);
      applyState(setStagedPreviewVersion, (v) => v + 1, operation);
      applyState(setHasShownOnGuest, false, operation);
      markBackendUp(operation);
      applyState(setStatus, "Session is live. Staged preview refreshed below.", operation);
      applyState(setHasPendingChanges, false, operation);
    } catch (e: any) {
      if (operation.signal.aborted || !isOperationActive(operation)) {
        return;
      }
      const message = formatErrorMessage(e);
      applyState(setError, message, operation);
      applyState(setStatus, "Publishing failed.", operation);
      markBackendDown(e, operation);
    }
  }

  const applyPresetSelection = useCallback(
    async (key: PresetKey, options?: { autoPublish?: boolean; silent?: boolean }) => {
      if (!session) return;
      const preset = PRESET_DEFS.find((definition) => definition.key === key);
      if (!preset) return;

      if (!preset.reports) {
        if (!options?.silent) {
          setStatus("Custom preset active. Adjust report selections and publish to apply.");
        }
        return;
      }

      const nextSelection = buildSelectionForPreset(key);
      const selectionChanged = !selectionsEqual(nextSelection, selectedReports);

      if (selectionChanged) {
        setSelectedReports(nextSelection);
        setHasPendingChanges(true);
      }

      const autoPublish = options?.autoPublish ?? true;
      if (!options?.silent) {
        const label = preset.label;
        setStatus(autoPublish ? `${label} preset applied. Updating guest view…` : `${label} preset applied.`);
      }
      setError("");

      if (autoPublish) {
        await onPublish(nextSelection, { force: true });
      }
    },
    [onPublish, selectedReports, session],
  );

  const handlePresetButton = useCallback(
    (key: PresetKey) => {
      if (!presetsEnabled) return;
      if (key === "custom") {
        setError("");
        setStatus("Customize the report checkboxes below, then press Update to apply.");
        return;
      }
      void applyPresetSelection(key, { autoPublish: true });
    },
    [applyPresetSelection, presetsEnabled],
  );

  useEffect(() => {
    if (!session) {
      setPresetsEnabled(false);
      presetAutoAppliedRef.current = false;
      presetSessionRef.current = null;
      return;
    }

    if (presetSessionRef.current !== session.id) {
      presetSessionRef.current = session.id;
      presetAutoAppliedRef.current = false;
    }

    const hasReports = Object.values(uploads).some(Boolean);
    const shouldEnable = Boolean(session.published && hasReports);
    setPresetsEnabled(shouldEnable);

    if (!shouldEnable) {
      presetAutoAppliedRef.current = false;
      return;
    }

    if (!presetAutoAppliedRef.current) {
      presetAutoAppliedRef.current = true;
      void applyPresetSelection(DEFAULT_PRESET_KEY, { autoPublish: true, silent: true });
    }
  }, [applyPresetSelection, session, uploads]);

  async function showOnGuest() {
    if (!session) return;
    try {
      await setDisplaySession({ sessionId: session.id });
      markBackendUp();
      localStorage.setItem(
        "longevityq_publish",
        JSON.stringify({ sessionId: session.id, ts: Date.now() }),
      );
      setStatus("Bound current session to guest screen.");
      setHasShownOnGuest(true);
    } catch (e: any) {
      setError(formatErrorMessage(e));
      setStatus("Failed to bind guest screen.");
      markBackendDown(e);
    }
  }

  async function clearGuest() {
    try {
      await setDisplaySession({ sessionId: null });
      markBackendUp();
      localStorage.setItem(
        "longevityq_publish",
        JSON.stringify({ sessionId: 0, ts: Date.now() }),
      );
      setStatus("Cleared guest screen.");
      setHasShownOnGuest(false);
    } catch (e: any) {
      setError(formatErrorMessage(e));
      setStatus("Failed to clear guest screen.");
      markBackendDown(e);
    }
  }

  const guestButtonLabel = !guestWindowOpen
    ? "Open Guest Window"
    : hasShownOnGuest
    ? "Hide"
    : "Go Live";

  const guestButtonDisabled =
    guestWindowOpen && !hasShownOnGuest && !(session?.published ?? false);

  const handleGuestButtonClick = () => {
    if (!guestWindowOpen) {
      openGuestWindow();
      return;
    }
    if (!hasShownOnGuest) {
      void showOnGuest();
    } else {
      void clearGuest();
    }
  };

  const renderSessionHeader = () => {
    if (!session) return null;
    const displayName = formatFullName(session.first_name, session.last_name) || session.client_name;
    const guestButtonVariant: React.ComponentProps<typeof Button>["variant"] =
      !guestWindowOpen || (hasShownOnGuest && guestWindowOpen)
        ? "secondary"
        : "primary";

    return (
      <div className="mt-3 flex flex-wrap items-stretch gap-4">
        <div className={cn("flex min-w-[320px] flex-1 flex-col gap-3 p-4", cardShellClasses)}>
          <div className="flex flex-col gap-3">
            {isEditingName ? (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  autoFocus
                  value={editedFirstName}
                  placeholder="First name"
                  onChange={(e) => setEditedFirstName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void saveEditName();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      cancelEditName();
                    }
                  }}
                  className={cn(darkInputClasses, "min-w-[160px]")}
                />
                <input
                  value={editedLastName}
                  placeholder="Last name (optional)"
                  onChange={(e) => setEditedLastName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void saveEditName();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      cancelEditName();
                    }
                  }}
                  className={cn(darkInputClasses, "min-w-[160px]")}
                />
                <fieldset className="flex items-center gap-2 text-[13px] text-text-secondary">
                  <legend className="sr-only">Gender</legend>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      name="edit-sex"
                      value="male"
                      checked={editedSex === "male"}
                      onChange={() => setEditedSex("male")}
                      className="h-4 w-4 text-accent-info focus:ring-accent-info/40"
                    />
                    Male
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      name="edit-sex"
                      value="female"
                      checked={editedSex === "female"}
                      onChange={() => setEditedSex("female")}
                      className="h-4 w-4 text-accent-info focus:ring-accent-info/40"
                    />
                    Female
                  </label>
                </fieldset>
                <Button type="button" variant="primary" size="icon" onClick={saveEditName} title="Save name">
                  <svg width="22" height="22" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                    <path d="M5 10.5l3 3 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </Button>
                <Button type="button" variant="danger" size="icon" onClick={cancelEditName} title="Cancel">
                  <svg width="22" height="22" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                    <path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="text-[16px] font-semibold">{displayName}</div>
                <Button type="button" variant="ghost" size="icon" onClick={startEditName} title="Edit guest name">
                  <svg width="22" height="22" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                    <path
                      d="M4 13.5v2.5h2.5L15.1 7.4l-2.5-2.5L4 13.5zM16.6 5.9a1 1 0 000-1.4l-1.1-1.1a1 1 0 00-1.4 0l-1.2 1.2 2.5 2.5 1.2-1.2z"
                      fill="currentColor"
                    />
                  </svg>
                </Button>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Chip variant={session.published ? "success" : "muted"}>{session.published ? "Published" : "Not Published"}</Chip>
              {hasShownOnGuest && guestWindowOpen && <Chip variant="info">Visible on Guest</Chip>}
            </div>
          </div>
        </div>
        <div className={cn("flex min-w-[220px] flex-[0_0_220px] flex-col justify-between gap-3 p-4", statusCardClasses)}>
          <div>
            <div className="text-[13px] font-semibold uppercase tracking-[0.3em] text-text-secondary">Guest Screen</div>
            <div className="mt-1.5 text-[12px] text-text-secondary">
              {hasShownOnGuest
                ? "Currently showing this session."
                : guestWindowOpen
                ? "Reveal on the guest screen."
                : "Guest window not open."}
            </div>
          </div>
          <div className="text-[11px] text-[#9ca3c9]">
            Status: {guestWindowOpen ? "Connected" : "Closed"}
            {guestWindowOpen && !hasShownOnGuest ? " • standing by" : ""}
          </div>
          <Button
            variant={guestButtonVariant}
            onClick={guestButtonDisabled ? undefined : handleGuestButtonClick}
            disabled={guestButtonDisabled}
            className="w-full"
          >
            {guestButtonLabel}
          </Button>
        </div>
      </div>
    );
  };

  const renderCreateForm = () => (
    <form
      className="mt-3 flex flex-wrap items-center gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const first = formatClientName(firstNameInput);
        const last = formatClientName(lastNameInput);
        if (!first) {
          setError("Enter the guest's first name.");
          setStatus("");
          return;
        }
        if (!sexSelection) {
          setError("Select the guest's gender.");
          setStatus("");
          return;
        }
        try {
          setError("");
          const full = formatFullName(first, last);
          setStatus(`Creating session for ${full}…`);
          const created = await createSession(first, last, sexSelection as Sex);
          markBackendUp();
          setSession(created);
          setSexSelection(created.sex);
          onSessionReady(created.id);
          setStagedPreviewSessionId(created.published ? created.id : null);
          setStagedPreviewVersion((v) => v + 1);
          setHasShownOnGuest(false);
          resetUploadState();
          setFirstNameInput(first);
          setLastNameInput(last);
          const createdName = formatFullName(created.first_name, created.last_name);
          setStatus(createdName ? `Drop the folder for ${createdName}.` : "Ready for the next guest folder.");
      try {
        await setDisplaySession({
          stagedSessionId: created.id,
          stagedFirstName: created.first_name ?? first,
          stagedFullName: formatFullName(created.first_name, created.last_name),
          stagedSex: created.sex,
        });
        markBackendUp();
      } catch (err) {
        setError(formatErrorMessage(err));
        markBackendDown(err);
      }
        } catch (err) {
          setError(formatErrorMessage(err));
          setStatus("Session creation failed.");
          markBackendDown(err);
        }
      }}
    >
      <input
        className={cn(darkInputClasses, "min-w-[180px]")}
        placeholder="First name"
        value={firstNameInput}
        onChange={(e) => setFirstNameInput(e.target.value)}
      />
      <input
        className={cn(darkInputClasses, "min-w-[180px]")}
        placeholder="Last name (optional)"
        value={lastNameInput}
        onChange={(e) => setLastNameInput(e.target.value)}
      />
      <div className="flex items-center gap-3 text-[13px] text-text-secondary">
        <span>Gender:</span>
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            name="session-sex-inline"
            value="male"
            checked={sexSelection === "male"}
            onChange={() => setSexSelection("male")}
            className="h-4 w-4 text-accent-info focus:ring-accent-info/40"
          />
          Male
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            name="session-sex-inline"
            value="female"
            checked={sexSelection === "female"}
            onChange={() => setSexSelection("female")}
            className="h-4 w-4 text-accent-info focus:ring-accent-info/40"
          />
          Female
        </label>
      </div>
      <Button type="submit" variant="primary" disabled={!firstNameInput.trim() || !sexSelection}>
        Create Session
      </Button>
    </form>
  );

  const renderDropZone = () => (
    <div
      onDragEnter={handleDragHighlight}
      onDragOver={handleDragHighlight}
      onDragLeave={handleDragLeaveArea}
      onDrop={handleDrop}
      className={cn(
        "flex h-full flex-wrap items-center justify-between gap-2.5 rounded-2xl border border-border/70 bg-surface px-3 py-2.5 text-[11px] text-[#4b5563] shadow-sm transition-colors duration-150",
        {
          "border-[3px] border-accent-blue bg-dropzone-active": isDragActive,
        },
      )}
    >
      <Button type="button" variant="primary" onClick={onBrowse} className="px-[14px] py-1.5 text-[12px]">
        Upload
      </Button>
      <div className="flex min-w-0 flex-1 items-center justify-end text-right">
        <div className="text-[11px] text-text-primary">Upload or drag reports on this screen.</div>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        multiple
        className="hidden"
        onChange={onFileInput}
      />
    </div>
  );

  const renderUploadAndPublishRow = () => {
    if (!session) return null;
    const publishableReports = REPORT_DEFS.filter((def) => selectedReports[def.kind] && uploads[def.kind]);
    const hasSelectedReports = publishableReports.length > 0;
    const canPublishWithoutSelection = session.published;
    const publishLocked = session.published && !hasPendingChanges;
    const disablePublish = (!hasSelectedReports && !canPublishWithoutSelection) || isUploading || publishLocked;
    const publishLabel = session.published ? (hasPendingChanges ? "Update" : "Published") : "Publish";
    const publishButtonVariant: React.ComponentProps<typeof Button>["variant"] = publishLocked ? "secondary" : "primary";
    const publishStatusText = hasSelectedReports
      ? session.published
        ? publishLocked
          ? "Published and up to date."
          : "Update to reflect recent changes."
        : "Publish the selected reports."
      : session.published
      ? "Publishing will hide all reports from the guest view."
      : "< Upload to publish.";
    const sliderMax = Math.max(1, thresholdMax);
    const sliderValue = Math.min(thresholdLimit, sliderMax);
    const handleToggleSeverity = (severity: GeneralSeverity, checked: boolean) => {
      const next = new Set(visibleSeveritiesSet);
      if (checked) {
        next.add(severity);
      } else {
        next.delete(severity);
        if (next.size === 0) {
          return;
        }
      }
      const ordered = GENERAL_SEVERITY_ORDER.filter((value) => next.has(value));
      setVisibleSeverities(ordered);
    };

    return (
      <>
        <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(220px,1fr)] md:items-stretch">
          {renderDropZone()}
          <div className="flex h-full flex-col rounded-2xl border border-border/70 bg-surface shadow-sm">
            <div className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-[11px] text-[#4b5563]">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="text-[12px] font-semibold text-text-primary">Publish Session</div>
                <div className="text-[11px] text-text-secondary">{publishStatusText}</div>
              </div>
              <div className="ml-auto flex items-center gap-3">
                <Button
                  onClick={() => onPublish()}
                  disabled={disablePublish}
                  variant={publishButtonVariant}
                  className="px-[18px]"
                >
                  {publishLabel}
                </Button>
                <div className="relative" ref={thresholdPanelRef}>
                  <button
                    type="button"
                    onClick={() => setShowThresholdControls((prev) => !prev)}
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-white shadow-surface-md transition-colors duration-150",
                      showThresholdControls ? "ring-2 ring-accent-info/40" : "hover:border-accent-info/40",
                    )}
                    title="Adjust priority display limit"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 16 16"
                      fill="currentColor"
                      className="h-4 w-4"
                      aria-hidden="true"
                    >
                      <path d="M8,11a3,3,0,1,1,3-3A3,3,0,0,1,8,11ZM8,6a2,2,0,1,0,2,2A2,2,0,0,0,8,6Z" />
                      <path d="M8.5,16h-1A1.5,1.5,0,0,1,6,14.5v-.85a5.91,5.91,0,0,1-.58-.24l-.6.6A1.54,1.54,0,0,1,2.7,14L2,13.3a1.5,1.5,0,0,1,0-2.12l.6-.6A5.91,5.91,0,0,1,2.35,10H1.5A1.5,1.5,0,0,1,0,8.5v-1A1.5,1.5,0,0,1,1.5,6h.85a5.91,5.91,0,0,1,.24-.58L2,4.82A1.5,1.5,0,0,1,2,2.7L2.7,2A1.54,1.54,0,0,1,4.82,2l.6.6A5.91,5.91,0,0,1,6,2.35V1.5A1.5,1.5,0,0,1,7.5,0h1A1.5,1.5,0,0,1,10,1.5v.85a5.91,5.91,0,0,1,.58.24l.6-.6A1.54,1.54,0,0,1,13.3,2L14,2.7a1.5,1.5,0,0,1,0,2.12l-.6.6a5.91,5.91,0,0,1,.24.58h.85A1.5,1.5,0,0,1,16,7.5v1A1.5,1.5,0,0,1,14.5,10h-.85a5.91,5.91,0,0,1-.24.58l.6.6a1.5,1.5,0,0,1,0,2.12L13.3,14a1.54,1.54,0,0,1-2.12,0l-.6-.6a5.91,5.91,0,0,1-.58.24v.85A1.5,1.5,0,0,1,8.5,16ZM5.23,12.18l.33.18a4.94,4.94,0,0,0,1.07.44l.36.1V14.5a.5.5,0,0,0,.5.5h1a.5.5,0,0,0,.5-.5V12.91l.36-.1a4.94,4.94,0,0,0,1.07-.44l.33-.18,1.12,1.12a.51.51,0,0,0,.71,0l.71-.71a.5.5,0,0,0,0-.71l-1.12-1.12.18-.33a4.94,4.94,0,0,0,.44-1.07l.1-.36H14.5a.5.5,0,0,0,.5-.5v-1a.5.5,0,0,0-.5-.5H12.91l-.1-.36a4.94,4.94,0,0,0-.44-1.07l-.18-.33L13.3,4.11a.5.5,0,0,0,0-.71L12.6,2.7a.51.51,0,0,0-.71,0L10.77,3.82l-.33-.18a4.94,4.94,0,0,0-1.07-.44L9,3.09V1.5A.5.5,0,0,0,8.5,1h-1a.5.5,0,0,0-.5.5V3.09l-.36.1a4.94,4.94,0,0,0-1.07.44l-.33.18L4.11,2.7a.51.51,0,0,0-.71,0L2.7,3.4a.5.5,0,0,0,0,.71L3.82,5.23l-.18.33a4.94,4.94,0,0,0-.44,1.07L3.09,7H1.5a.5.5,0,0,0-.5.5v1a.5.5,0,0,0,.5.5H3.09l.1.36a4.94,4.94,0,0,0,.44,1.07l.18.33L2.7,11.89a.5.5,0,0,0,0,.71l.71.71a.51.51,0,0,0,.71,0Z" />
                    </svg>
                  </button>
                  {showThresholdControls && (
                    <div className="absolute right-0 top-full z-30 mt-2 w-72 rounded-2xl border border-border bg-surface shadow-surface-md">
                      <div className="flex flex-col gap-3 p-4 text-[12px] text-text-secondary">
                        <div className="flex items-center justify-between text-[13px] text-text-primary">
                          <span>Items per priority band</span>
                          <span className="font-semibold">{sliderValue}</span>
                        </div>
                        <input
                          type="range"
                          min={1}
                          max={sliderMax}
                          value={sliderValue}
                          onChange={(event) => setThresholdLimit(Number(event.target.value))}
                          className="w-full"
                        />
                        <div className="flex items-center justify-between">
                          <span>Min: 1</span>
                          <span>Max available: {sliderMax}</span>
                        </div>
                        <div className="mt-1 border-t border-border pt-3">
                          <div className="mb-2 text-[12px] font-semibold uppercase tracking-[0.4px] text-text-primary">
                            Visible priority bands
                          </div>
                          <div className="flex flex-col gap-2">
                            {GENERAL_SEVERITY_ORDER.map((severity) => {
                              const meta = GENERAL_SEVERITY_META[severity];
                              const checked = visibleSeveritiesSet.has(severity);
                              const disable = checked && visibleSeveritiesSet.size <= 1;
                              return (
                                <label key={severity} className="flex items-center gap-3 text-[12px] text-text-secondary">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    disabled={disable}
                                    onChange={(event) => handleToggleSeverity(severity, event.target.checked)}
                                    className="h-3.5 w-3.5 accent-accent-info"
                                  />
                                  <span className="flex flex-col">
                                    <span className="text-text-primary">{meta.label}</span>
                                    <span className="text-[11px] text-text-secondary/70">{meta.range}</span>
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="mt-2.5 rounded-2xl border border-border/70 bg-surface px-3 py-2.5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2.5 text-[11px] text-[#4b5563]">
            <div className="text-[12px] font-semibold text-text-primary">Display Preset</div>
            <div className="flex flex-wrap items-center gap-2">
              {PRESET_DEFS.map((preset) => {
                const isActive = presetsEnabled && currentPreset === preset.key;
                return (
                  <button
                    key={preset.key}
                    type="button"
                    onClick={() => handlePresetButton(preset.key)}
                    disabled={!presetsEnabled}
                    aria-pressed={isActive}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.6px] transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0ea5e9]",
                      !presetsEnabled
                        ? "cursor-not-allowed border-[#d1d5db] bg-[#f3f4f6] text-[#9ca3af]"
                        : isActive
                        ? "border-[#0ea5e9] bg-[#0ea5e9]/15 text-[#0ea5e9]"
                        : "border-[#d1d5db] bg-white text-[#374151] hover:border-[#0ea5e9] hover:text-[#0ea5e9]",
                    )}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </>
    );
  };

  const renderReportTiles = () => {
    if (!session) return null;

    const tiles = REPORT_DEFS.map((def) => {
      const uploaded = uploads[def.kind];
      const err = uploadErrors[def.kind];
      const isSelected = selectedReports[def.kind];
      const tileState: "pending" | "uploaded" | "error" = uploaded && !err ? "uploaded" : err ? "error" : "pending";
      const parsedFlag = isParsed(def.kind);
      const parsedAndSelected = Boolean(parsedFlag && isSelected);
      const hasParseError = Boolean(err && uploaded);
      const needsLocatorGuidance =
        def.kind === "food" &&
        hasParseError &&
        typeof err === "string" &&
        err.toLowerCase().includes("unable to locate any food report categories");

      const isPublishedReport =
        Boolean(session?.published) &&
        Boolean(selectedReports[def.kind]) &&
        Boolean(uploads[def.kind]) &&
        !hasPendingChanges &&
        !hasParseError;

      const tileClass = cn(tileBaseClasses, {
        "border-error-border bg-tile-error text-chip-danger-text shadow-error-soft": hasParseError,
        "border-success-border bg-tile-success shadow-success-soft": parsedAndSelected && !hasParseError,
        "border-border bg-surface-muted shadow-surface-md": tileState === "uploaded" && !parsedAndSelected && !hasParseError,
        "border border-dashed border-border bg-tile-pending shadow-none": tileState === "pending" && !hasParseError && !parsedAndSelected,
      });

      const showing = isPublishedReport;
      const wantsShow = isSelected && !showing;
      const chipVariant: ChipVariant = hasParseError
        ? "danger"
        : showing
        ? "success"
        : wantsShow
        ? "info"
        : tileState === "uploaded"
        ? "muted"
        : "muted";
      const chipLabel = hasParseError
        ? "Error"
        : showing
        ? "Showing"
        : wantsShow
        ? "Show"
        : tileState === "uploaded"
        ? "Hidden"
        : "Waiting";

      return (
        <div key={def.kind} className={tileClass}>
          <input
            type="file"
            accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            ref={(el) => {
              replaceInputsRef.current[def.kind] = el;
            }}
            onChange={(e) => {
              void onReplaceInput(def.kind, e.target.files);
            }}
          />
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2">
              <input
                type="checkbox"
                checked={uploaded ? isSelected : false}
                disabled={!uploaded}
                onChange={(e) => toggleSelection(def.kind, e.target.checked)}
                title={uploaded ? `Include ${def.label} report` : "Upload report first"}
                className="h-[18px] w-[18px] accent-accent disabled:cursor-not-allowed"
              />
              <div className="min-w-0 text-[13px] font-bold leading-tight tracking-[0.02em]">{def.label}</div>
            </div>
            <Chip variant={chipVariant} className="mt-[2px] shrink-0">
              {chipLabel}
            </Chip>
          </div>
          <div className="flex flex-1 flex-col gap-1.5 text-[11px]">
            {uploaded ? (
              <>
                <div
                  className={cn("whitespace-pre-wrap break-words", {
                    "text-[#fecaca]": hasParseError,
                    "text-text-primary": !hasParseError,
                  })}
                >
                  {formatReportFilename(uploaded.filename, def.kind)}
                </div>
                {hasParseError && (
                  <div className="text-chip-danger-text">
                    {needsLocatorGuidance ? `${err} Fix the file and parse again or deselect to continue.` : err}
                  </div>
                )}
                {!isSelected && !parsedFlag && (
                  <div className="text-[#fbbf24]">Deselected until re-selected</div>
                )}
              </>
            ) : err ? (
              <div className="text-[#fecaca]">{err}</div>
            ) : (
              <div className="text-chip-default-text">Waiting for upload</div>
            )}
            {(uploaded || err) && (
              <Button
                type="button"
                onClick={() => onReplace(def.kind)}
                variant="soft"
                size="sm"
                className="mt-auto self-start rounded-full px-3 py-1.5 text-[11px]"
              >
                Replace File
              </Button>
            )}
          </div>
        </div>
      );
    });
    return (
      <div className="mt-3 flex flex-col gap-3">
        <div
          className={cn(
            "grid gap-[12px] [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]",
            {
              "rounded-[16px] border-[3px] border-dotted border-accent-blue bg-[rgba(37,99,235,0.07)] p-3": isDragActive,
            },
          )}
        >
          {tiles}
        </div>
      </div>
    );
  };

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const runtimeToken = getApiToken();
  const appendTokenParam = useCallback(
    (url: string | null) => {
      if (!url || !runtimeToken) {
        return url;
      }
      const separator = url.includes("?") ? "&" : "?";
      return `${url}${separator}apiToken=${encodeURIComponent(runtimeToken)}`;
    },
    [runtimeToken],
  );
  const liveMonitorUrl = appendTokenParam(origin ? `${origin}/guest?monitor=1` : "/guest?monitor=1") ?? undefined;
  const stagedPreviewUrl =
    appendTokenParam(
      stagedPreviewSessionId !== null
        ? origin
          ? `${origin}/guest?session=${stagedPreviewSessionId}&preview=1&v=${stagedPreviewVersion}`
          : `/guest?session=${stagedPreviewSessionId}&preview=1&v=${stagedPreviewVersion}`
        : null,
    ) ?? null;
  const hasStagedData = Boolean(stagedPreviewSessionId && stagedPreviewUrl);
  const showStagedPreviewBlock = Boolean(session && hasStagedData);
  const stagedPreviewVisible = showStagedPreviewBlock && !hasShownOnGuest;

  const fallbackFitScale = useMemo(() => {
    const baseScale = FIT_MAX_DIMENSION / Math.max(viewportWidth, viewportHeight);
    return Math.min(baseScale, 1);
  }, [viewportHeight, viewportWidth]);

  const fitScale = useMemo(() => {
    const area = stagedPreviewVisible ? stagedPreviewArea : livePreviewArea;
    const availableWidth = Math.max(0, area.width - FIT_SCALE_MARGIN * 2);
    const availableHeight = Math.max(0, area.height - FIT_SCALE_MARGIN * 2);
    if (availableWidth <= 0 || availableHeight <= 0) {
      return fallbackFitScale;
    }
    const computed = Math.min(availableWidth / viewportWidth, availableHeight / viewportHeight, 1);
    return Number.isFinite(computed) && computed > 0 ? computed : fallbackFitScale;
  }, [fallbackFitScale, livePreviewArea, stagedPreviewArea, stagedPreviewVisible, viewportHeight, viewportWidth]);

  const originalScale = useMemo(() => {
    const area = stagedPreviewVisible ? stagedPreviewArea : livePreviewArea;
    const availableWidth = Math.max(0, area.width - ORIGINAL_WIDTH_BUFFER);
    if (availableWidth <= 0) {
      return DEFAULT_PREVIEW_SCALE;
    }
    const computed = availableWidth / viewportWidth;
    if (!Number.isFinite(computed) || computed <= 0) {
      return DEFAULT_PREVIEW_SCALE;
    }
    return Math.min(DEFAULT_PREVIEW_SCALE, computed);
  }, [livePreviewArea, stagedPreviewArea, stagedPreviewVisible, viewportWidth]);

  const previewScale = fitPreview ? fitScale : originalScale;

  const previewContainerStyle = useMemo<React.CSSProperties>(() => {
    if (fitPreview) {
      const scaledWidth = Math.max(1, Math.floor(viewportWidth * previewScale));
      const scaledHeight = Math.max(1, Math.floor(viewportHeight * previewScale));
      return {
        width: `${scaledWidth}px`,
        minWidth: `${scaledWidth}px`,
        maxWidth: `${scaledWidth}px`,
        height: `${scaledHeight}px`,
        minHeight: `${scaledHeight}px`,
        maxHeight: `${scaledHeight}px`,
      };
    }
    const aspectPercent = (viewportHeight / viewportWidth) * 100;
    return {
      paddingBottom: `${aspectPercent}%`,
      minHeight: `${Math.max(viewportHeight * previewScale, MIN_PREVIEW_HEIGHT)}px`,
    };
  }, [fitPreview, previewScale, viewportHeight, viewportWidth]);

  const scaledFrameStyle = useMemo<React.CSSProperties>(() => ({
    transform: `scale(${previewScale})`,
    transformOrigin: "top left",
    width: `${viewportWidth}px`,
    height: `${viewportHeight}px`,
  }), [previewScale, viewportHeight, viewportWidth]);

  useEffect(() => {
    if (stagedPreviewVisible) return;
    if (typeof ResizeObserver === "undefined") return;
    const node = livePreviewContainerRef.current;
    if (!node) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setLivePreviewArea((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    });
    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, [stagedPreviewVisible]);

  useEffect(() => {
    if (!stagedPreviewVisible) return;
    if (typeof ResizeObserver === "undefined") return;
    const node = stagedPreviewContainerRef.current;
    if (!node) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setStagedPreviewArea((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    });
    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, [stagedPreviewVisible]);

useEffect(() => {
  if (stagedPreviewVisible) return;
  const container = livePreviewContainerRef.current;
  if (!container) return;

  if (fitPreview) {
    container.scrollTo({ left: 0, top: 0, behavior: "auto" });
    return;
  }

  const targetLeft = Math.max(0, (viewportWidth * previewScale - container.clientWidth) / 2);
  const targetTop = Math.max(0, (viewportHeight * previewScale - container.clientHeight) / 2);
  const scroll = () => container.scrollTo({ left: targetLeft, top: targetTop, behavior: "auto" });

  const frame = requestAnimationFrame(scroll);
  const iframe = container.querySelector("iframe");
  iframe?.addEventListener("load", scroll);

  return () => {
    cancelAnimationFrame(frame);
    iframe?.removeEventListener("load", scroll);
  };
}, [previewScale, viewportHeight, viewportWidth, stagedPreviewVisible, fitPreview]);

useEffect(() => {
  if (stagedPreviewVisible) return;
  const container = livePreviewContainerRef.current;
  const content = livePreviewContentRef.current;
  if (!container || !content) return;

  if (fitPreview) {
    container.scrollTo({ left: 0, top: 0, behavior: "auto" });
    return;
  }

  livePreviewUserScrolledRef.current = false;

  const center = (force = false) => {
    if (!force && livePreviewUserScrolledRef.current) return;
    const scaledWidth = viewportWidth * previewScale;
    const scaledHeight = viewportHeight * previewScale;
    const targetLeft = Math.max(0, scaledWidth / 2 - container.clientWidth / 2);
    const targetTop = Math.max(0, scaledHeight / 2 - container.clientHeight / 2);
    container.scrollTo({ left: targetLeft, top: targetTop, behavior: "auto" });
  };

  const schedule = (force = false) => {
    const delays = [0, 120, 320, 640, 1000, 1600];
    delays.forEach((delay) => window.setTimeout(() => center(force), delay));
  };

  schedule(true);

  const iframe = content.querySelector("iframe");
  const handleLoad = () => {
    livePreviewUserScrolledRef.current = false;
    schedule(true);
  };
  iframe?.addEventListener("load", handleLoad);

  const observers: ResizeObserver[] = [];
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => center(false));
    ro.observe(container);
    ro.observe(content);
    observers.push(ro);
  }

  return () => {
    iframe?.removeEventListener("load", handleLoad);
    observers.forEach((ro) => ro.disconnect());
  };
}, [previewScale, fitPreview, liveMonitorUrl, stagedPreviewVisible, viewportHeight, viewportWidth]);

useEffect(() => {
  livePreviewUserScrolledRef.current = false;
}, [fitPreview, previewScale, liveMonitorUrl, stagedPreviewVisible]);

useEffect(() => {
  const unsubscribe = window.longqLicense?.onManageRequest?.(() => {
    setLicenseModalOpen(true);
  });
  return () => {
    if (typeof unsubscribe === "function") {
      unsubscribe();
    }
  };
}, []);

  const diagnosticsModal = diagnosticsOpen ? (
    <div
      className="fixed inset-0 z-[999] flex items-center justify-center bg-black/65 px-4"
      onClick={() => setDiagnosticsOpen(false)}
    >
      <div
        className="w-full max-w-[640px] overflow-hidden rounded-3xl border border-border bg-surface shadow-surface-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border bg-surface-subtle px-6 py-4">
          <div>
            <div className="text-[16px] font-semibold text-text-primary">Diagnostics</div>
            <div className="text-[11px] uppercase tracking-[0.3em] text-accent-info/80">
              Recent backend errors
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="soft"
              className="px-3"
              onClick={() => fetchDiagnostics()}
              disabled={diagnosticsLoading}
            >
              Refresh
            </Button>
            <Button size="sm" variant="secondary" className="px-3" onClick={() => setDiagnosticsOpen(false)}>
              Close
            </Button>
          </div>
        </div>
        <div className="max-h-[60vh] overflow-y-auto px-6 py-4">
          {diagnosticsLoading ? (
            <div className="flex items-center justify-center py-8 text-[13px] text-text-secondary">
              Loading diagnostics…
            </div>
          ) : diagnosticsFetchError ? (
            <div className="rounded-2xl border border-danger/40 bg-danger/10 p-4 text-[13px] text-danger">
              Failed to load diagnostics: {diagnosticsFetchError}
            </div>
          ) : diagnosticsEntries.length === 0 ? (
            <div className="rounded-2xl border border-border bg-surface-subtle px-4 py-6 text-center text-[13px] text-text-secondary">
              No recent errors have been recorded.
            </div>
          ) : (
            <ul className="space-y-3">
              {diagnosticsEntries.map((entry) => (
                <li key={`${entry.code}-${entry.timestamp}`} className="rounded-2xl border border-border bg-surface px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-[11px] uppercase tracking-[0.3em] text-accent-info">
                      {entry.code}
                    </span>
                    <span className="text-[11px] text-text-secondary">
                      {(() => {
                        const d = new Date(entry.timestamp);
                        return Number.isNaN(d.getTime()) ? entry.timestamp : d.toLocaleString();
                      })()}
                    </span>
                  </div>
                  <div className="mt-2 text-[13px] font-semibold text-text-primary">{entry.message}</div>
                  <div className="mt-1 text-[11px] text-text-secondary">
                    {(entry.logger ?? "backend")} · {entry.level}
                    {entry.pathname ? ` · ${entry.pathname}:${entry.lineno ?? 0}` : ""}
                  </div>
                  {entry.detail && (
                    <pre className="mt-3 max-h-40 overflow-auto rounded-lg bg-neutral-dark/40 p-3 text-[11px] text-text-secondary">
                      {entry.detail}
                    </pre>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  ) : null;

  if (!licenseReady) {
    return (
      <>
        <div className="flex min-h-screen items-center justify-center bg-logo-background px-6 text-center text-text-primary">
          <div className="space-y-5 max-w-[520px]">
            {waitingForLicense ? (
              <>
                <div className="flex justify-center">
                  <div
                    className="h-12 w-12 animate-spin rounded-full border-4 border-teal-300 border-t-transparent"
                    aria-hidden="true"
                  />
                </div>
                <div>
                  <div className="text-[18px] font-semibold tracking-[0.16em] text-teal-100 uppercase">
                    Checking License
                  </div>
                  <p className="mt-2 text-[14px] text-slate-200">
                    One moment while we verify the activation status on this device…
                  </p>
                </div>
              </>
            ) : (
              <>
                <div className="text-[20px] font-semibold">Activation Required</div>
                <p className="text-[14px] text-text-secondary">
                  The license file is missing or invalid. Use the Manage License button to refresh or re-import it,
                  then reopen the Operator Console.
                </p>
                <div className="flex justify-center">
                  <Button variant="primary" onClick={() => setLicenseModalOpen(true)}>
                    Manage License
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
        {licenseModal}
      </>
    );
  }

  if (!backendReady) {
    return (
      <>
        <div className="flex min-h-screen items-center justify-center bg-logo-background px-6 text-center text-text-primary">
          <div className="space-y-6">
            <div className="flex justify-center">
              <div
                className="h-12 w-12 animate-spin rounded-full border-4 border-teal-300 border-t-transparent"
                aria-hidden="true"
              />
            </div>
            <div>
              <div className="text-[18px] font-semibold tracking-[0.16em] text-teal-100 uppercase">
                Initializing Console
              </div>
              <p className="mt-2 text-[14px] text-slate-200">Connecting to the Quantum Qi™ backend…</p>
            </div>
          </div>
        </div>
        {diagnosticsModal}
        {licenseModal}
      </>
    );
  }

  if (backendDown) {
    return (
      <>
        <div className="flex min-h-screen items-center justify-center bg-logo-background px-6 text-text-primary">
          <div className="w-full max-w-[560px] space-y-4 text-center">
            <div className="text-[30px] font-bold">Operator Console Offline</div>
            <div className="mt-2 text-[16px] opacity-80">
              The Quantum Qi™ services are no longer reachable. Close this window and restart the program once
              the server is running again.
            </div>
            {error && (
              <div className="mx-auto max-w-[520px] rounded-2xl border border-border bg-surface/90 px-5 py-4 text-left text-[13px] leading-relaxed text-text-secondary">
                <div className="text-[11px] font-semibold uppercase tracking-[0.3em] text-accent-info/80">
                  Last reported error
                </div>
                <div className="mt-2 text-[13px] text-text-primary">{error}</div>
              </div>
            )}
            <div className="flex flex-wrap justify-center gap-3 pt-1">
              <Button variant="secondary" size="sm" className="px-4" onClick={() => setDiagnosticsOpen(true)}>
                View diagnostics
              </Button>
              <Button
                variant="soft"
                size="sm"
                className="px-4"
                onClick={() => {
                  if (typeof window !== "undefined") {
                    window.location.reload();
                  }
                }}
              >
                Reload
              </Button>
            </div>
          </div>
        </div>
        {diagnosticsModal}
        {licenseModal}
      </>
    );
  }

  return (
    <>
      <div
        onDragEnter={handleDragHighlight}
        onDragOver={handleDragHighlight}
        onDragLeave={handleDragLeaveArea}
        onDrop={handleDrop}
        className="flex flex-wrap items-start gap-4 px-3 py-3"
      >
        <div
          className={cn(
            "flex min-w-[320px] max-w-[720px] flex-1 flex-col self-stretch",
            session ? "" : "min-h-[calc(100vh-64px)]",
          )}
        >
          <div className="flex h-full flex-col gap-3">
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-1">
                <h1 className="text-text-primary">
                  <span className="font-logo block text-[28px] font-semibold leading-none">
                    <span className="inline-flex items-baseline">
                      <span>Quantum Qi</span>
                      <span className="logo-tm">TM</span>
                    </span>
                  </span>
                  <span className="mt-1 block text-[18px] font-normal tracking-[0.18em] text-teal-100 uppercase">
                    Operator Console
                  </span>
                </h1>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                {session && (
                  <Button onClick={resetSession} variant="danger" size="sm" className="px-3">
                    Start Over
                  </Button>
                )}
              </div>
            </div>
            {session ? (
              <div className="flex flex-1 flex-col">
                <div className="flex flex-col gap-3 overflow-y-auto px-0">
                  {renderSessionHeader()}
                  {renderUploadAndPublishRow()}
                  {renderReportTiles()}
                </div>
              </div>
            ) : (
              <div className="flex flex-1 flex-col items-center gap-6 py-6">
                <img
                  src="/quantum-qi-logo.png"
                  alt="Quantum Qi™ logo"
                  className="w-44 max-w-[60vw]"
                />
                <div className="w-full max-w-[520px] rounded-3xl border border-border bg-surface/90 p-8 shadow-surface-lg backdrop-blur-sm">
                  <h2 className="text-center text-[22px] font-semibold text-text-primary">Create a New Session</h2>
                  <p className="mt-2 text-center text-[13px] text-text-secondary">
                    Enter the guest name to begin. You can adjust details later if needed.
                  </p>
                  <form
                    className="mt-5 flex flex-col gap-2.5"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const first = formatClientName(firstNameInput);
                  const last = formatClientName(lastNameInput);
                  if (!first || !last) {
                    setError("Enter the guest's first and last name.");
                    setStatus("");
                    return;
                  }
                  if (!sexSelection) {
                    setError("Select the guest's gender.");
                    setStatus("");
                    return;
                  }
                  try {
                    setError("");
                    const full = formatFullName(first, last);
                    setStatus(`Creating session for ${full}…`);
                    const created = await createSession(first, last, sexSelection as Sex);
                    markBackendUp();
                    setSession(created);
                    setSexSelection(created.sex);
                    onSessionReady(created.id);
                    setStagedPreviewSessionId(created.published ? created.id : null);
                    setStagedPreviewVersion((v) => v + 1);
                    setHasShownOnGuest(false);
                    resetUploadState();
                    setFirstNameInput(first);
                    setLastNameInput(last);
                    const createdName = formatFullName(created.first_name, created.last_name);
                    setStatus(createdName ? `Drop the folder for ${createdName}.` : "Ready for the next guest folder.");
                    try {
                      await setDisplaySession({
                        stagedSessionId: created.id,
                        stagedFirstName: created.first_name ?? first,
                        stagedFullName: formatFullName(created.first_name, created.last_name),
                        stagedSex: created.sex,
                      });
                      markBackendUp();
                    } catch (err) {
                      setError(formatErrorMessage(err));
                      markBackendDown(err);
                    }
                  } catch (err) {
                    setError(formatErrorMessage(err));
                    setStatus("Session creation failed.");
                    markBackendDown(err);
                  }
                }}
              >
                <div className="flex flex-col gap-2.5 sm:flex-row">
                  <input
                    className={cn(darkInputClasses, "flex-1 text-[14px]" )}
                    placeholder="First name"
                    value={firstNameInput}
                    onChange={(e) => setFirstNameInput(e.target.value)}
                    autoFocus
                  />
                  <input
                    className={cn(darkInputClasses, "flex-1 text-[14px]")}
                    placeholder="Last name"
                    value={lastNameInput}
                    onChange={(e) => setLastNameInput(e.target.value)}
                  />
                </div>
                <fieldset className="flex flex-wrap items-center gap-3 text-[13px] text-text-secondary">
                  <legend className="sr-only">Gender</legend>
                  <span>Gender:</span>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      name="session-sex-full"
                      value="male"
                      checked={sexSelection === "male"}
                      onChange={() => setSexSelection("male")}
                      className="h-4 w-4 text-accent-info focus:ring-accent-info/40"
                    />
                    Male
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      name="session-sex-full"
                      value="female"
                      checked={sexSelection === "female"}
                      onChange={() => setSexSelection("female")}
                      className="h-4 w-4 text-accent-info focus:ring-accent-info/40"
                    />
                    Female
                  </label>
                </fieldset>
                <Button type="submit" variant="primary" disabled={!firstNameInput.trim() || !lastNameInput.trim() || !sexSelection} className="mt-2">
                  Create Session
                </Button>
              </form>
            </div>
              </div>
            )}

            {session && status && (
              <div className="mt-3 flex flex-col gap-1.5" aria-live="polite">
                <div className="flex items-start gap-2 rounded-xl border border-[#44627a] bg-[#1f2937] px-3 py-2 text-[11px] text-white shadow-sm">
                  <span aria-hidden className="mt-0.5 h-2 w-2 rounded-full bg-[#60a5fa]" />
                  {status}
                </div>
              </div>
            )}
            <div className="mt-auto flex flex-wrap items-center gap-2 text-[11px] text-text-secondary">
              <button
                type="button"
                className="text-accent-info underline-offset-2 hover:underline"
                onClick={() => setDiagnosticsOpen(true)}
              >
                Diagnostics
              </button>
              <span className="text-text-secondary/60">|</span>
              <button
                type="button"
                className="text-accent-info underline-offset-2 hover:underline"
                onClick={() => setLicenseModalOpen(true)}
              >
                Manage License
              </button>
              <span className="text-text-secondary/60">|</span>
              <span className="text-text-secondary/80">Quantum Qi™ Operator — v1</span>
            </div>
          </div>
        </div>

      <div className="sticky top-3 flex min-w-[280px] flex-1 self-stretch">
        <div className="flex h-[calc(100vh-24px)] min-h-[480px] flex-1 flex-col gap-3.5 rounded-2xl border border-[#e5e7eb] bg-white p-3.5 pb-0">
          <div className="flex items-start justify-between gap-2.5">
            <div className="flex flex-1 flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.6px] text-[#4b5563]">
                <span className="flex h-2.5 w-2.5 items-center justify-center">
                  <span className="h-2.5 w-2.5 rounded-full bg-accent" />
                </span>
                <span>Live Monitor</span>
                <span className="text-[#d1d5e0]">|</span>
                <span className="font-medium normal-case text-[11px] text-[#6b7280]">
                  Message Displayed:&nbsp;
                  <span className="text-[#111827]">{liveMonitorMessage}</span>
                </span>
              </div>
              <div className="text-[11px] text-[#6b7280]">
                Mirrors the active guest display.
              </div>
            </div>
            <div className="flex flex-col items-end gap-1 text-right">
              <button
                type="button"
                aria-pressed={fitPreview}
                aria-label={previewToggleLabel}
                title={previewToggleLabel}
                onClick={() => setFitPreview((current) => !current)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.6px] transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0ea5e9]",
                  fitPreview
                    ? "border-[#0ea5e9] bg-[#0ea5e9]/15 text-[#0ea5e9]"
                    : "border-[#d1d5db] bg-white text-[#374151] hover:border-[#0ea5e9] hover:text-[#0ea5e9]",
                )}
              >
                <span
                  className={cn(
                    "flex h-2.5 w-2.5 items-center justify-center rounded-full border",
                    fitPreview ? "border-[#0ea5e9] bg-[#0ea5e9]" : "border-[#9ca3af] bg-transparent",
                  )}
                />
                {fitPreview ? "Original Size" : "Fit to Screen"}
              </button>
              <span className="text-[10px] text-[#6b7280]">
                {fitPreview ? "Full frame preview (scaled to fit)." : "Operator preview scale applied."}
              </span>
            </div>
          </div>
          {!guestWindowOpen && (
            <div className="rounded-lg bg-[#fef2f2] px-2.5 py-2 text-[12px] text-[#b91c1c]">
              Guest window is closed. Use the session header controls to launch it again.
            </div>
          )}
          <div
            className={cn(
              "flex min-h-0 flex-1 flex-col gap-3.5 pr-2",
              fitPreview ? "overflow-hidden" : "overflow-y-auto overflow-x-hidden",
            )}
          >
            <div
              className={cn(
                "rounded-[10px] border border-[#d1d5db] bg-white shadow-inner",
                stagedPreviewVisible ? "p-3" : "flex-1 p-0",
              )}
            >
              {!stagedPreviewVisible ? (
                <div
                  ref={livePreviewContainerRef}
                  onScroll={() => {
                    if (!fitPreview) {
                      livePreviewUserScrolledRef.current = true;
                    }
                  }}
                  className={cn(
                    "relative flex h-full w-full items-start",
                    fitPreview ? "justify-center overflow-hidden" : "justify-start overflow-y-auto overflow-x-hidden",
                  )}
                >
                  <div
                    ref={livePreviewContentRef}
                    className={cn("relative", fitPreview ? "inline-block" : "w-full max-w-full")}
                    style={previewContainerStyle}
                  >
                    <iframe
                      title="Live Guest Monitor"
                      src={liveMonitorUrl}
                      scrolling="no"
                      className="absolute inset-0 border-0"
                      style={scaledFrameStyle}
                    />
                  </div>
                </div>
              ) : (
                <div className="text-[11px] text-[#6b7280]">
                  Live monitor is standing by. Go Live to reveal the staged data.
                </div>
              )}
            </div>
            {showStagedPreviewBlock && stagedPreviewVisible && (
              <div className="flex flex-1 flex-col gap-3 rounded-[10px] border border-[#d1d5db] bg-white p-3 shadow-inner">
                <div className="text-[12px] font-semibold uppercase tracking-[0.6px] text-[#4b5563]">
                  Staged Preview
                </div>
                <div className="text-[11px] text-[#6b7280]">
                  Review the staged data before revealing it to the guest.
                </div>
                <div
                  className={cn(
                    "flex-1 rounded-[8px] border border-[#d1d5db]",
                    fitPreview ? "overflow-hidden" : "overflow-y-auto overflow-x-hidden",
                  )}
                >
                  {stagedPreviewUrl && (
                    <div
                      ref={stagedPreviewContainerRef}
                      className={cn(
                        "relative flex h-full w-full items-start",
                        fitPreview ? "justify-center overflow-hidden" : "justify-start overflow-y-auto overflow-x-hidden",
                      )}
                    >
                      <div
                        className={cn("relative", fitPreview ? "inline-block" : "w-full max-w-full")}
                        style={previewContainerStyle}
                      >
                        <iframe
                          key={`${stagedPreviewSessionId}-${stagedPreviewVersion}`}
                          title="Staged Guest Preview"
                          src={stagedPreviewUrl}
                          scrolling="no"
                          className="absolute inset-0 border-0"
                          style={scaledFrameStyle}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      </div>
        {diagnosticsModal}
        {licenseModal}
      </>
    );
}
