import React, { useEffect, useRef, useState } from "react";
import { Button } from "./ui/Button";
import { Chip } from "./ui/Chip";
import { cn } from "./ui/cn";
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

const LABEL: Record<ReportKind, string> = {
  food: "food",
  "heavy-metals": "heavy metals",
  hormones: "hormones",
  nutrition: "nutrition",
  toxins: "toxins",
};

type UploadMap = Record<ReportKind, FileOut | null>;
type UploadErrorMap = Record<ReportKind, string | null>;
type DroppedFile = { file: File; relativePath: string; name: string };
type SelectionMap = Record<ReportKind, boolean>;
type ParsedMap = Record<ReportKind, boolean>;
const GUEST_HEARTBEAT_KEY = "longevityq_guest_heartbeat";
const GUEST_HEARTBEAT_GRACE_MS = 8000;
const AUTO_OPEN_GRACE_MS = 5000;
const PREVIEW_SCALE = 0.55;
const PREVIEW_WIDTH = 5120;
const PREVIEW_HEIGHT = 1440;
const PREVIEW_ASPECT = (PREVIEW_HEIGHT / PREVIEW_WIDTH) * 100;
const scaledFrameStyle: React.CSSProperties = {
  transform: `scale(${PREVIEW_SCALE})`,
  transformOrigin: "top left",
  width: `${100 / PREVIEW_SCALE}%`,
  height: `${100 / PREVIEW_SCALE}%`,
};

const previewContainerStyle: React.CSSProperties = {
  paddingBottom: `${PREVIEW_ASPECT}%`,
  minHeight: `${PREVIEW_HEIGHT * PREVIEW_SCALE}px`,
};

const darkInputClasses =
  "rounded-lg border border-border-strong bg-neutral-dark px-2.5 py-1.5 text-text-primary shadow-[inset_0_1px_2px_rgba(15,23,42,0.45)] outline-none caret-accent-info focus:ring-2 focus:ring-accent-info/40";
const cardShellClasses = "rounded-3lg border border-border bg-surface text-text-primary shadow-surface-lg";
const statusCardClasses = "rounded-3lg border border-border bg-surface text-text-primary shadow-surface-md";
const tileBaseClasses =
  "flex h-full min-w-0 flex-col gap-3 rounded-4lg border p-[18px] text-text-primary transition-colors duration-200";
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
  const [parsedState, setParsedState] = useState<ParsedMap>(() => emptyParsed());
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

  useEffect(() => {
    document.title = "Quantum Qi - Operator Portal";
  }, []);
  useEffect(() => {
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
  }, []);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const guestWindowRef = useRef<Window | null>(null);
  const replaceInputsRef = useRef<Record<ReportKind, HTMLInputElement | null>>({} as Record<ReportKind, HTMLInputElement | null>);
  const base = (import.meta.env.VITE_API_BASE ?? "http://localhost:8000") as string;
  const autoOpenAttemptedRef = useRef(false);
  const autoOpenTimerRef = useRef<number | null>(null);

  type OperationContext = { seq: number; signal: AbortSignal };

  const mountedRef = useRef(true);
  const operationSeqRef = useRef(0);
  const operationAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (operationAbortRef.current) {
        operationAbortRef.current.abort();
        operationAbortRef.current = null;
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

  const markBackendUp = (ctx?: OperationContext) => applyState(setBackendDown, false, ctx);
  const markBackendDown = (err?: unknown, ctx?: OperationContext) => {
    if (err === undefined || isNetworkError(err)) {
      applyState(setBackendDown, true, ctx);
    }
  };

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
    setStagedPreviewSessionId(null);
    setStagedPreviewVersion((v) => v + 1);
    setHasShownOnGuest(false);
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
    setIsEditingName(true);
    setStatus("Editing guest name…");
    setError("");
  }

  function cancelEditName() {
    setIsEditingName(false);
    setEditedFirstName("");
    setEditedLastName("");
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
    const { first: currentFirst, last: currentLast } = currentSessionNames(session);
    if (
      normalizeName(first) === normalizeName(currentFirst) &&
      normalizeName(last) === normalizeName(currentLast)
    ) {
      setIsEditingName(false);
      setEditedFirstName("");
      setEditedLastName("");
      const currentName = formatFullName(currentFirst, currentLast) || session.client_name;
      setStatus(currentName ? `Drop the folder for ${currentName}.` : "Ready for the next guest folder.");
      return;
    }

    const previous = {
      clientName: session.client_name,
      firstName: session.first_name,
      lastName: session.last_name,
    };

    try {
      setStatus("Updating guest name…");
      setError("");
      const provisionalFull = formatFullName(first, last);
      setSession((prev) => (prev ? { ...prev, first_name: first, last_name: last, client_name: provisionalFull } : prev));
      const updated = await updateSession(session.id, { first_name: first, last_name: last });
      markBackendUp();
      setSession(updated);
      setIsEditingName(false);
      setEditedFirstName("");
      setEditedLastName("");
      setStatus(`Guest name updated to ${formatFullName(updated.first_name, updated.last_name)}. Re-drop the folder if needed.`);
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
      applyState(setStatus, "No files detected. Drop a folder that contains the guest PDFs.", operation);
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

    const pdfs = dropped.filter(({ name }) => name.toLowerCase().endsWith(".pdf"));
    if (!pdfs.length) {
      applyState(setStatus, "No PDF files found inside the folder.", operation);
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
      for (const entry of pdfs) {
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

  async function parseSelectedReports(ctx?: OperationContext): Promise<boolean> {
    if (!session) return false;
    const operation = ctx ?? beginOperation();
    if (isUploading) {
      applyState(setStatus, "Upload in progress. Please wait until uploads finish before publishing.", operation);
      return false;
    }

    const targets: Array<{ kind: ReportKind; file: FileOut }> = REPORT_DEFS.flatMap(
      (def) => {
        const file = uploads[def.kind];
        return selectedReports[def.kind] && file
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

  async function onPublish() {
    if (!session) return;
    const operation = beginOperation();
    if (session.published && !hasPendingChanges) {
      applyState(setStatus, "No changes to publish.", operation);
      return;
    }
    applyState(setError, "", operation);
    const parsed = await parseSelectedReports(operation);
    if (!parsed || !isOperationActive(operation)) {
      return;
    }
    try {
      applyState(setStatus, session.published ? "Updating live session…" : "Publishing…", operation);
      const sessionId = session.id;
      const result = await publish(sessionId, true, selectedReports);
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
                ? "Ready to reveal on the guest screen."
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
      <Button type="submit" variant="primary" disabled={!firstNameInput.trim()}>
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
        "mt-4 flex flex-wrap items-center gap-3 rounded-3lg border border-dotted border-dropzone-border bg-dropzone-base px-4 py-3 text-[12px] text-[#4b5563] transition-colors duration-150",
        {
          "rounded-[18px] border-[4px] border-dotted border-accent-blue bg-dropzone-active px-4 py-4": isDragActive,
        },
      )}
    >
      <Button type="button" variant="primary" onClick={onBrowse} className="px-[18px]">
        Upload
      </Button>
      <div>Upload files, or drag and drop files or folders anywhere on this screen.</div>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        multiple
        className="hidden"
        onChange={onFileInput}
      />
    </div>
  );

  const renderReportTiles = () => {
    if (!session) return null;
    const publishableReports = REPORT_DEFS.filter((def) => selectedReports[def.kind] && uploads[def.kind]);
    const hasSelectedReports = publishableReports.length > 0;
    const canPublishWithoutSelection = session.published;
    const publishLocked = session.published && !hasPendingChanges;
    const disablePublish = (!hasSelectedReports && !canPublishWithoutSelection) || isUploading || publishLocked;
    const publishLabel = session.published ? (hasPendingChanges ? "Update" : "Published") : "Publish";
    const publishButtonVariant = publishLocked ? "secondary" : "primary";
    const publishStatusText = hasSelectedReports
      ? session.published
        ? publishLocked
          ? "Published and up to date."
          : "Published. Update to reflect recent changes."
        : "Ready to publish the selected reports."
      : session.published
      ? "Publishing will hide all reports from the guest view."
      : "Select at least one uploaded report to enable publishing.";

    return (
      <div className="mt-4 flex flex-col gap-4">
        <div
          className={cn(
            "grid gap-[14px] [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]",
            {
              "rounded-[18px] border-[4px] border-dotted border-accent-blue bg-[rgba(37,99,235,0.08)] p-4": isDragActive,
            },
          )}
        >
        {[...REPORT_DEFS.map((def) => {
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

          const chipVariant: ChipVariant = hasParseError
            ? "danger"
            : isPublishedReport
            ? "success"
            : parsedAndSelected
            ? "success"
            : tileState === "uploaded"
            ? isSelected
              ? "info"
              : "muted"
            : "muted";
          const chipLabel = hasParseError
            ? "Error"
            : isPublishedReport
            ? "Published"
            : parsedAndSelected
            ? "Parsed"
            : tileState === "uploaded"
            ? isSelected
              ? "Ready"
              : "Uploaded"
            : "Waiting";

          return (
            <div key={def.kind} className={tileClass}>
              <input
                type="file"
                accept="application/pdf"
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
                        {needsLocatorGuidance
                          ? `${err} Fix the file and parse again or deselect to continue.`
                          : err}
                      </div>
                    )}
                    {!isSelected && (
                      <div className={cn(parsedFlag ? "text-[#60a5fa]" : "text-[#fbbf24]")}>
                        {parsedFlag ? "Hidden from guest view" : "Deselected until re-selected"}
                      </div>
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
                    className="self-start rounded-full px-3 py-1.5 text-[11px]"
                  >
                    Replace PDF
                  </Button>
                )}
              </div>
            </div>
          );
        }),
        <div
          key="publish-tile"
          className={cn(
            tileBaseClasses,
            "justify-between rounded-4lg border border-transparent bg-surface p-5 text-text-primary shadow-surface-md",
          )}
        >
          <div className="flex flex-col gap-2">
            <div className="text-[14px] font-bold">Publish Session</div>
            <div className="text-[12px] leading-relaxed text-text-secondary">
              Finalize the selected reports to update the guest view.
            </div>
            <div className="text-[12px] text-text-secondary">{publishStatusText}</div>
          </div>
          <Button onClick={onPublish} disabled={disablePublish} variant={publishButtonVariant} className="w-full">
            {publishLabel}
          </Button>
        </div>]}
        </div>
      </div>
    );
  };

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const liveMonitorUrl = origin ? `${origin}/guest?monitor=1` : "/guest?monitor=1";
  const stagedPreviewUrl =
    stagedPreviewSessionId !== null
      ? origin
        ? `${origin}/guest?session=${stagedPreviewSessionId}&preview=1&v=${stagedPreviewVersion}`
        : `/guest?session=${stagedPreviewSessionId}&preview=1&v=${stagedPreviewVersion}`
      : null;
  const hasStagedData = Boolean(stagedPreviewSessionId && stagedPreviewUrl);
  const showStagedPreviewBlock = Boolean(session && hasStagedData);
  const stagedPreviewVisible = showStagedPreviewBlock && !hasShownOnGuest;

  useEffect(() => {
    const centerScroll = (node: HTMLDivElement | null) => {
      if (!node) return;
      const id = requestAnimationFrame(() => {
        const horizontal = Math.max(0, (node.scrollWidth - node.clientWidth) / 2);
        const vertical = Math.max(0, (node.scrollHeight - node.clientHeight) / 2);
        node.scrollLeft = horizontal;
        node.scrollTop = vertical;
      });
      return () => cancelAnimationFrame(id);
    };
    const cancelLive = !stagedPreviewVisible ? centerScroll(livePreviewContainerRef.current) : undefined;
    const cancelStaged = stagedPreviewVisible ? centerScroll(stagedPreviewContainerRef.current) : undefined;
    return () => {
      cancelLive?.();
      cancelStaged?.();
    };
  }, [stagedPreviewVisible, showStagedPreviewBlock, hasShownOnGuest]);

  if (backendDown) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-logo-background px-6 text-center text-text-primary">
        <div className="space-y-4">
          <div className="text-[30px] font-bold">Operator Console Offline</div>
          <div className="mt-2 text-[16px] opacity-80">
            The Quantum Qi services are no longer reachable. Close this window and restart the program once
            the server is running again.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      onDragEnter={handleDragHighlight}
      onDragOver={handleDragHighlight}
      onDragLeave={handleDragLeaveArea}
      onDrop={handleDrop}
      className="flex flex-wrap items-start gap-6 px-4 py-4"
    >
      <div className={cn("flex min-w-[320px] max-w-[760px] flex-1 flex-col", session ? "" : "min-h-[calc(100vh-64px)]")}> 
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-[20px] font-bold">Quantum Qi Operator Console</h1>
          </div>
          {session && (
            <Button onClick={resetSession} variant="danger" size="sm" className="px-3">
              Start Over
            </Button>
          )}
        </div>

        {session ? (
          <>
            {renderSessionHeader()}
            {renderDropZone()}
            {renderReportTiles()}
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-8">
            <div className="w-full max-w-[520px] rounded-3xl border border-border bg-surface/90 p-10 shadow-surface-lg backdrop-blur-sm">
              <h2 className="text-center text-[22px] font-semibold text-text-primary">Create a New Session</h2>
              <p className="mt-2 text-center text-[13px] text-text-secondary">
                Enter the guest name to begin. You can adjust details later if needed.
              </p>
              <form
                className="mt-6 flex flex-col gap-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const first = formatClientName(firstNameInput);
                  const last = formatClientName(lastNameInput);
                  if (!first || !last) {
                    setError("Enter the guest's first and last name.");
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
                <div className="flex flex-col gap-3 sm:flex-row">
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
                <Button type="submit" variant="primary" disabled={!firstNameInput.trim() || !lastNameInput.trim()} className="mt-2">
                  Create Session
                </Button>
              </form>
            </div>
          </div>
        )}

        {session && (status || error) && (
          <div className="mt-4 flex flex-col gap-2" aria-live="polite">
            {status && (
              <div className="rounded-2lg border border-status-info-border bg-status-info-bg px-[14px] py-2.5 text-[12px] text-status-info-text">
                {status}
              </div>
            )}
            {error && (
              <div className="rounded-2lg border border-status-error-border bg-status-error-bg px-[14px] py-2.5 text-[12px] text-status-error-text">
                Error: {error}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="sticky top-4 flex min-w-[300px] flex-1 self-stretch">
        <div className="flex h-[calc(100vh-32px)] min-h-[520px] flex-1 flex-col gap-4 rounded-3lg border border-[#e5e7eb] bg-white p-4">
          <div className="flex flex-col gap-1.5">
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
          {!guestWindowOpen && (
            <div className="rounded-lg bg-[#fef2f2] px-2.5 py-2 text-[12px] text-[#b91c1c]">
              Guest window is closed. Use the session header controls to launch it again.
            </div>
          )}
          <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto pr-2">
            <div
              className={cn(
                "rounded-[10px] border border-[#d1d5db] bg-white shadow-inner transition-all duration-500",
                stagedPreviewVisible ? "p-3" : "flex-1 p-0",
              )}
            >
              {!stagedPreviewVisible ? (
                <div
                  ref={livePreviewContainerRef}
                  className="relative h-full w-full overflow-hidden transition-opacity duration-500"
                  style={{ overflowX: "auto", overflowY: "hidden" }}
                >
                  <div className="relative w-full" style={previewContainerStyle}>
                    <iframe
                      title="Live Guest Monitor"
                      src={liveMonitorUrl}
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
              <div className="flex flex-1 flex-col gap-3 rounded-[10px] border border-[#d1d5db] bg-white p-3 shadow-inner transition-all duration-500">
                <div className="text-[12px] font-semibold uppercase tracking-[0.6px] text-[#4b5563]">
                  Staged Preview
                </div>
                <div className="text-[11px] text-[#6b7280]">
                  Review the staged data before revealing it to the guest.
                </div>
                <div className="flex-1 overflow-auto rounded-[8px] border border-[#d1d5db]">
                  {stagedPreviewUrl && (
                    <div
                      ref={stagedPreviewContainerRef}
                      className="relative h-full w-full overflow-auto"
                    >
                      <div className="relative w-full" style={previewContainerStyle}>
                        <iframe
                          key={`${stagedPreviewSessionId}-${stagedPreviewVersion}`}
                          title="Staged Guest Preview"
                          src={stagedPreviewUrl}
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
  );
}
