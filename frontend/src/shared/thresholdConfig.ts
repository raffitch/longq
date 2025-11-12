const LIMIT_KEY = "longevityq_threshold_limit";
const LIMIT_VERSION_KEY = "longevityq_threshold_limit_version";
const MAX_KEY = "longevityq_threshold_limit_max";
const VISIBLE_KEY = "longevityq_threshold_visible";
const VISIBLE_VERSION_KEY = "longevityq_threshold_visible_version";

const LIMIT_EVENT = "longevityq-threshold-limit-change";
const MAX_EVENT = "longevityq-threshold-max-change";
const VISIBLE_EVENT = "longevityq-threshold-visible-change";

// Default number of items surfaced per priority band in UI sliders/cards.
const DEFAULT_LIMIT = 4;
const DEFAULT_MAX = 10;
const CANON_VISIBLE_ORDER = ["very low", "low", "normal", "moderate", "high", "very high"] as const;
type VisibleValue = (typeof CANON_VISIBLE_ORDER)[number];
type VisibleArray = readonly VisibleValue[];

const CURRENT_LIMIT_VERSION = "3";
const CURRENT_VISIBLE_VERSION = "2";

const DEFAULT_VISIBLE = Object.freeze([
  "very high",
  "high",
  "moderate",
  "normal",
  "low",
  "very low",
] as const) as VisibleArray;

const getWindow = () => (typeof window === "undefined" ? null : window);

let cachedLimit = DEFAULT_LIMIT;
let cachedMax = DEFAULT_MAX;
let cachedVisible: VisibleArray = DEFAULT_VISIBLE;

let limitHydrated = false;
let maxHydrated = false;
let visibleHydrated = false;

const clampPositiveInt = (value: unknown, fallback: number): number => {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;
  if (Number.isFinite(numeric) && numeric >= 1) {
    return Math.max(1, Math.round(numeric));
  }
  return fallback;
};

const readLimitFromStorage = (): number => {
  const win = getWindow();
  if (!win) return cachedLimit;
  try {
    const stored = win.localStorage.getItem(LIMIT_KEY);
    if (stored == null) return DEFAULT_LIMIT;
    return clampPositiveInt(stored, DEFAULT_LIMIT);
  } catch {
    return DEFAULT_LIMIT;
  }
};

const ensureLimitHydrated = () => {
  if (limitHydrated) return;
  limitHydrated = true;
  const win = getWindow();
  if (win) {
    try {
      const storedVersion = win.localStorage.getItem(LIMIT_VERSION_KEY);
      if (storedVersion !== CURRENT_LIMIT_VERSION) {
        cachedLimit = DEFAULT_LIMIT;
        win.localStorage.setItem(LIMIT_KEY, String(DEFAULT_LIMIT));
        win.localStorage.setItem(LIMIT_VERSION_KEY, CURRENT_LIMIT_VERSION);
        return;
      }
    } catch {
      cachedLimit = DEFAULT_LIMIT;
      return;
    }
  }
  cachedLimit = readLimitFromStorage();
};

const readMaxFromStorage = (): number => {
  const win = getWindow();
  if (!win) return cachedMax;
  try {
    const stored = win.localStorage.getItem(MAX_KEY);
    if (stored == null) return DEFAULT_MAX;
    return clampPositiveInt(stored, DEFAULT_MAX);
  } catch {
    return DEFAULT_MAX;
  }
};

const ensureMaxHydrated = () => {
  if (maxHydrated) return;
  maxHydrated = true;
  cachedMax = readMaxFromStorage();
};

const normalizeVisible = (values: string[]): VisibleArray => {
  const normalized = Array.from(new Set(values.map((value) => value.trim().toLowerCase()))).filter(
    Boolean,
  );
  if (!normalized.length) {
    return DEFAULT_VISIBLE;
  }
  const ordered = CANON_VISIBLE_ORDER.filter((entry) => normalized.includes(entry));
  if (!ordered.length) {
    return DEFAULT_VISIBLE;
  }
  // Freeze to discourage accidental mutation and preserve identity checks.
  return Object.freeze(ordered) as VisibleArray;
};

const readVisibleFromStorage = (): VisibleArray => {
  const win = getWindow();
  if (!win) return cachedVisible;
  try {
    const stored = win.localStorage.getItem(VISIBLE_KEY);
    if (!stored) return DEFAULT_VISIBLE;
    const parsed: unknown = JSON.parse(stored);
    if (Array.isArray(parsed)) {
      const values = parsed.filter((value): value is string => typeof value === "string");
      if (values.length) {
        return normalizeVisible(values);
      }
    }
  } catch {
    /* ignore malformed storage */
  }
  return DEFAULT_VISIBLE;
};

const ensureVisibleHydrated = () => {
  if (visibleHydrated) return;
  visibleHydrated = true;
  const win = getWindow();
  if (win) {
    try {
      const storedVersion = win.localStorage.getItem(VISIBLE_VERSION_KEY);
      if (storedVersion !== CURRENT_VISIBLE_VERSION) {
        cachedVisible = DEFAULT_VISIBLE;
        win.localStorage.setItem(VISIBLE_KEY, JSON.stringify(Array.from(DEFAULT_VISIBLE)));
        win.localStorage.setItem(VISIBLE_VERSION_KEY, CURRENT_VISIBLE_VERSION);
        return;
      }
    } catch {
      cachedVisible = DEFAULT_VISIBLE;
      return;
    }
  }
  cachedVisible = readVisibleFromStorage();
};

const arraysEqual = (a: readonly string[], b: readonly string[]) => {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

export const getThresholdLimit = (): number => {
  ensureLimitHydrated();
  return cachedLimit;
};

export const setThresholdLimit = (value: number) => {
  const win = getWindow();
  if (!win) return;
  ensureLimitHydrated();
  const limit = clampPositiveInt(value, DEFAULT_LIMIT);
  if (limit === cachedLimit) {
    return;
  }
  cachedLimit = limit;
  try {
    win.localStorage.setItem(LIMIT_KEY, String(limit));
    win.localStorage.setItem(LIMIT_VERSION_KEY, CURRENT_LIMIT_VERSION);
  } catch {
    /* ignore storage quota issues */
  }
  win.dispatchEvent(new CustomEvent(LIMIT_EVENT, { detail: limit }));
};

export const getThresholdMax = (): number => {
  ensureMaxHydrated();
  return cachedMax;
};

export const setThresholdMax = (value: number) => {
  const win = getWindow();
  if (!win) return;
  ensureMaxHydrated();
  const maxValue = clampPositiveInt(value, DEFAULT_MAX);
  if (cachedMax === maxValue) return;
  cachedMax = maxValue;
  try {
    win.localStorage.setItem(MAX_KEY, String(maxValue));
  } catch {
    /* ignore storage quota issues */
  }
  win.dispatchEvent(new CustomEvent(MAX_EVENT, { detail: maxValue }));
};

export const addThresholdLimitListener = (listener: () => void): (() => void) => {
  const win = getWindow();
  if (!win) return () => {};
  const handleStorage = (event: StorageEvent) => {
    if (event.key === LIMIT_KEY) {
      cachedLimit = readLimitFromStorage();
      listener();
    }
  };
  const handleCustom = (event: Event) => {
    const detail = (event as CustomEvent<number | undefined>).detail;
    if (typeof detail === "number" && Number.isFinite(detail)) {
      cachedLimit = clampPositiveInt(detail, DEFAULT_LIMIT);
    } else {
      cachedLimit = readLimitFromStorage();
    }
    listener();
  };
  win.addEventListener("storage", handleStorage);
  win.addEventListener(LIMIT_EVENT, handleCustom as EventListener);
  return () => {
    win.removeEventListener("storage", handleStorage);
    win.removeEventListener(LIMIT_EVENT, handleCustom as EventListener);
  };
};

export const addThresholdMaxListener = (listener: () => void): (() => void) => {
  const win = getWindow();
  if (!win) return () => {};
  const handleStorage = (event: StorageEvent) => {
    if (event.key === MAX_KEY) {
      cachedMax = readMaxFromStorage();
      listener();
    }
  };
  const handleCustom = (event: Event) => {
    const detail = (event as CustomEvent<number | undefined>).detail;
    if (typeof detail === "number" && Number.isFinite(detail)) {
      cachedMax = clampPositiveInt(detail, DEFAULT_MAX);
    } else {
      cachedMax = readMaxFromStorage();
    }
    listener();
  };
  win.addEventListener("storage", handleStorage);
  win.addEventListener(MAX_EVENT, handleCustom as EventListener);
  return () => {
    win.removeEventListener("storage", handleStorage);
    win.removeEventListener(MAX_EVENT, handleCustom as EventListener);
  };
};

export const THRESHOLD_LIMIT_EVENT = LIMIT_EVENT;
export const THRESHOLD_MAX_EVENT = MAX_EVENT;

export const getVisibleSeverities = (): VisibleArray => {
  ensureVisibleHydrated();
  return cachedVisible;
};

export const setVisibleSeverities = (values: string[]) => {
  const win = getWindow();
  if (!win) return;
  ensureVisibleHydrated();
  const effective = normalizeVisible(values);
  if (arraysEqual(effective, cachedVisible)) {
    return;
  }
  cachedVisible = effective;
  try {
    win.localStorage.setItem(VISIBLE_KEY, JSON.stringify(effective));
    win.localStorage.setItem(VISIBLE_VERSION_KEY, CURRENT_VISIBLE_VERSION);
  } catch {
    /* ignore storage quota issues */
  }
  win.dispatchEvent(new CustomEvent(VISIBLE_EVENT, { detail: effective }));
};

export const addVisibleSeveritiesListener = (listener: () => void): (() => void) => {
  const win = getWindow();
  if (!win) return () => {};
  const handleStorage = (event: StorageEvent) => {
    if (event.key === VISIBLE_KEY) {
      cachedVisible = readVisibleFromStorage();
      listener();
    }
  };
  const handleCustom = (event: Event) => {
    const detail = (event as CustomEvent<VisibleArray | undefined>).detail;
    if (Array.isArray(detail)) {
      cachedVisible = detail as VisibleArray;
    } else {
      cachedVisible = readVisibleFromStorage();
    }
    listener();
  };
  win.addEventListener("storage", handleStorage);
  win.addEventListener(VISIBLE_EVENT, handleCustom as EventListener);
  return () => {
    win.removeEventListener("storage", handleStorage);
    win.removeEventListener(VISIBLE_EVENT, handleCustom as EventListener);
  };
};

export const THRESHOLD_VISIBLE_EVENT = VISIBLE_EVENT;
