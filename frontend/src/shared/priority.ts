export type GeneralSeverity = "very high" | "high" | "moderate" | "normal" | "low" | "very low";

export const GENERAL_SEVERITY_ORDER: GeneralSeverity[] = [
  "very high",
  "high",
  "moderate",
  "normal",
  "low",
  "very low",
];

export const GENERAL_SEVERITY_META: Record<GeneralSeverity, { label: string; color: string; background: string}> = {
  "very high": {
    label: "Very High",
    color: "#e63946",
    background: "rgba(230, 57, 70, 0.18)",
  },
  high: {
    label: "High",
    color: "#f87171",
    background: "rgba(248, 113, 113, 0.18)",
  },
  moderate: {
    label: "Moderate",
    color: "#ff8a00",
    background: "rgba(255, 138, 0, 0.18)",
  },
  normal: {
    label: "Normal",
    color: "#ffc300",
    background: "rgba(255, 195, 0, 0.18)",
  },
  low: {
    label: "Low",
    color: "#43aa8b",
    background: "rgba(67, 170, 139, 0.18)",
  },
  "very low": {
    label: "Very Low",
    color: "#2aa198",
    background: "rgba(42, 161, 152, 0.18)",
  },
};

export const GENERAL_SEVERITY_THRESHOLDS: Array<{ min: number; severity: GeneralSeverity }> = [
  { min: 86, severity: "very high" },
  { min: 71, severity: "high" },
  { min: 57, severity: "moderate" },
  { min: 29, severity: "normal" },
  { min: 14, severity: "low" },
  { min: 0, severity: "very low" },
];

export const FOOD_SEVERITY_THRESHOLDS: Array<{ min: number; severity: "high" | "moderate" | "medium" | "low" }> = [
  { min: 90, severity: "high" },
  { min: 80, severity: "moderate" },
  { min: 65, severity: "medium" },
  { min: 0, severity: "low" },
];

export const makeSeverityClassifier = <S extends string>(
  thresholds: Array<{ min: number; severity: S }>,
) =>
  (score: number | undefined | null): S => {
    const value = Number.isFinite(score) ? Math.abs(Number(score)) : 0;
    for (const { min, severity } of thresholds) {
      if (value >= min) return severity;
    }
    return thresholds[thresholds.length - 1].severity;
  };
