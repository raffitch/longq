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
type ParseWarningState = {
  open: boolean;
  deselected: string[];
  missing: string[];
  allowProceed: boolean;
  notice: string;
  message?: string;
};

const PATIENT_HEARTBEAT_KEY = "longevityq_patient_heartbeat";
const PATIENT_HEARTBEAT_GRACE_MS = 8000;

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

function initialParseWarningState(): ParseWarningState {
  return { open: false, deselected: [], missing: [], allowProceed: true, notice: "", message: undefined };
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

function detectReportKind(filename: string): ReportKind | null {
  const name = filename.toLowerCase();
  for (const def of REPORT_DEFS) {
    if (def.aliases.some((alias) => name.includes(alias))) {
      return def.kind;
    }
  }
  return null;
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

function StatusIcon({ state }: { state: "pending" | "success" | "error" }) {
  if (state === "success") {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="12" fill="#16a34a" />
        <path
          d="M7.5 12.5l2.5 2.5 6-6"
          stroke="#fff"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (state === "error") {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="12" fill="#dc2626" />
        <path d="M8 8l8 8M16 8l-8 8" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="#9ca3af" strokeWidth="2" strokeDasharray="2 4" />
    </svg>
  );
}

export default function Operator({ onSessionReady }: { onSessionReady: (id: number) => void }) {
  const [firstNameInput, setFirstNameInput] = useState("");
  const [lastNameInput, setLastNameInput] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [uploads, setUploads] = useState<UploadMap>(() => createEmptyUploadMap());
  const [uploadErrors, setUploadErrors] = useState<UploadErrorMap>(() => createEmptyErrorMap());
  const [unmatchedFiles, setUnmatchedFiles] = useState<string[]>([]);
  const [selectedReports, setSelectedReports] = useState<SelectionMap>(() => createSelectionMap(false));
  const [parsedOk, setParsedOk] = useState<boolean>(false);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [isDragActive, setIsDragActive] = useState<boolean>(false);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [isEditingName, setIsEditingName] = useState<boolean>(false);
  const [editedFirstName, setEditedFirstName] = useState<string>("");
  const [editedLastName, setEditedLastName] = useState<string>("");
  const [parseWarning, setParseWarning] = useState<ParseWarningState>(initialParseWarningState);
  const [pendingFoodFile, setPendingFoodFile] = useState<FileOut | null>(null);
  const [lastDroppedFiles, setLastDroppedFiles] = useState<DroppedFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const patientWindowRef = useRef<Window | null>(null);
  const replaceInputsRef = useRef<Record<ReportKind, HTMLInputElement | null>>({} as Record<ReportKind, HTMLInputElement | null>);
  const [stagedPreviewSessionId, setStagedPreviewSessionId] = useState<number | null>(null);
  const [stagedPreviewVersion, setStagedPreviewVersion] = useState(0);
  const [hasShownOnPatient, setHasShownOnPatient] = useState(false);
  const [patientWindowOpen, setPatientWindowOpen] = useState(false);

  function resetUploadState() {
    setUploads(createEmptyUploadMap());
    setUploadErrors(createEmptyErrorMap());
    setSelectedReports(createSelectionMap(false));
    setParsedOk(false);
    setUnmatchedFiles([]);
    setParseWarning(initialParseWarningState());
    setPendingFoodFile(null);
    setLastDroppedFiles([]);
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
    setParseWarning(initialParseWarningState());
    setPendingFoodFile(null);
    setStagedPreviewSessionId(null);
    setStagedPreviewVersion((v) => v + 1);
    setHasShownOnPatient(false);
  }

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
      setSession(updated);
      setIsEditingName(false);
      setEditedFirstName("");
      setEditedLastName("");
      setStatus(`Patient name updated to ${formatFullName(updated.first_name, updated.last_name)}. Re-drop the folder if needed.`);
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
    }
  }

  function toggleSelection(kind: ReportKind, checked: boolean) {
    setSelectedReports((prev) => ({ ...prev, [kind]: checked }));
    const label = REPORT_DEFS.find((d) => d.kind === kind)?.label ?? kind;
    if (kind === "food" && !checked) {
      setParsedOk(false);
    }
    setParseWarning(initialParseWarningState());
    setPendingFoodFile(null);
    setError("");
    setStatus(
      checked
        ? `${label} report selected.`
        : `${label} report deselected; it will be skipped until re-selected.`,
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
    setUnmatchedFiles([]);
    setParseWarning(initialParseWarningState());
    setPendingFoodFile(null);

    const rootName = getRootFolderName(dropped);
    if (rootName) {
      const normalizedFolder = normalizeName(formatClientName(rootName));
      const normalizedSession = normalizeName(session.client_name);
      if (normalizedFolder !== normalizedSession) {
        const currentName = formatFullName(session.first_name, session.last_name) || session.client_name;
        setStatus(
          `Folder name (“${rootName}”) differs from the current patient (${currentName}). Proceeding anyway.`,
        );
      }
    } else {
      setStatus("Could not determine folder name. Please drop the patient folder (not individual files).");
      return;
    }

    const pdfs = dropped.filter(({ name }) => name.toLowerCase().endsWith(".pdf"));
    if (!pdfs.length) {
      setStatus("No PDF files found inside the folder.");
      return;
    }

    const unmatched: string[] = [];
    let uploadedAny = false;

    setIsUploading(true);
    try {
      for (const entry of pdfs) {
        const kind = detectReportKind(entry.name);
        if (!kind) {
          unmatched.push(entry.name);
          continue;
        }

        if (kind === "food") {
          setParsedOk(false);
        }
        setUploadErrors((prev) => ({ ...prev, [kind]: null }));

        try {
          setStatus(`Uploading "${entry.name}"…`);
          const uploaded = await uploadPdf(session.id, kind, entry.file);
          setUploads((prev) => ({ ...prev, [kind]: uploaded }));
          setSelectedReports((prev) => ({ ...prev, [kind]: true }));
          setUploadErrors((prev) => ({ ...prev, [kind]: null }));
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
        }
      }
    } finally {
      setIsUploading(false);
    }

    if (unmatched.length) {
      setUnmatchedFiles(unmatched);
      setStatus(
        unmatched.length === pdfs.length && !uploadedAny
          ? "No recognizable report types found. Check file naming."
          : "Some files were skipped. Check their names.",
      );
    } else if (uploadedAny) {
      setUnmatchedFiles([]);
      setStatus((prev) => prev || "Uploads complete.");
    }
  }

  async function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
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
      }
      setUploadErrors((prev) => ({ ...prev, [kind]: null }));
      setStatus(`Uploading "${file.name}"…`);
      const uploaded = await uploadPdf(session.id, kind, file);
      setUploads((prev) => ({ ...prev, [kind]: uploaded }));
      setSelectedReports((prev) => ({ ...prev, [kind]: true }));
      setUploadErrors((prev) => ({ ...prev, [kind]: null }));
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

  async function performParse(notice: string, foodFile: FileOut) {
    if (!session || isUploading) return;
    try {
      setError("");
      setUploadErrors((prev) => ({ ...prev, food: null }));
      setParsedOk(false);
      setStatus(notice ? `${notice} Parsing food report…` : "Parsing food report…");
      await parseFile(foodFile.id);
      setParsedOk(true);
      setStatus(notice ? `${notice} Food report parsed. Ready to publish.` : "Food report parsed. Ready to publish.");
      setPendingFoodFile(null);
    } catch (e: any) {
      setParsedOk(false);
      setError(formatErrorMessage(e));
      setUploadErrors((prev) => ({ ...prev, food: formatErrorMessage(e) }));
      setStatus("Parsing failed.");
      setPendingFoodFile(null);
    }
  }

  async function onParse() {
    if (!session) return;
    const foodFile = uploads["food"];
    if (!foodFile || isUploading) return;
    const missing = REPORT_DEFS.filter((def) => !uploads[def.kind]).map((def) => def.label);

    if (!selectedReports["food"]) {
      setError("Food report is deselected. Select it before parsing.");
      setStatus("Food report is not selected.");
      setParseWarning({
        open: true,
        deselected: ["Food"],
        missing,
        allowProceed: false,
        notice: "",
        message: "Select the Food report before parsing.",
      });
      setPendingFoodFile(null);
      return;
    }

    const deselected = REPORT_DEFS.filter((def) => def.kind !== "food" && uploads[def.kind] && !selectedReports[def.kind]).map((def) => def.label);
    const noticeParts: string[] = [];
    if (missing.length) {
      noticeParts.push(`Missing: ${missing.join(", ")}`);
    }
    if (deselected.length) {
      noticeParts.push(`Deselected: ${deselected.join(", ")}`);
    }
    const notice = noticeParts.join(" | ");

    if (deselected.length || missing.length) {
      setParseWarning({
        open: true,
        deselected,
        missing,
        allowProceed: true,
        notice,
      });
      setPendingFoodFile(foodFile);
      setStatus("Review missing or deselected reports.");
      setError("");
      return;
    }

    await performParse("", foodFile);
    setPendingFoodFile(null);
  }

  async function onPublish() {
    if (!session) return;
    try {
      setError("");
      setStatus("Publishing…");
      const sessionId = session.id;
      const result = await publish(sessionId, true);
      localStorage.setItem(
        "longevityq_publish",
        JSON.stringify({ sessionId, ts: Date.now() }),
      );
      setSession((prev) => (prev ? { ...prev, published: result.published } : prev));
      setStagedPreviewSessionId(sessionId);
      setStagedPreviewVersion((v) => v + 1);
      setHasShownOnPatient(false);
      setStatus("Published. Staged preview refreshed below.");
    } catch (e: any) {
      setError(formatErrorMessage(e));
      setStatus("Publish failed.");
    }
  }

  async function showOnPatient() {
    if (!session) return;
    await setDisplaySession(session.id);
    localStorage.setItem(
      "longevityq_publish",
      JSON.stringify({ sessionId: session.id, ts: Date.now() }),
    );
    setStatus("Bound current session to patient screen.");
    setHasShownOnPatient(true);
  }

  async function clearPatient() {
    await setDisplaySession(null);
    localStorage.setItem(
      "longevityq_publish",
      JSON.stringify({ sessionId: 0, ts: Date.now() }),
    );
    setStatus("Cleared patient screen.");
    setHasShownOnPatient(false);
  }

  function closeParseWarning() {
    setParseWarning(initialParseWarningState());
    setPendingFoodFile(null);
  }

  async function proceedAfterWarning() {
    if (!pendingFoodFile) {
      closeParseWarning();
      return;
    }
    const warning = parseWarning;
    closeParseWarning();
    await performParse(warning.notice, pendingFoodFile);
  }

  const hasFoodUpload = Boolean(uploads["food"]);

  const renderSessionHeader = () => {
    if (!session) return null;
    const displayName = formatFullName(session.first_name, session.last_name) || session.client_name;
    return (
      <div
        style={{
          marginTop: "12px",
          display: "flex",
          alignItems: "center",
          gap: "12px",
          padding: "12px",
          borderRadius: "10px",
          background: "#111827",
          color: "#fff",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
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
                style={{ padding: "4px 8px", borderRadius: "6px", border: "1px solid #4b5563", color: "#0f172a" }}
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
                style={{ padding: "4px 8px", borderRadius: "6px", border: "1px solid #4b5563", color: "#0f172a" }}
              />
              <button
                type="button"
                onClick={saveEditName}
                style={{ padding: "4px 6px", background: "#16a34a", color: "#fff", borderRadius: "6px" }}
                title="Save name"
              >
                <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M5 10.5l3 3 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button
                type="button"
                onClick={cancelEditName}
                style={{ padding: "4px 6px", background: "#b91c1c", color: "#fff", borderRadius: "6px" }}
                title="Cancel"
              >
                <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div style={{ fontSize: "14px", fontWeight: 600 }}>{displayName}</div>
              <button
                type="button"
                onClick={startEditName}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 24,
                  height: 24,
                  borderRadius: "999px",
                  background: "#1f2937",
                  color: "#e5e7eb",
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
            <div style={{ fontSize: "12px", opacity: 0.8 }}>Session #{session.id}</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: "8px" }}>
          <button
            onClick={showOnPatient}
            style={{ padding: "6px 10px", background: "#2563eb", color: "#fff", borderRadius: 6 }}
          >
            Show on Patient
          </button>
          <button
            onClick={clearPatient}
            style={{ padding: "6px 10px", background: "#6b7280", color: "#fff", borderRadius: 6 }}
          >
            Hide from Patient
          </button>
          <button
            onClick={openPatientWindow}
            style={{ padding: "6px 10px", background: "#0ea5e9", color: "#fff", borderRadius: 6 }}
          >
            Open Patient Window
          </button>
          <button
            onClick={resetSession}
            style={{ padding: "6px 10px", background: "#1f2937", color: "#fff", borderRadius: 6 }}
          >
            Start Over
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
          setSession(created);
          onSessionReady(created.id);
          setStagedPreviewSessionId(created.published ? created.id : null);
          setStagedPreviewVersion((v) => v + 1);
          setHasShownOnPatient(false);
          resetUploadState();
          setFirstNameInput(first);
          setLastNameInput(last);
          setStatus(`Session #${created.id} ready. Drop the folder for ${formatFullName(created.first_name, created.last_name)}.`);
        } catch (err) {
          setError(formatErrorMessage(err));
          setStatus("Session creation failed.");
        }
      }}
    >
      <input
        style={{ border: "1px solid #ccc", padding: "6px 10px", borderRadius: "6px", minWidth: 180 }}
        placeholder="First name"
        value={firstNameInput}
        onChange={(e) => setFirstNameInput(e.target.value)}
      />
      <input
        style={{ border: "1px solid #ccc", padding: "6px 10px", borderRadius: "6px", minWidth: 180 }}
        placeholder="Last name (optional)"
        value={lastNameInput}
        onChange={(e) => setLastNameInput(e.target.value)}
      />
      <button
        type="submit"
        style={{ padding: "6px 12px", background: "#111827", color: "#fff", borderRadius: "6px" }}
        disabled={!firstNameInput.trim()}
      >
        Create Session
      </button>
    </form>
  );

  const renderDropZone = () => (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!isDragActive) setIsDragActive(true);
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        if (!isDragActive) setIsDragActive(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        const target = e.relatedTarget as Node | null;
        if (!target || !(e.currentTarget as Node).contains(target)) {
          setIsDragActive(false);
        }
      }}
      onDrop={handleDrop}
      style={{
        marginTop: "20px",
        border: isDragActive ? "2px solid #2563eb" : "2px dashed #cbd5f5",
        borderRadius: "12px",
        padding: "28px",
        textAlign: "center",
        background: isDragActive ? "#ebf3ff" : "#f9fafb",
        transition: "border 120ms ease, background 120ms ease",
      }}
    >
      <div style={{ fontSize: "14px", fontWeight: 600 }}>Drop patient folder here (e.g. “Jane Doe”)</div>
      <div style={{ fontSize: "12px", color: "#4b5563", marginTop: "8px" }}>
        Each PDF name must contain the patient name and one of: Food, Heavy Metals, Hormones, Nutrition, Toxins.
      </div>
      <div style={{ marginTop: "14px" }}>
        <button
          type="button"
          onClick={onBrowse}
          style={{ padding: "8px 14px", background: "#111827", color: "#fff", borderRadius: "6px" }}
        >
          Browse for folder…
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          multiple
          style={{ display: "none" }}
          onChange={onFileInput}
          // @ts-ignore
          webkitdirectory=""
          // @ts-ignore
          directory=""
        />
      </div>
    </div>
  );

  const renderReportTiles = () => (
    <>
      <div style={{ marginTop: "16px", display: "flex", flexWrap: "wrap", gap: "14px" }}>
        {REPORT_DEFS.map((def) => {
          const uploaded = uploads[def.kind];
          const err = uploadErrors[def.kind];
          const isSelected = selectedReports[def.kind];
          const state: "pending" | "success" | "error" = uploaded && !err ? "success" : err ? "error" : "pending";
          const hasParseError = Boolean(err && uploaded);
          const needsLocatorGuidance =
            def.kind === "food" &&
            hasParseError &&
            typeof err === "string" &&
            err.toLowerCase().includes("unable to locate any food report categories");
          return (
            <div
              key={def.kind}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                padding: "10px 16px",
                borderRadius: "12px",
                background: "#111827",
                border: err ? "1px solid rgba(248, 113, 113, 0.65)" : "1px solid transparent",
                color: "#f9fafb",
                minWidth: 260,
                boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
              }}
            >
              <StatusIcon state={state} />
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
              <input
                type="checkbox"
                checked={uploaded ? isSelected : false}
                disabled={!uploaded}
                onChange={(e) => toggleSelection(def.kind, e.target.checked)}
                title={uploaded ? `Include ${def.label} report` : "Upload report first"}
                style={{ width: 18, height: 18, accentColor: "#16a34a", cursor: uploaded ? "pointer" : "not-allowed" }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{def.label}</div>
                {uploaded ? (
                  <>
                    <div
                      style={{
                        fontSize: 11,
                        opacity: hasParseError ? 1 : 0.75,
                        marginTop: 2,
                        color: hasParseError ? "#fecaca" : undefined,
                      }}
                    >
                      {uploaded.filename}
                    </div>
                    {hasParseError && (
                      <div style={{ fontSize: 11, marginTop: 2, color: "#fca5a5" }}>
                        {needsLocatorGuidance
                          ? `${err} Fix the file and parse again or deselect to continue.`
                          : err}
                      </div>
                    )}
                    {!isSelected && (
                      <div style={{ fontSize: 11, marginTop: 2, color: "#fbbf24" }}>Deselected</div>
                    )}
                    {def.kind === "food" && parsedOk && isSelected && (
                      <div style={{ fontSize: 11, marginTop: 2, color: "#bbf7d0" }}>Parsed ✓</div>
                    )}
                  </>
                ) : err ? (
                  <div style={{ fontSize: 11, marginTop: 2, color: "#fca5a5" }}>{err}</div>
                ) : (
                  <div style={{ fontSize: 11, opacity: 0.55, marginTop: 2 }}>Waiting for upload</div>
                )}
              </div>
              {(uploaded || err) && (
                <button
                  type="button"
                  onClick={() => onReplace(def.kind)}
                  style={{
                    padding: "4px 8px",
                    background: "#1f2937",
                    color: "#e5e7eb",
                    borderRadius: 6,
                    fontSize: 11,
                    border: "1px solid rgba(148, 163, 184, 0.35)",
                    whiteSpace: "nowrap",
                  }}
                >
                  Replace PDF
                </button>
              )}
            </div>
          );
        })}
      </div>
      {unmatchedFiles.length > 0 && (
        <div style={{ marginTop: "10px", fontSize: "12px", color: "#b45309" }}>
          Skipped files (rename to include report type): {unmatchedFiles.join(", ")}
        </div>
      )}
    </>
  );

  const renderParseWarning = () => (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: "12px",
          padding: "20px 22px",
          width: "min(420px, 92vw)",
          boxShadow: "0 20px 50px rgba(15,23,42,0.35)",
          color: "#0f172a",
        }}
      >
        <div style={{ fontSize: "18px", fontWeight: 600 }}>Check Reports</div>
        {parseWarning.message ? (
          <p style={{ marginTop: "12px", fontSize: "13px", lineHeight: 1.5 }}>{parseWarning.message}</p>
        ) : (
          <>
            <p style={{ marginTop: "12px", fontSize: "13px", lineHeight: 1.5 }}>
              Some reports are missing or deselected. Upload or select them before continuing, or proceed to parse only the
              selected reports.
            </p>
            {parseWarning.missing.length > 0 && (
              <div style={{ marginTop: "10px", fontSize: "12px", color: "#b45309" }}>
                Missing: {parseWarning.missing.join(", ")}
              </div>
            )}
            {parseWarning.deselected.length > 0 && (
              <div style={{ marginTop: "6px", fontSize: "12px", color: "#ca8a04" }}>
                Deselected: {parseWarning.deselected.join(", ")}
              </div>
            )}
          </>
        )}
        <div style={{ marginTop: "18px", display: "flex", justifyContent: "flex-end", gap: "10px" }}>
          <button
            type="button"
            onClick={closeParseWarning}
            style={{ padding: "6px 12px", background: "#e2e8f0", color: "#1f2937", borderRadius: "6px" }}
          >
            {parseWarning.allowProceed ? "Cancel" : "OK"}
          </button>
          {parseWarning.allowProceed && (
            <button
              type="button"
              onClick={proceedAfterWarning}
              style={{ padding: "6px 12px", background: "#2563eb", color: "#fff", borderRadius: "6px" }}
            >
              Proceed
            </button>
          )}
        </div>
      </div>
    </div>
  );

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const liveMonitorUrl = origin ? `${origin}/patient?monitor=1` : "/patient?monitor=1";
  const stagedPreviewUrl =
    stagedPreviewSessionId !== null
      ? origin
        ? `${origin}/patient?session=${stagedPreviewSessionId}&preview=1&v=${stagedPreviewVersion}`
        : `/patient?session=${stagedPreviewSessionId}&preview=1&v=${stagedPreviewVersion}`
      : null;

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "24px",
        padding: "16px",
        alignItems: "flex-start",
      }}
    >
      <div style={{ flex: "1 1 520px", maxWidth: "760px" }}>
        <h1 style={{ fontSize: "20px", fontWeight: 700, marginBottom: "4px" }}>Operator Console</h1>
        <div style={{ fontSize: "13px", color: "#4b5563", marginBottom: "8px" }}>
          Drag & drop the patient folder (named with first and last name) to automatically ingest reports.
          Filenames must include the patient name and the report type.
        </div>

        {session ? renderSessionHeader() : renderCreateForm()}

        {session && renderDropZone()}
        {session && renderReportTiles()}

        {parseWarning.open && renderParseWarning()}

          {session && hasFoodUpload && (
            <div style={{ marginTop: "12px" }}>
              <button
              onClick={onParse}
              disabled={!hasFoodUpload || !selectedReports["food"] || parsedOk || isUploading}
              style={{
                padding: "6px 10px",
                marginRight: "8px",
                background: parsedOk ? "#1f2937" : "#222",
                color: "#fff",
                borderRadius: "6px",
                opacity: !hasFoodUpload || !selectedReports["food"] || isUploading ? 0.5 : 1,
              }}
            >
              Parse Food Report
            </button>
            <button
              onClick={onPublish}
              disabled={!parsedOk}
              style={{
                padding: "6px 10px",
                background: "#16a34a",
                color: "#fff",
                borderRadius: "6px",
                opacity: parsedOk ? 1 : 0.5,
              }}
            >
              Publish
            </button>
          </div>
        )}

        <div style={{ marginTop: "8px", fontSize: "12px", color: "#444" }}>{status}</div>
        {error && (
          <div style={{ marginTop: "6px", fontSize: "12px", color: "#b91c1c" }}>Error: {error}</div>
        )}
      </div>

      <div style={{ flex: "1 1 320px", minWidth: "300px" }}>
        <div
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: "12px",
            background: "#fff",
            padding: "14px",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}>
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
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "6px" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  fontSize: "11px",
                  fontWeight: 600,
                  color: patientWindowOpen ? "#16a34a" : "#dc2626",
                }}
              >
                <span style={{ fontSize: "18px", lineHeight: "12px" }}>•</span>
                {patientWindowOpen ? "Window open" : "Window closed"}
              </div>
              <button
                onClick={openPatientWindow}
                style={{
                  padding: "6px 10px",
                  background: "#0ea5e9",
                  color: "#fff",
                  borderRadius: "6px",
                }}
              >
                Open Patient Window
              </button>
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
              Patient window is closed. Click “Open Patient Window” to launch it again.{" "}
              <a
                href={`${origin}/patient`}
                target="_blank"
                rel="noreferrer"
                style={{ color: "#dc2626", textDecoration: "underline" }}
              >
                Open in new tab
              </a>
            </div>
          )}
          <iframe
            title="Live Patient Monitor"
            src={liveMonitorUrl}
            style={{ width: "100%", height: "250px", border: "1px solid #d1d5db", borderRadius: "8px" }}
          />
          <div style={{ height: "1px", background: "#e5e7eb", margin: "4px 0 8px" }} />
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
                  : "Review the published data before revealing it to the patient."
                : "Publish to activate the staged preview."}
            </div>
          </div>
          {stagedPreviewSessionId && stagedPreviewUrl ? (
            <iframe
              key={`${stagedPreviewSessionId}-${stagedPreviewVersion}`}
              title="Staged Patient Preview"
              src={stagedPreviewUrl}
              style={{ width: "100%", height: "250px", border: "1px solid #d1d5db", borderRadius: "8px" }}
            />
          ) : (
            <div
              style={{
                padding: "16px",
                borderRadius: "8px",
                border: "1px dashed #d1d5db",
                fontSize: "12px",
                color: "#6b7280",
                textAlign: "center",
              }}
            >
              Publish the session to generate a staging preview.
            </div>
          )}
          {session && (
            <div style={{ fontSize: "12px", color: "#4b5563", marginTop: "4px" }}>
              Session #{session.id} • {formatFullName(session.first_name, session.last_name) || session.client_name}
              {session.published ? <span style={{ marginLeft: 6, color: "#16a34a" }}>• Published</span> : <span style={{ marginLeft: 6 }}>• Not published</span>}
              {parsedOk && <span style={{ marginLeft: 6, color: "#16a34a" }}>• Parsed ✓</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
