import React, { useEffect, useRef, useState } from "react";
import {
  createSession,
  updateSession,
  uploadPdf,
  parseFile,
  publish,
  setDisplaySession,
  type Session,
  type FileOut,
  type ReportKind,
} from "./api";

const REPORT_DEFS: { kind: ReportKind; label: string; aliases: string[] }[] = [
  { kind: "food", label: "Food", aliases: ["food"] },
  { kind: "heavy-metals", label: "Heavy Metals", aliases: ["heavy metals", "heavy-metals", "heavy_metals"] },
  { kind: "hormones", label: "Hormones", aliases: ["hormones"] },
  { kind: "nutrition", label: "Nutrition", aliases: ["nutrition"] },
  { kind: "toxins", label: "Toxins", aliases: ["toxins"] },
];

type UploadMap = Record<ReportKind, FileOut | null>;
type UploadErrorMap = Record<ReportKind, string | null>;
type DroppedFile = { file: File; relativePath: string; name: string };
type SelectionMap = Record<ReportKind, boolean>;
const PATIENT_HEARTBEAT_KEY = "longevityq_patient_heartbeat";
const PATIENT_HEARTBEAT_GRACE_MS = 8000;
const LOGO_BACKGROUND = "#0f1114";
const AUTO_OPEN_GRACE_MS = 5000;

const palette = {
  surface: "#111827",
  surfaceMuted: "#1b2539",
  border: "rgba(148, 163, 184, 0.25)",
  borderStrong: "rgba(148, 163, 184, 0.45)",
  textPrimary: "#f8fafc",
  textSecondary: "#cbd5f5",
  accent: "#16a34a",
  accentBlue: "#2563eb",
  accentInfo: "#0ea5e9",
  neutralDark: "#1f2937",
  warning: "#f59e0b",
  danger: "#dc2626",
  successSurface: "rgba(34, 197, 94, 0.14)",
  successBorder: "rgba(34, 197, 94, 0.45)",
  errorSurface: "rgba(248, 113, 113, 0.14)",
  errorBorder: "rgba(248, 113, 113, 0.6)",
  infoSurface: "rgba(56, 189, 248, 0.18)",
};

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "info";

const darkInputStyle: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: "8px",
  border: `1px solid ${palette.borderStrong}`,
  background: palette.neutralDark,
  color: palette.textPrimary,
  outline: "none",
  boxShadow: "inset 0 1px 2px rgba(15, 23, 42, 0.45)",
  caretColor: palette.accentInfo,
};

const baseButtonStyle: React.CSSProperties = {
  border: "none",
  borderRadius: 8,
  padding: "8px 14px",
  fontSize: 13,
  fontWeight: 600,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  cursor: "pointer",
  transition: "transform 0.1s ease",
};

function buttonStyles(variant: ButtonVariant, disabled = false): React.CSSProperties {
  const variantStyle: Record<ButtonVariant, React.CSSProperties> = {
    primary: { background: palette.accent, color: "#fff" },
    secondary: { background: palette.neutralDark, color: "#f8fafc" },
    info: { background: palette.accentBlue, color: "#fff" },
    danger: { background: palette.danger, color: "#fff" },
    ghost: {
      background: "transparent",
      color: palette.textPrimary,
      border: `1px solid ${palette.border}`,
      padding: "7px 14px",
    },
  };
  return {
    ...baseButtonStyle,
    ...(variantStyle[variant] ?? {}),
    opacity: disabled ? 0.55 : 1,
    cursor: disabled ? "not-allowed" : "pointer",
  };
}

type ChipVariant = "default" | "success" | "danger" | "info" | "warning" | "muted";

function chipStyles(variant: ChipVariant): React.CSSProperties {
  const base: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 11,
    fontWeight: 600,
    padding: "2px 10px",
    borderRadius: 999,
    letterSpacing: 0.3,
    textTransform: "uppercase",
  };

  const variants: Record<ChipVariant, React.CSSProperties> = {
    default: { background: "rgba(148, 163, 184, 0.18)", color: "#e2e8f0" },
    success: { background: palette.successSurface, color: "#34d399", border: `1px solid ${palette.successBorder}` },
    danger: { background: palette.errorSurface, color: "#fca5a5", border: `1px solid ${palette.errorBorder}` },
    info: { background: palette.infoSurface, color: "#7dd3fc" },
    warning: { background: "rgba(251, 191, 36, 0.18)", color: "#fbbf24" },
    muted: { background: "rgba(209, 213, 219, 0.12)", color: "#cbd5e1" },
  };

  return { ...base, ...(variants[variant] ?? variants.default) };
}

function createEmptyUploadMap(): UploadMap {
  const map = {} as UploadMap;
  for (const def of REPORT_DEFS) {
    map[def.kind] = null;
  }
  return map;
}

function createEmptyErrorMap(): UploadErrorMap {
  const map = {} as UploadErrorMap;
  for (const def of REPORT_DEFS) {
    map[def.kind] = null;
  }
  return map;
}

function createSelectionMap(initial = false): SelectionMap {
  const map = {} as SelectionMap;
  for (const def of REPORT_DEFS) {
    map[def.kind] = initial;
  }
  return map;
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
  const def = REPORT_DEFS.find((d) => d.kind === kind);
  if (def) {
    const lowerBase = base.toLowerCase();
    for (const alias of def.aliases) {
      const idx = lowerBase.lastIndexOf(alias.toLowerCase());
      if (idx !== -1) {
        const aliasEnd = idx + alias.length;
        const before = base.slice(0, aliasEnd);
        const after = base.slice(aliasEnd).replace(/^[\s._-]+/, "");
        const withBreak = after ? `${before}\n${after}` : before;
        const extensionLine = extension ? `${withBreak.endsWith("\n") ? "" : "\n"}${extension}` : "";
        return `${withBreak}${extensionLine}`;
      }
    }
  }
  const cleanedBase = base.replace(/[_-]+/g, " ");
  return extension ? `${cleanedBase}\n${extension}` : cleanedBase;
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
  const [parsedOk, setParsedOk] = useState<boolean>(false);
  const [nutritionParsed, setNutritionParsed] = useState<boolean>(false);
  const [hormonesParsed, setHormonesParsed] = useState<boolean>(false);
  const [heavyMetalsParsed, setHeavyMetalsParsed] = useState<boolean>(false);
  const [toxinsParsed, setToxinsParsed] = useState<boolean>(false);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [isDragActive, setIsDragActive] = useState<boolean>(false);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [isEditingName, setIsEditingName] = useState<boolean>(false);
  const [editedFirstName, setEditedFirstName] = useState<string>("");
  const [editedLastName, setEditedLastName] = useState<string>("");
  const [lastDroppedFiles, setLastDroppedFiles] = useState<DroppedFile[]>([]);
  const [backendDown, setBackendDown] = useState(false);
  const [hasPendingChanges, setHasPendingChanges] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const patientWindowRef = useRef<Window | null>(null);
  const replaceInputsRef = useRef<Record<ReportKind, HTMLInputElement | null>>({} as Record<ReportKind, HTMLInputElement | null>);
  const base = (import.meta.env.VITE_API_BASE ?? "http://localhost:8000") as string;
  const autoOpenAttemptedRef = useRef(false);
  const autoOpenTimerRef = useRef<number | null>(null);

  const readPatientHeartbeat = () => {
    if (typeof window === "undefined") return null;
    try {
      const stored = window.localStorage.getItem(PATIENT_HEARTBEAT_KEY);
      return stored ? Number.parseInt(stored, 10) : null;
    } catch {
      return null;
    }
  };

  const patientHeartbeatAlive = () => {
    const beat = readPatientHeartbeat();
    return beat !== null && !Number.isNaN(beat) && Date.now() - beat < PATIENT_HEARTBEAT_GRACE_MS;
  };

  const markBackendUp = () => setBackendDown(false);
  const markBackendDown = (err?: unknown) => {
    if (err === undefined || isNetworkError(err)) {
      setBackendDown(true);
    }
  };
  const [stagedPreviewSessionId, setStagedPreviewSessionId] = useState<number | null>(null);
  const [stagedPreviewVersion, setStagedPreviewVersion] = useState(0);
  const [hasShownOnPatient, setHasShownOnPatient] = useState(false);
  const [patientWindowOpen, setPatientWindowOpen] = useState<boolean>(() => patientHeartbeatAlive());

  function resetUploadState() {
    setUploads(createEmptyUploadMap());
    setUploadErrors(createEmptyErrorMap());
    setSelectedReports(createSelectionMap(false));
    setParsedOk(false);
    setNutritionParsed(false);
    setHormonesParsed(false);
    setHeavyMetalsParsed(false);
    setToxinsParsed(false);
    setLastDroppedFiles([]);
    setHasPendingChanges(false);
  }

  function resetSession() {
    setSession(null);
    setFirstNameInput("");
    setLastNameInput("");
    resetUploadState();
    setStatus("Ready for the next patient folder.");
    setError("");
    setIsEditingName(false);
    setEditedFirstName("");
    setEditedLastName("");
    setStagedPreviewSessionId(null);
    setStagedPreviewVersion((v) => v + 1);
    setHasShownOnPatient(false);
    setNutritionParsed(false);
    setHormonesParsed(false);
    setHeavyMetalsParsed(false);
    setToxinsParsed(false);
    void (async () => {
      try {
        await setDisplaySession({
          sessionId: null,
          stagedSessionId: null,
          stagedFirstName: null,
          stagedFullName: null,
        });
        markBackendUp();
      } catch (err) {
        setError(formatErrorMessage(err));
        markBackendDown(err);
      }
    })();
  }

  useEffect(() => {
    if (patientWindowOpen) {
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
      if (patientWindowRef.current && !patientWindowRef.current.closed) {
        autoOpenAttemptedRef.current = true;
        return;
      }
      if (!patientHeartbeatAlive()) {
        autoOpenAttemptedRef.current = true;
        openPatientWindow();
      }
    }, AUTO_OPEN_GRACE_MS);

    return () => {
      if (autoOpenTimerRef.current) {
        window.clearTimeout(autoOpenTimerRef.current);
        autoOpenTimerRef.current = null;
      }
    };
  }, [patientWindowOpen]);

  useEffect(() => {
    const computeWindowState = () => {
      let open = false;
      const ref = patientWindowRef.current;
      if (ref && ref.closed) {
        patientWindowRef.current = null;
      } else if (ref && !ref.closed) {
        open = true;
      }
      try {
        const stored = localStorage.getItem(PATIENT_HEARTBEAT_KEY);
        if (stored) {
          const beat = Number.parseInt(stored, 10);
          if (!Number.isNaN(beat) && Date.now() - beat < PATIENT_HEARTBEAT_GRACE_MS) {
            open = true;
          }
        }
      } catch {
        /* ignore storage read errors */
      }
      setPatientWindowOpen(open);
    };

    computeWindowState();
    const monitor = window.setInterval(computeWindowState, 2000);
    const handleStorage = (event: StorageEvent) => {
      if (event.key === PATIENT_HEARTBEAT_KEY) {
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
    const wsUrl = base.replace(/^http/, "ws") + "/ws/operator";
    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let disposed = false;

    const noteState = (down: boolean) => {
      if (!disposed) {
        setBackendDown(down);
      }
    };

    function connect() {
      try {
        ws = new WebSocket(wsUrl);
        ws.onopen = () => noteState(false);
        ws.onmessage = () => {};
        ws.onclose = () => {
          noteState(true);
          reconnectTimer = window.setTimeout(connect, 3000);
        };
        ws.onerror = () => {
          noteState(true);
          try { ws?.close(); } catch {}
        };
      } catch {
        noteState(true);
        reconnectTimer = window.setTimeout(connect, 3000);
      }
    }

    connect();
    return () => {
      disposed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      try { ws?.close(); } catch {}
    };
  }, [base]);

  const handleDragEnterArea = (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    if (!isDragActive) {
      setIsDragActive(true);
    }
  };

  const handleDragOverArea = (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    if (!isDragActive) {
      setIsDragActive(true);
    }
  };

  const handleDragLeaveArea = (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    const target = e.relatedTarget as Node | null;
    if (!target || !(e.currentTarget as Node).contains(target)) {
      setIsDragActive(false);
    }
  };

  function startEditName() {
    if (!session) return;
    const currentFirst = session.first_name ?? (session.client_name?.split(" ", 1)[0] ?? "");
    let currentLast = session.last_name ?? "";
    if (!currentLast && session.client_name) {
      const parts = session.client_name.split(" ");
      if (parts.length > 1) {
        currentLast = parts.slice(1).join(" ");
      }
    }
    setEditedFirstName(formatClientName(currentFirst));
    setEditedLastName(formatClientName(currentLast));
    setIsEditingName(true);
    setStatus("Editing patient name…");
    setError("");
  }

  function cancelEditName() {
    setIsEditingName(false);
    setEditedFirstName("");
    setEditedLastName("");
    if (session) {
      const currentName = formatFullName(session.first_name, session.last_name) || session.client_name;
      setStatus(`Session #${session.id} ready. Drop the folder for ${currentName}.`);
    } else {
      setStatus("");
    }
  }

  async function saveEditName() {
    if (!session) return;
    const first = formatClientName(editedFirstName);
    const last = formatClientName(editedLastName);
    if (!first) {
      setError("Enter the patient's first name.");
      return;
    }
    const currentFirst = session.first_name ?? (session.client_name?.split(" ", 1)[0] ?? "");
    let currentLast = session.last_name ?? "";
    if (!currentLast && session.client_name) {
      const parts = session.client_name.split(" ");
      if (parts.length > 1) {
        currentLast = parts.slice(1).join(" ");
      }
    }
    if (
      normalizeName(first) === normalizeName(currentFirst) &&
      normalizeName(last) === normalizeName(currentLast)
    ) {
      setIsEditingName(false);
      setEditedFirstName("");
      setEditedLastName("");
      setStatus(
        `Session #${session.id} ready. Drop the folder for ${formatFullName(currentFirst, currentLast) || session.client_name}.`
      );
      return;
    }

    const previous = {
      clientName: session.client_name,
      firstName: session.first_name,
      lastName: session.last_name,
    };

    try {
      setStatus("Updating patient name…");
      setError("");
      const provisionalFull = formatFullName(first, last);
      setSession((prev) => (prev ? { ...prev, first_name: first, last_name: last, client_name: provisionalFull } : prev));
      const updated = await updateSession(session.id, { first_name: first, last_name: last });
      markBackendUp();
      setSession(updated);
      setIsEditingName(false);
      setEditedFirstName("");
      setEditedLastName("");
      setStatus(`Patient name updated to ${formatFullName(updated.first_name, updated.last_name)}. Re-drop the folder if needed.`);
      try {
        await setDisplaySession({
          stagedSessionId: updated.id,
          stagedFirstName: updated.first_name ?? first,
          stagedFullName: formatFullName(updated.first_name, updated.last_name),
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
          }
          : prev
      );
      setError(formatErrorMessage(e));
      setStatus("Failed to update patient name.");
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
        ? `${label} report will be included in the patient display.`
        : `${label} report hidden from the patient display until re-selected.`,
    );
  }

  async function processDroppedFiles(dropped: DroppedFile[]) {
    if (!dropped.length) {
      setStatus("No files detected. Drop a folder that contains the patient PDFs.");
      return;
    }
    setLastDroppedFiles(dropped);

    if (!session) {
      setStatus("Create a session first, then drop the patient folder.");
      setError("No active session.");
      return;
    }

    setError("");
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
          setStatus(`Folder “${rootName}” doesn’t match ${sessionReference}. Proceeding anyway.`);
        }
      }
    }

    const pdfs = dropped.filter(({ name }) => name.toLowerCase().endsWith(".pdf"));
    if (!pdfs.length) {
      setStatus("No PDF files found inside the folder.");
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

    setIsUploading(true);
    try {
      for (const entry of pdfs) {
        if (isNestedEntry(entry)) {
          continue;
        }
        const kind = detectReportKind(entry.name);
        if (!kind) {
          continue;
        }

    if (kind === "food") {
      setParsedOk(false);
    } else if (kind === "nutrition") {
      setNutritionParsed(false);
    } else if (kind === "hormones") {
      setHormonesParsed(false);
    } else if (kind === "heavy-metals") {
      setHeavyMetalsParsed(false);
    } else if (kind === "toxins") {
      setToxinsParsed(false);
    }
        setUploadErrors((prev) => ({ ...prev, [kind]: null }));

        try {
          setStatus(`Uploading "${entry.name}"…`);
          const uploaded = await uploadPdf(session.id, kind, entry.file);
          setUploads((prev) => ({ ...prev, [kind]: uploaded }));
          setSelectedReports((prev) => ({ ...prev, [kind]: true }));
          setUploadErrors((prev) => ({ ...prev, [kind]: null }));
          markBackendUp();
          setHasPendingChanges(true);
        if (kind === "nutrition") {
          setNutritionParsed(false);
        } else if (kind === "hormones") {
          setHormonesParsed(false);
        } else if (kind === "heavy-metals") {
          setHeavyMetalsParsed(false);
        } else if (kind === "toxins") {
          setToxinsParsed(false);
        }
          uploadedAny = true;
          setStatus(
            kind === "food"
              ? `Uploaded "${uploaded.filename}". Ready to parse.`
              : `Stored "${uploaded.filename}".`,
          );
        } catch (e: any) {
          const message = formatErrorMessage(e);
          setUploadErrors((prev) => ({ ...prev, [kind]: message }));
          setError(message);
          setStatus(`Upload failed for "${entry.name}".`);
          markBackendDown(e);
        }
      }
    } finally {
      setIsUploading(false);
    }

    if (uploadedAny) {
      setStatus((prev) => prev || "Uploads complete.");
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
    if (!session) {
      setStatus("Create a session before uploading reports.");
      setError("No active session.");
      return;
    }
    setIsUploading(true);
    try {
      setError("");
      if (kind === "food") {
        setParsedOk(false);
      } else if (kind === "nutrition") {
        setNutritionParsed(false);
      } else if (kind === "hormones") {
        setHormonesParsed(false);
      } else if (kind === "heavy-metals") {
        setHeavyMetalsParsed(false);
      }
      setUploadErrors((prev) => ({ ...prev, [kind]: null }));
      setStatus(`Uploading "${file.name}"…`);
      const uploaded = await uploadPdf(session.id, kind, file);
      setUploads((prev) => ({ ...prev, [kind]: uploaded }));
      setSelectedReports((prev) => ({ ...prev, [kind]: true }));
      setUploadErrors((prev) => ({ ...prev, [kind]: null }));
      markBackendUp();
      setHasPendingChanges(true);
      setStatus(
        kind === "food"
          ? `Uploaded "${uploaded.filename}". Ready to parse.`
          : `Stored "${uploaded.filename}".`,
      );
    } catch (e: any) {
      const message = formatErrorMessage(e);
      setUploadErrors((prev) => ({ ...prev, [kind]: message }));
      setError(message);
      setStatus(`Upload failed for "${file.name}".`);
      markBackendDown(e);
    } finally {
      setIsUploading(false);
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
    if (kind === "nutrition") {
      setNutritionParsed(false);
    } else if (kind === "hormones") {
      setHormonesParsed(false);
    } else if (kind === "heavy-metals") {
      setHeavyMetalsParsed(false);
    } else if (kind === "toxins") {
      setToxinsParsed(false);
    }
  }

  function openPatientWindow() {
    const patientUrl = `${window.location.origin}/patient`;
    const windowName = "longevityq_patient_screen";
    let target = patientWindowRef.current && !patientWindowRef.current.closed ? patientWindowRef.current : null;
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
          target.location.href = patientUrl;
        } else if (!target.location.href.includes("/patient")) {
          target.location.href = patientUrl;
        }
      } catch {
        target.location.href = patientUrl;
      }
      try {
        target.focus();
      } catch {
        /* focus errors can be ignored */
      }
      patientWindowRef.current = target;
      setPatientWindowOpen(true);
      setStatus("Patient window opened.");
      setError("");
      return;
    }

    const features = "noopener=yes,noreferrer=yes,width=1280,height=720,resizable=yes,scrollbars=yes";
    const opened = window.open(patientUrl, windowName, features);
    if (opened) {
      patientWindowRef.current = opened;
      try {
        opened.focus();
      } catch {
        /* ignore focus errors */
      }
      setPatientWindowOpen(true);
      setStatus("Patient window opened.");
      setError("");
    } else {
      setPatientWindowOpen(false);
      setError("Unable to open patient screen. Allow pop-ups for this site.");
    }
  }

  async function parseReport(kind: ReportKind, file: FileOut, statusMessage: string): Promise<boolean> {
    try {
      setError("");
      setUploadErrors((prev) => ({ ...prev, [kind]: null }));
      setStatus(statusMessage);
      await parseFile(file.id);
      if (kind === "food") {
        setParsedOk(true);
        setStatus("Food report parsed. Ready to publish.");
      } else if (kind === "nutrition") {
        setNutritionParsed(true);
        setStatus("Nutrition report parsed.");
      } else if (kind === "hormones") {
        setHormonesParsed(true);
        setStatus("Hormones report parsed.");
      } else if (kind === "heavy-metals") {
        setHeavyMetalsParsed(true);
        setStatus("Heavy metals report parsed.");
      } else if (kind === "toxins") {
        setToxinsParsed(true);
        setStatus("Toxins report parsed.");
      }
      markBackendUp();
      return true;
    } catch (e: any) {
      const message = formatErrorMessage(e);
      setError(message);
      setUploadErrors((prev) => ({ ...prev, [kind]: message }));
      if (kind === "food") {
        setParsedOk(false);
        setStatus("Parsing food report failed.");
      } else if (kind === "nutrition") {
        setNutritionParsed(false);
        setStatus("Parsing nutrition report failed.");
      } else if (kind === "hormones") {
        setHormonesParsed(false);
        setStatus("Parsing hormones report failed.");
      } else if (kind === "heavy-metals") {
        setHeavyMetalsParsed(false);
        setStatus("Parsing heavy metals report failed.");
      } else if (kind === "toxins") {
        setToxinsParsed(false);
        setStatus("Parsing toxins report failed.");
      }
      markBackendDown(e);
      return false;
    }
  }

  async function parseSelectedReports(): Promise<boolean> {
    if (!session) return false;
    if (isUploading) {
      setStatus("Upload in progress. Please wait until uploads finish before publishing.");
      return false;
    }

    const foodFile = uploads["food"];
    if (!foodFile) {
      setError("Upload the Food report before publishing.");
      setStatus("Food report missing. Upload the Food PDF to continue.");
      return false;
    }

    if (!selectedReports["food"]) {
      setError("Select the Food report before publishing.");
      setStatus("Select the Food report to include it in the patient results.");
      return false;
    }

    let success = true;
    const targets: Array<{ kind: ReportKind; label: string; file: FileOut | null }> = [
      { kind: "food", label: "food", file: foodFile },
      { kind: "nutrition", label: "nutrition", file: uploads["nutrition"] },
      { kind: "hormones", label: "hormones", file: uploads["hormones"] },
      { kind: "heavy-metals", label: "heavy metals", file: uploads["heavy-metals"] },
      { kind: "toxins", label: "toxins", file: uploads["toxins"] },
    ];

    for (const target of targets) {
      const shouldParse =
        target.kind === "food" || (target.file && selectedReports[target.kind]);
      if (!shouldParse || !target.file) continue;

      const alreadyParsed =
        target.kind === "food"
          ? parsedOk
          : target.kind === "nutrition"
          ? nutritionParsed
          : target.kind === "hormones"
          ? hormonesParsed
          : target.kind === "heavy-metals"
          ? heavyMetalsParsed
          : target.kind === "toxins"
          ? toxinsParsed
          : false;

      if (alreadyParsed) {
        continue;
      }

      if (target.kind === "food") {
        setParsedOk(false);
      } else if (target.kind === "nutrition") {
        setNutritionParsed(false);
      } else if (target.kind === "hormones") {
        setHormonesParsed(false);
      } else if (target.kind === "heavy-metals") {
        setHeavyMetalsParsed(false);
      } else if (target.kind === "toxins") {
        setToxinsParsed(false);
      }

      const ok = await parseReport(
        target.kind,
        target.file,
        `Parsing ${target.label} report…`,
      );
      if (!ok) {
        success = false;
        break;
      }
    }

    if (success) {
      setStatus("Reports parsed successfully.");
    }

    return success;
  }

  async function onPublish() {
    if (!session) return;
    if (session.published && !hasPendingChanges) {
      setStatus("No changes to publish.");
      return;
    }
    setError("");
    const parsed = await parseSelectedReports();
    if (!parsed) {
      return;
    }
    try {
      setStatus(session.published ? "Updating live session…" : "Publishing…");
      const sessionId = session.id;
      const result = await publish(sessionId, true, selectedReports);
      localStorage.setItem(
        "longevityq_publish",
        JSON.stringify({ sessionId, ts: Date.now() }),
      );
      setSession((prev) => (prev ? { ...prev, published: result.published } : prev));
      setStagedPreviewSessionId(sessionId);
      setStagedPreviewVersion((v) => v + 1);
      setHasShownOnPatient(false);
      markBackendUp();
      setStatus("Session is live. Staged preview refreshed below.");
      setHasPendingChanges(false);
    } catch (e: any) {
      setError(formatErrorMessage(e));
      setStatus("Publishing failed.");
      markBackendDown(e);
    }
  }

  async function showOnPatient() {
    if (!session) return;
    try {
      await setDisplaySession({ sessionId: session.id });
      markBackendUp();
      localStorage.setItem(
        "longevityq_publish",
        JSON.stringify({ sessionId: session.id, ts: Date.now() }),
      );
      setStatus("Bound current session to patient screen.");
      setHasShownOnPatient(true);
    } catch (e: any) {
      setError(formatErrorMessage(e));
      setStatus("Failed to bind patient screen.");
      markBackendDown(e);
    }
  }

  async function clearPatient() {
    try {
      await setDisplaySession({ sessionId: null });
      markBackendUp();
      localStorage.setItem(
        "longevityq_publish",
        JSON.stringify({ sessionId: 0, ts: Date.now() }),
      );
      setStatus("Cleared patient screen.");
      setHasShownOnPatient(false);
    } catch (e: any) {
      setError(formatErrorMessage(e));
      setStatus("Failed to clear patient screen.");
      markBackendDown(e);
    }
  }

  const patientButtonLabel = !patientWindowOpen
    ? "Open Patient Window"
    : hasShownOnPatient
    ? "Hide"
    : "Go Live";

  const patientButtonDisabled =
    patientWindowOpen && !hasShownOnPatient && !(session?.published ?? false);

  const patientButtonStyle = !patientWindowOpen
    ? buttonStyles("info", patientButtonDisabled)
    : hasShownOnPatient
    ? buttonStyles("secondary", patientButtonDisabled)
    : buttonStyles("primary", patientButtonDisabled);

  const handlePatientButtonClick = () => {
    if (!patientWindowOpen) {
      openPatientWindow();
      return;
    }
    if (!hasShownOnPatient) {
      void showOnPatient();
    } else {
      void clearPatient();
    }
  };

  const hasFoodUpload = Boolean(uploads["food"]);
  const hasNutritionUpload = Boolean(uploads["nutrition"]);
  const hasHormoneUpload = Boolean(uploads["hormones"]);
  const hasHeavyMetalsUpload = Boolean(uploads["heavy-metals"]);
  const hasToxinsUpload = Boolean(uploads["toxins"]);

  const renderSessionHeader = () => {
    if (!session) return null;
    const displayName = formatFullName(session.first_name, session.last_name) || session.client_name;

    return (
      <div
        style={{
          marginTop: "12px",
          display: "flex",
          flexWrap: "wrap",
          gap: "16px",
          alignItems: "stretch",
        }}
      >
        <div
          style={{
            flex: "1 1 0",
            minWidth: "320px",
            padding: "16px",
            borderRadius: "12px",
            background: palette.surface,
            color: palette.textPrimary,
            border: `1px solid ${palette.border}`,
            boxShadow: "0 12px 32px rgba(0,0,0,0.24)",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {isEditingName ? (
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
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
                  style={{ ...darkInputStyle, minWidth: 160 }}
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
                  style={{ ...darkInputStyle, minWidth: 160 }}
                />
                <button
                  type="button"
                  onClick={saveEditName}
                  style={{ ...buttonStyles("primary"), width: 34, height: 34, padding: 0 }}
                  title="Save name"
                >
                  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                    <path d="M5 10.5l3 3 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={cancelEditName}
                  style={{ ...buttonStyles("danger"), width: 34, height: 34, padding: 0 }}
                  title="Cancel"
                >
                  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                    <path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                <div style={{ fontSize: "16px", fontWeight: 600 }}>{displayName}</div>
                <button
                  type="button"
                  onClick={startEditName}
                  style={{
                    ...buttonStyles("ghost"),
                    width: 32,
                    height: 32,
                    borderRadius: "999px",
                    padding: 0,
                  }}
                  title="Edit patient name"
                >
                  <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                    <path
                      d="M4 13.5v2.5h2.5L15.1 7.4l-2.5-2.5L4 13.5zM16.6 5.9a1 1 0 000-1.4l-1.1-1.1a1 1 0 00-1.4 0l-1.2 1.2 2.5 2.5 1.2-1.2z"
                      fill="currentColor"
                    />
                  </svg>
                </button>
              </div>
            )}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
              <span style={chipStyles(session.published ? "success" : "muted")}>
                {session.published ? "Published" : "Not Published"}
              </span>
              {hasShownOnPatient && patientWindowOpen && (
                <span style={chipStyles("info")}>Visible on Patient</span>
              )}
            </div>
          </div>
        </div>
        <div
          style={{
            flex: "0 0 220px",
            minWidth: "220px",
            padding: "16px",
            borderRadius: "12px",
            background: palette.surface,
            color: palette.textPrimary,
            border: `1px solid ${palette.border}`,
            boxShadow: "0 12px 32px rgba(0,0,0,0.2)",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            gap: "12px",
          }}
        >
          <div>
            <div style={{ fontSize: "13px", fontWeight: 600, letterSpacing: 0.3, textTransform: "uppercase", color: palette.textSecondary }}>
              Patient Screen
            </div>
            <div style={{ fontSize: 12, color: "#cbd5f5", marginTop: "6px" }}>
              {hasShownOnPatient
                ? "Currently showing this session."
                : patientWindowOpen
                ? "Ready to reveal on the patient screen."
                : "Patient window not open."}
            </div>
          </div>
          <div style={{ fontSize: 11, color: "#9ca3c9" }}>
            Status: {patientWindowOpen ? "Connected" : "Closed"}
            {patientWindowOpen && !hasShownOnPatient ? " • standing by" : ""}
          </div>
          <button
            onClick={patientButtonDisabled ? undefined : handlePatientButtonClick}
            disabled={patientButtonDisabled}
            style={{ ...patientButtonStyle, width: "100%" }}
          >
            {patientButtonLabel}
          </button>
        </div>
      </div>
    );
  };

  const renderCreateForm = () => (
    <form
      style={{ marginTop: "12px", display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}
      onSubmit={async (e) => {
        e.preventDefault();
        const first = formatClientName(firstNameInput);
        const last = formatClientName(lastNameInput);
        if (!first) {
          setError("Enter the patient's first name.");
          setStatus("");
          return;
        }
        try {
          setError("");
          const full = formatFullName(first, last);
          setStatus(`Creating session for ${full}…`);
          const created = await createSession(first, last);
          markBackendUp();
          setSession(created);
          onSessionReady(created.id);
          setStagedPreviewSessionId(created.published ? created.id : null);
          setStagedPreviewVersion((v) => v + 1);
          setHasShownOnPatient(false);
          resetUploadState();
          setFirstNameInput(first);
          setLastNameInput(last);
          setStatus(`Session #${created.id} ready. Drop the folder for ${formatFullName(created.first_name, created.last_name)}.`);
      try {
        await setDisplaySession({
          stagedSessionId: created.id,
          stagedFirstName: created.first_name ?? first,
          stagedFullName: formatFullName(created.first_name, created.last_name),
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
        style={{ ...darkInputStyle, minWidth: 180 }}
        placeholder="First name"
        value={firstNameInput}
        onChange={(e) => setFirstNameInput(e.target.value)}
      />
      <input
        style={{ ...darkInputStyle, minWidth: 180 }}
        placeholder="Last name (optional)"
        value={lastNameInput}
        onChange={(e) => setLastNameInput(e.target.value)}
      />
      <button
        type="submit"
        style={buttonStyles("primary", !firstNameInput.trim())}
        disabled={!firstNameInput.trim()}
      >
        Create Session
      </button>
    </form>
  );

  const renderDropZone = () => (
    <div
      onDragEnter={handleDragEnterArea}
      onDragOver={handleDragOverArea}
      onDragLeave={handleDragLeaveArea}
      onDrop={handleDrop}
      style={{
        marginTop: "16px",
        padding: "12px 16px",
        borderRadius: "12px",
        background: isDragActive ? "#ebf3ff" : "#f9fafb",
        border: isDragActive ? "3px dotted #2563eb" : "1px dotted #cbd5f5",
        display: "flex",
        alignItems: "center",
        gap: "12px",
        flexWrap: "wrap",
        transition: "border 120ms ease, background 120ms ease",
      }}
    >
      <button
        type="button"
        onClick={onBrowse}
        style={{ ...buttonStyles("primary"), padding: "8px 18px" }}
      >
        Upload
      </button>
      <div style={{ fontSize: "12px", color: "#4b5563" }}>
        Upload files, or drag and drop files or folders anywhere on this screen.
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        multiple
        style={{ display: "none" }}
        onChange={onFileInput}
      />
    </div>
  );

  const renderReportTiles = () => {
    if (!session) return null;
    const basePublishDisabled = !hasFoodUpload || !selectedReports["food"];
    const publishLocked = session.published && !hasPendingChanges;
    const disablePublish = basePublishDisabled || isUploading || publishLocked;
    const publishLabel = session.published ? (hasPendingChanges ? "Update" : "Published") : "Publish";
    const publishButtonStyle = buttonStyles(publishLocked ? "secondary" : "primary", disablePublish);
    const publishStatusText = session.published
      ? publishLocked
        ? "Published and up to date."
        : "Published. Update to reflect recent changes."
      : "Not yet published.";

    return (
      <div style={{ marginTop: "16px", display: "flex", flexDirection: "column", gap: "16px" }}>
        <div
          style={{
            display: "grid",
            gap: "14px",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            boxSizing: "border-box",
            ...(isDragActive
              ? {
                  border: "4px dotted rgba(37, 99, 235, 0.45)",
                  borderRadius: "18px",
                  padding: "16px",
                  background: "rgba(37, 99, 235, 0.08)",
                }
              : {}),
          }}
        >
        {[...REPORT_DEFS.map((def) => {
          const uploaded = uploads[def.kind];
          const err = uploadErrors[def.kind];
          const isSelected = selectedReports[def.kind];
          const tileState: "pending" | "uploaded" | "error" = uploaded && !err ? "uploaded" : err ? "error" : "pending";
          const parsedFlag =
            def.kind === "food"
              ? parsedOk
              : def.kind === "nutrition"
              ? nutritionParsed
              : def.kind === "hormones"
              ? hormonesParsed
              : def.kind === "heavy-metals"
              ? heavyMetalsParsed
              : def.kind === "toxins"
              ? toxinsParsed
              : false;
          const isParsed = Boolean(parsedFlag && isSelected);
          const hasParseError = Boolean(err && uploaded);
          const needsLocatorGuidance =
            def.kind === "food" &&
            hasParseError &&
            typeof err === "string" &&
            err.toLowerCase().includes("unable to locate any food report categories");

          const tileVisual =
            hasParseError
              ? {
                  background: "#2a1218",
                  border: `1px solid ${palette.errorBorder}`,
                  boxShadow: "0 14px 34px rgba(248,113,113,0.16)",
                }
              : isParsed
              ? {
                  background: "rgba(15, 118, 110, 0.18)",
                  border: `1px solid ${palette.successBorder}`,
                  boxShadow: "0 14px 34px rgba(13,148,136,0.18)",
                }
              : tileState === "uploaded"
              ? {
                  background: palette.surfaceMuted,
                  border: `1px solid ${palette.border}`,
                  boxShadow: "0 12px 28px rgba(0,0,0,0.18)",
                }
              : {
                  background: "rgba(30, 41, 59, 0.35)",
                  border: `1px dashed ${palette.border}`,
                  boxShadow: "none",
                };

          const chipVariant: ChipVariant = hasParseError
            ? "danger"
            : isParsed
            ? "success"
            : tileState === "uploaded"
            ? isSelected
              ? "info"
              : "muted"
            : "muted";
          const chipLabel = hasParseError
            ? "Error"
            : isParsed
            ? "Parsed"
            : tileState === "uploaded"
            ? isSelected
              ? "Ready"
              : "Uploaded"
            : "Waiting";

          return (
            <div
              key={def.kind}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "12px",
                padding: "18px",
                borderRadius: "14px",
                color: palette.textPrimary,
                minWidth: 0,
                transition: "background 0.18s ease, border 0.18s ease",
                ...tileVisual,
              }}
            >
              <input
                type="file"
                accept="application/pdf"
                style={{ display: "none" }}
                ref={(el) => {
                  replaceInputsRef.current[def.kind] = el;
                }}
                onChange={(e) => {
                  void onReplaceInput(def.kind, e.target.files);
                }}
              />
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "12px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <input
                    type="checkbox"
                    checked={uploaded ? isSelected : false}
                    disabled={!uploaded}
                    onChange={(e) => toggleSelection(def.kind, e.target.checked)}
                    title={uploaded ? `Include ${def.label} report` : "Upload report first"}
                    style={{
                      width: 18,
                      height: 18,
                      accentColor: palette.accent,
                      cursor: uploaded ? "pointer" : "not-allowed",
                    }}
                  />
                  <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 0.2 }}>{def.label}</div>
                </div>
                <span style={chipStyles(chipVariant)}>{chipLabel}</span>
              </div>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "6px" }}>
                {uploaded ? (
                  <>
                    <div
                      style={{
                        fontSize: 11,
                        color: hasParseError ? "#fecaca" : "#f8fafc",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      {formatReportFilename(uploaded.filename, def.kind)}
                    </div>
                    {hasParseError && (
                      <div style={{ fontSize: 11, color: "#fca5a5" }}>
                        {needsLocatorGuidance
                          ? `${err} Fix the file and parse again or deselect to continue.`
                          : err}
                      </div>
                    )}
                    {!isSelected && (
                      <div
                        style={{
                          fontSize: 11,
                          color: parsedFlag ? "#60a5fa" : "#fbbf24",
                        }}
                      >
                        {parsedFlag ? "Hidden from patient view" : "Deselected until re-selected"}
                      </div>
                    )}
                  </>
                ) : err ? (
                  <div style={{ fontSize: 11, color: "#fecaca" }}>{err}</div>
                ) : (
                  <div style={{ fontSize: 11, color: "#e2e8f0" }}>Waiting for upload</div>
                )}
                {(uploaded || err) && (
                  <button
                    type="button"
                    onClick={() => onReplace(def.kind)}
                    style={{
                      ...buttonStyles("ghost"),
                      fontSize: 11,
                      padding: "6px 10px",
                      alignSelf: "flex-start",
                    }}
                  >
                    Replace PDF
                  </button>
                )}
              </div>
            </div>
          );
        }),
        <div
          key="publish-tile"
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            gap: "12px",
            padding: "20px",
            borderRadius: "14px",
            color: palette.textPrimary,
            background: palette.surface,
            border: `1px solid ${palette.border}`,
            boxShadow: "0 12px 28px rgba(0,0,0,0.18)",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Publish Session</div>
            <div style={{ fontSize: 12, color: palette.textSecondary, lineHeight: 1.45 }}>
              Finalize the selected reports to update the patient view. Food must be included.
            </div>
            <div style={{ fontSize: 12, color: palette.textSecondary }}>{publishStatusText}</div>
          </div>
          <button onClick={onPublish} disabled={disablePublish} style={{ ...publishButtonStyle, width: "100%" }}>
            {publishLabel}
          </button>
        </div>]}
        </div>
      </div>
    );
  };

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const liveMonitorUrl = origin ? `${origin}/patient?monitor=1` : "/patient?monitor=1";
  const stagedPreviewUrl =
    stagedPreviewSessionId !== null
      ? origin
        ? `${origin}/patient?session=${stagedPreviewSessionId}&preview=1&v=${stagedPreviewVersion}`
        : `/patient?session=${stagedPreviewSessionId}&preview=1&v=${stagedPreviewVersion}`
      : null;

  if (backendDown) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: LOGO_BACKGROUND,
          color: "#f8fafc",
          fontFamily: "Inter,system-ui",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: 24,
        }}
      >
        <div>
          <div style={{ fontSize: 30, fontWeight: 700, marginTop: 16 }}>Operator Console Offline</div>
          <div style={{ fontSize: 16, opacity: 0.8, marginTop: 10 }}>
            The Quantum Qi services are no longer reachable. Close this window and restart the program once
            the server is running again.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      onDragEnter={handleDragEnterArea}
      onDragOver={handleDragOverArea}
      onDragLeave={handleDragLeaveArea}
      onDrop={handleDrop}
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "24px",
        padding: "16px",
        alignItems: "flex-start",
      }}
    >
      <div style={{ flex: "1 1 520px", maxWidth: "760px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <h1 style={{ fontSize: "20px", fontWeight: 700, margin: 0 }}>Operator Console</h1>
            <div style={{ fontSize: "13px", color: "#4b5563" }}>
              Drag & drop the patient folder (named with first and last name) to automatically ingest reports.
              Filenames must include the patient name and the report type.
            </div>
          </div>
          {session && (
            <button onClick={resetSession} style={buttonStyles("ghost")}>
              Start Over
            </button>
          )}
        </div>

        {session ? renderSessionHeader() : renderCreateForm()}

        {session && renderDropZone()}
        {session && renderReportTiles()}
        {session && (status || error) && (
          <div style={{ marginTop: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
            {status && (
              <div
                style={{
                  background: "rgba(37, 99, 235, 0.08)",
                  border: "1px solid rgba(37, 99, 235, 0.18)",
                  color: "#1d4ed8",
                  padding: "10px 14px",
                  borderRadius: "10px",
                  fontSize: "12px",
                }}
              >
                {status}
              </div>
            )}
            {error && (
              <div
                style={{
                  background: "rgba(220, 38, 38, 0.08)",
                  border: "1px solid rgba(220, 38, 38, 0.24)",
                  color: "#b91c1c",
                  padding: "10px 14px",
                  borderRadius: "10px",
                  fontSize: "12px",
                }}
              >
                Error: {error}
              </div>
            )}
          </div>
        )}
      </div>

      <div
        style={{
          flex: "1 1 320px",
          minWidth: "300px",
          position: "sticky",
          top: "16px",
          alignSelf: "stretch",
        }}
      >
        <div
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: "12px",
            background: "#fff",
            padding: "16px",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
            height: "calc(100vh - 32px)",
            minHeight: "520px",
          }}
        >
          <div>
            <div
              style={{
                fontSize: "12px",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: 0.6,
                color: "#4b5563",
              }}
            >
              Live Monitor
            </div>
            <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "4px" }}>
              Mirrors the active patient display.
            </div>
          </div>
          {!patientWindowOpen && (
            <div
              style={{
                fontSize: "12px",
                color: "#b91c1c",
                background: "#fef2f2",
                borderRadius: "8px",
                padding: "8px 10px",
              }}
            >
              Patient window is closed. Use the session header controls to launch it again.
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: "14px", flex: 1, minHeight: 0 }}>
            <iframe
              title="Live Patient Monitor"
              src={liveMonitorUrl}
              style={{
                width: "100%",
                flex: "1 1 0",
                minHeight: 0,
                border: "1px solid #d1d5db",
                borderRadius: "10px",
              }}
            />
            <div style={{ height: "1px", background: "#e5e7eb" }} />
            <div>
              <div
                style={{
                  fontSize: "12px",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: 0.6,
                  color: "#4b5563",
                }}
              >
                Staged Preview
              </div>
              <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "4px" }}>
                {stagedPreviewSessionId
                  ? hasShownOnPatient
                    ? "Live monitor is already showing this data."
                    : "Review the staged data before revealing it to the patient."
                  : "Publish to activate the staged preview."}
              </div>
            </div>
            {stagedPreviewSessionId && stagedPreviewUrl ? (
              <iframe
                key={`${stagedPreviewSessionId}-${stagedPreviewVersion}`}
                title="Staged Patient Preview"
                src={stagedPreviewUrl}
                style={{
                  width: "100%",
                  flex: "1 1 0",
                  minHeight: 0,
                  border: "1px solid #d1d5db",
                  borderRadius: "10px",
                }}
              />
            ) : (
              <div
                style={{
                  flex: "1 1 0",
                  minHeight: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "16px",
                  borderRadius: "10px",
                  border: "1px dashed #d1d5db",
                  fontSize: "12px",
                  color: "#6b7280",
                  textAlign: "center",
                }}
              >
                Publish to generate a staging preview.
              </div>
            )}
          </div>
          {session && (
            <div style={{ fontSize: "12px", color: "#4b5563", marginTop: "4px" }}>
              {formatFullName(session.first_name, session.last_name) || session.client_name}
              {session.published ? <span style={{ marginLeft: 6, color: "#16a34a" }}>• Live</span> : <span style={{ marginLeft: 6 }}>• Not Live</span>}
              {parsedOk && <span style={{ marginLeft: 6, color: "#16a34a" }}>• Food Parsed ✓</span>}
              {nutritionParsed && <span style={{ marginLeft: 6, color: "#16a34a" }}>• Nutrition Parsed ✓</span>}
              {hormonesParsed && <span style={{ marginLeft: 6, color: "#16a34a" }}>• Hormones Parsed ✓</span>}
              {heavyMetalsParsed && <span style={{ marginLeft: 6, color: "#16a34a" }}>• Heavy Metals Parsed ✓</span>}
              {toxinsParsed && <span style={{ marginLeft: 6, color: "#16a34a" }}>• Toxins Parsed ✓</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
