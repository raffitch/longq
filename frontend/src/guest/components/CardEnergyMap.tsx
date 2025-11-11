import React, { useEffect, useMemo, useRef, useState } from "react";
import { BASE_LAYER_ELEMENTS } from "./energyMap/layers";
import { PADMASANA_OUTLINE, PADMASANA_VIEWBOX } from "./energyMap/padmasana";

export type EnergyStatus = "Stable" | "Imbalanced";

type Sex = "male" | "female";

interface CardEnergyMapProps {
  status: EnergyStatus;
  organSectionTitle?: string;
  sex?: Sex;
  showOnlyMale?: boolean;
  organValues?: Record<string, number | null | undefined>;
  chakraValues?: Record<string, number | null | undefined>;
  metricValues?: Record<
    string,
    | number
    | null
    | undefined
    | {
        value?: number | null;
        label?: string | null;
        name?: string | null;
      }
  >;
}

type LayerCategory = "structure" | "organ" | "system" | "reproductive";

interface LayerDefinition {
  id: string;
  name: string;
  category: LayerCategory;
}

interface LayerMetric extends LayerDefinition {
  element: React.ReactElement;
  color: string;
  value: number;
  opacity: number;
  priorityLabel: string;
  hasValue: boolean;
}

const VIEWBOX = {
  body: "0 0 293 706",
  chakra: PADMASANA_VIEWBOX,
} as const;

const MIN_OPACITY = 0.2;
const CHAKRA_RADIUS = 8.8;

const LAYER_DEFINITIONS: LayerDefinition[] = [
  { id: "male_silhouette", name: "Body Outline", category: "structure" },
  { id: "stomach", name: "Stomach", category: "organ" },
  { id: "gallbladder", name: "Gallbladder", category: "organ" },
  { id: "female_silhouette", name: "Body Outline 2", category: "structure" },
  { id: "large_intestine", name: "Large Intestine", category: "organ" },
  { id: "heart", name: "Heart", category: "organ" },
  { id: "bladder", name: "Bladder", category: "organ" },
  { id: "kidneys", name: "Kidneys", category: "organ" },
  { id: "liver", name: "Liver", category: "organ" },
  { id: "brain", name: "Brain", category: "organ" },
  { id: "reproductive_female", name: "Reproductive", category: "reproductive" },
  { id: "reproductive_male", name: "Reproductive", category: "reproductive" },
  { id: "thyroid", name: "Thyroid", category: "organ" },
  { id: "lungs", name: "Lungs", category: "organ" },
  { id: "spleen", name: "Spleen", category: "organ" },
  { id: "small_intestine", name: "Small Intestine", category: "organ" },
  { id: "lymphatic", name: "Lymphatic System", category: "system" },
];

const CHAKRA_POINTS = [
  { id: "Chakra_07_Crown", name: "Crown", cx: 170.49, cy: 8.8 },
  { id: "Chakra_06_ThirdEye", name: "Third Eye", cx: 170.49, cy: 62.88 },
  { id: "Chakra_05_Throat", name: "Throat", cx: 170.49, cy: 115.53 },
  { id: "Chakra_04_Heart", name: "Heart", cx: 170.49, cy: 172.72 },
  { id: "Chakra_03_SolarPlexus", name: "Solar Plexus", cx: 170.49, cy: 224.12 },
  { id: "Chakra_02_Sacral", name: "Sacral", cx: 170.49, cy: 278.29 },
  { id: "Chakra_01_Root", name: "Root", cx: 170.49, cy: 329.82 },
];

const CHAKRA_BASE_COLORS: Record<string, string> = {
  Chakra_01_Root: "#F87171", // red
  Chakra_02_Sacral: "#FB923C", // orange
  Chakra_03_SolarPlexus: "#FBBF24", // yellow
  Chakra_04_Heart: "#34D399", // green
  Chakra_05_Throat: "#60A5FA", // blue
  Chakra_06_ThirdEye: "#6366F1", // indigo
  Chakra_07_Crown: "#A78BFA", // violet
};

const STRUCTURE_COLOR = "#06B6D4";

type MetricValueInput = {
  value?: number | null;
  label?: string | null;
  name?: string | null;
};

interface MetricDefinition {
  id: string;
  title: string;
  gridClass: string;
}

interface MetricCardState extends MetricDefinition {
  name: string;
  value: number | null;
  label: string | null;
  color: string;
  hasValue: boolean;
}

const METRIC_CARD_DEFINITIONS: MetricDefinition[] = [
  {
    id: "inflammatory_score",
    title: "Inflammatory Score",
    gridClass: "hidden md:block md:col-start-3 md:row-start-2",
  },
  {
    id: "immunal_defense",
    title: "Immunal Defense",
    gridClass: "hidden md:block md:col-start-4 md:row-start-2",
  },
];

export interface PeekPriorityTier {
  label: string;
  color: string;
  min: number;
  range: string;
}

const CHAKRA_PRIORITY_TIERS: PeekPriorityTier[] = [
  { label: "Very High", color: "#EF4444", min: 93, range: "93 – 100" },
  { label: "High", color: "#F97316", min: 81, range: "81 – 92" },
  { label: "Neutral", color: "#9CA3AF", min: 23, range: "23 – 80" },
  { label: "Low", color: "#FACC15", min: 11, range: "11 – 22" },
  { label: "Very Low", color: "#0EA5E9", min: 0, range: "0 – 10" },
];

export const PEAK_PRIORITY_TIERS: PeekPriorityTier[] = [
  { label: "Very High", color: "#EF4444", min: 91, range: "91 – 100" },
  { label: "High", color: "#F97316", min: 76, range: "76 – 90" },
  { label: "Neutral", color: "#9CA3AF", min: 26, range: "26 – 75" },
  { label: "Low", color: "#FACC15", min: 11, range: "11 – 25" },
  { label: "Very Low", color: "#0EA5E9", min: 0, range: "0 – 10" },
];

const clampOpacity = (value: number) => Math.max(MIN_OPACITY, Math.min(1, value));

const clampToPercent = (input: number | null | undefined): number | null => {
  if (input === null || input === undefined) return null;
  const numeric = typeof input === "number" ? input : Number(input);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.min(100, Math.round(numeric)));
};

const ORGAN_SORT_ORDER = [
  "brain",
  "thyroid",
  "lungs",
  "heart",
  "lymphatic",
  "liver",
  "spleen",
  "stomach",
  "gallbladder",
  "kidneys",
  "small_intestine",
  "large_intestine",
  "bladder",
  "reproductive_male",
  "reproductive_female",
] as const;

const ORGAN_ORDER_INDEX = new Map<string, number>(ORGAN_SORT_ORDER.map((id, index) => [id, index]));

const DEFAULT_SEX: Sex = "male";

const MALE_EXCLUSIVE_LAYER_IDS = new Set(["male_silhouette", "reproductive_male"]);
const FEMALE_EXCLUSIVE_LAYER_IDS = new Set(["female_silhouette", "reproductive_female"]);

const shouldIncludeLayer = (definition: LayerDefinition, sex: Sex, showOnlyMale: boolean) => {
  if (showOnlyMale && FEMALE_EXCLUSIVE_LAYER_IDS.has(definition.id)) {
    return false;
  }
  if (sex === "male" && FEMALE_EXCLUSIVE_LAYER_IDS.has(definition.id)) {
    return false;
  }

  if (sex === "female" && MALE_EXCLUSIVE_LAYER_IDS.has(definition.id)) {
    return false;
  }

  return true;
};

const getPriorityForValue = (value: number) => {
  const match = PEAK_PRIORITY_TIERS.find((entry) => value >= entry.min);
  return match ?? PEAK_PRIORITY_TIERS[PEAK_PRIORITY_TIERS.length - 1];
};

const getChakraPriorityForValue = (value: number) => {
  const match = CHAKRA_PRIORITY_TIERS.find((entry) => value >= entry.min);
  return match ?? CHAKRA_PRIORITY_TIERS[CHAKRA_PRIORITY_TIERS.length - 1];
};

export default function CardEnergyMap({
  status: _status,
  organSectionTitle,
  sex,
  showOnlyMale = false,
  organValues,
  chakraValues,
  metricValues,
}: CardEnergyMapProps) {
  const anthroposSlidersRef = useRef<HTMLDivElement>(null);
  const padmasanaSlidersRef = useRef<HTMLDivElement>(null);
  const [anthroposSlidersHeight, setAnthroposSlidersHeight] = useState<number | null>(null);
  const [padmasanaSlidersHeight, setPadmasanaSlidersHeight] = useState<number | null>(null);
  const resolvedSex = sex ?? DEFAULT_SEX;
  const resolvedShowOnlyMale = Boolean(showOnlyMale);
  const effectiveShowOnlyMale = resolvedSex === "female" ? false : resolvedShowOnlyMale;
  const resolvedSectionTitle = organSectionTitle ?? "Organs";
  void _status;

  const organValueMap = useMemo(() => {
    const map = new Map<string, number>();
    if (organValues) {
      for (const [key, raw] of Object.entries(organValues)) {
        const normalized = clampToPercent(raw);
        if (normalized !== null) {
          map.set(key, normalized);
        }
      }
    }
    return map;
  }, [organValues]);

  const chakraValueMap = useMemo(() => {
    const map = new Map<string, number>();
    if (chakraValues) {
      for (const [key, raw] of Object.entries(chakraValues)) {
        const normalized = clampToPercent(raw);
        if (normalized !== null) {
          map.set(key, normalized);
        }
      }
    }
    return map;
  }, [chakraValues]);

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") {
      setAnthroposSlidersHeight(null);
      return;
    }
    const element = anthroposSlidersRef.current;
    if (!element) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setAnthroposSlidersHeight(entry.contentRect.height);
      }
    });
    observer.observe(element);
    setAnthroposSlidersHeight(element.getBoundingClientRect().height);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") {
      setPadmasanaSlidersHeight(null);
      return;
    }
    const element = padmasanaSlidersRef.current;
    if (!element) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setPadmasanaSlidersHeight(entry.contentRect.height);
      }
    });
    observer.observe(element);
    setPadmasanaSlidersHeight(element.getBoundingClientRect().height);
    return () => observer.disconnect();
  }, []);

  const layerMetrics = useMemo<LayerMetric[]>(() => {
    return LAYER_DEFINITIONS.map((definition) => {
      if (!shouldIncludeLayer(definition, resolvedSex, effectiveShowOnlyMale)) {
        return null;
      }

      const baseElement = BASE_LAYER_ELEMENTS[definition.id];
      if (!baseElement) {
        if (import.meta.env?.DEV) {
          console.warn(`Missing base layer element for id "${definition.id}".`);
        }
        return null;
      }

      const isStructure = definition.category === "structure";
      const providedValue = isStructure ? 100 : organValueMap.get(definition.id);
      const hasValue = isStructure || organValueMap.has(definition.id);
      const clampedValue = isStructure ? 100 : providedValue ?? 0;
      const normalizedValue = Math.max(0, Math.min(100, clampedValue));
      const priority = isStructure ? null : getPriorityForValue(normalizedValue);
      const metricColor = isStructure ? STRUCTURE_COLOR : hasValue ? priority!.color : "#9CA3AF";
      const opacity = isStructure ? 1 : clampOpacity(normalizedValue / 100);

      const elementProps: Record<string, unknown> = {
        key: definition.id,
        opacity,
      };

      if (isStructure) {
        elementProps.stroke = STRUCTURE_COLOR;
        elementProps.fill = "none";
      } else {
        elementProps.fill = metricColor;
      }

      const styledElement = React.cloneElement(baseElement, elementProps);

      return {
        ...definition,
        element: styledElement,
        color: metricColor,
        value: normalizedValue,
        opacity,
        priorityLabel: isStructure ? "" : hasValue ? priority!.label : "Not Provided",
        hasValue,
      } as LayerMetric;
    }).filter((metric): metric is LayerMetric => metric !== null);
  }, [effectiveShowOnlyMale, organValueMap, resolvedSex]);

  const anthroposSliderMetrics = useMemo(() => {
    const metrics = layerMetrics.filter((metric) => metric.category !== "structure");
    metrics.sort((a, b) => {
      if (a.hasValue !== b.hasValue) {
        return a.hasValue ? -1 : 1;
      }
      if (a.hasValue && b.hasValue && a.value !== b.value) {
        return b.value - a.value;
      }
      const orderA = ORGAN_ORDER_INDEX.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const orderB = ORGAN_ORDER_INDEX.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) {
        return orderA - orderB;
      }
      return a.name.localeCompare(b.name);
    });
    return metrics;
  }, [layerMetrics]);

  const padmasanaSliderMetrics = useMemo(
    () =>
      CHAKRA_POINTS.map((chakra) => {
        const value = chakraValueMap.get(chakra.id) ?? 0;
        const hasValue = chakraValueMap.has(chakra.id);
        const priority = getChakraPriorityForValue(value);
        const baseColor = CHAKRA_BASE_COLORS[chakra.id] ?? priority.color;
        return {
          ...chakra,
          value,
          color: hasValue ? priority.color : "#9CA3AF",
          priorityLabel: hasValue ? priority.label : "Not Provided",
          hasValue,
          baseColor,
        };
      }),
    [chakraValueMap],
  );

  const metricCardStates = useMemo<MetricCardState[]>(() => {
    return METRIC_CARD_DEFINITIONS.map((definition) => {
      const raw = metricValues?.[definition.id] as MetricValueInput | number | null | undefined;
      let rawValue: number | null | undefined;
      let rawLabel: string | null = null;
      let rawName: string | null = null;

      if (typeof raw === "number") {
        rawValue = raw;
      } else if (raw && typeof raw === "object") {
        if ("value" in raw) {
          rawValue = raw.value;
        }
        if ("label" in raw && raw.label != null) {
          rawLabel = String(raw.label);
        }
        if ("name" in raw && raw.name != null) {
          rawName = String(raw.name);
        }
      }

      const normalizedValue = clampToPercent(rawValue);
      const hasValue = normalizedValue !== null;
      const priority = hasValue ? getPriorityForValue(normalizedValue) : null;
      const displayLabel = rawLabel ?? (hasValue && priority ? priority.label : null);
      const displayName = rawName ?? definition.title;

      return {
        ...definition,
        name: displayName,
        value: normalizedValue,
        label: displayLabel,
        color: hasValue && priority ? priority.color : "#ffffff33",
        hasValue,
      };
    });
  }, [metricValues]);

  const silhouetteScale = 16 / 15;
  const anthroposSilouhetteStyle: React.CSSProperties | undefined =
    anthroposSlidersHeight != null
      ? {
          height: anthroposSlidersHeight * silhouetteScale + 8,
          minHeight: anthroposSlidersHeight * silhouetteScale + 8,
        }
      : undefined;
  const padmasanaSilouhetteStyle: React.CSSProperties | undefined =
    padmasanaSlidersHeight != null
      ? {
          height: (padmasanaSlidersHeight * silhouetteScale + 8) * (16 / 15) - 3,
          minHeight: (padmasanaSlidersHeight * silhouetteScale + 8) * (16 / 15) - 3,
        }
      : undefined;


  return (
    <div className="flex h-full flex-col gap-6 rounded-2xl bg-bg-card px-8 py-9 shadow-card">
      <div className="grid gap-5 md:grid-cols-4 md:grid-rows-[auto_minmax(0,1fr)] md:gap-6 min-h-0">
        <div className="anthropos-card flex h-full md:row-span-2">
          <div
            className="anthropos-silouhette flex w-full items-center justify-center rounded-2xl bg-white/5 px-4 py-6 md:self-stretch"
            style={anthroposSilouhetteStyle}
          >
            <svg
              viewBox={VIEWBOX.body}
              xmlns="http://www.w3.org/2000/svg"
              preserveAspectRatio="xMidYMid meet"
              className="h-auto w-full max-w-[280px] overflow-visible sm:max-w-[300px] md:h-full md:w-auto md:max-h-full"
              role="img"
              aria-label="Anthropos silouhette"
            >
              {layerMetrics.map((layer) => layer.element)}
            </svg>
          </div>
        </div>

        <div className="anthropos-sliders h-full md:row-span-2">
          <div
            ref={anthroposSlidersRef}
            className="flex flex-col gap-2.5 rounded-2xl bg-white/5 px-6 py-6 md:self-stretch"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold uppercase tracking-wide text-text-tertiary">{resolvedSectionTitle}</span>
              <span className="text-sm text-text-tertiary">Value</span>
            </div>

            <div className="flex flex-col gap-2.5">
              {anthroposSliderMetrics.map((metric) => (
                <div key={`anthropos-slider-${metric.id}`} className="anthropos-slider flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium uppercase tracking-wide" style={{ color: metric.color }}>
                      {metric.name}
                    </span>
                    <div className="flex items-center justify-end gap-0.5 text-right">
                      <span className="text-right font-medium uppercase tracking-wide" style={{ color: metric.color }}>
                        {metric.priorityLabel}
                      </span>
                      <span className="w-8 text-right font-medium uppercase tracking-wide tabular-nums" style={{ color: metric.color }}>
                        {metric.hasValue ? metric.value : "—"}
                      </span>
                    </div>
                  </div>
                  <div
                    role="img"
                    aria-label={`${metric.name}: ${metric.hasValue ? metric.value : "not provided"} (${metric.priorityLabel})`}
                    className="anthropos-slider-track relative h-2 w-full overflow-hidden rounded-full bg-white/10"
                  >
                    <div
                      className="anthropos-slider-fill absolute inset-y-0 left-0 rounded-full"
                      style={{
                        width: `${metric.hasValue ? metric.value : 0}%`,
                        backgroundColor: metric.hasValue ? metric.color : "#ffffff33",
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="padmasana-card flex h-full md:col-start-3">
          <div
            className="padmasana-silouhette flex w-full items-center justify-center rounded-2xl bg-white/5 px-3 py-6 md:self-stretch"
            style={padmasanaSilouhetteStyle}
          >
            <svg
              viewBox={VIEWBOX.chakra}
              xmlns="http://www.w3.org/2000/svg"
              preserveAspectRatio="xMidYMid meet"
              className="h-auto w-full overflow-visible md:h-full md:w-full md:max-h-full"
              role="img"
              aria-label="Padmasana silouhette"
            >
              <defs>
                <filter id="chakra-glow-blur" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="6" />
                </filter>
              </defs>
              {React.cloneElement(PADMASANA_OUTLINE, {
                key: "padmasana-outline",
                stroke: STRUCTURE_COLOR,
                fill: "none",
                opacity: 1,
              })}
              {padmasanaSliderMetrics.map((chakra) => {
                const baseColor = chakra.baseColor ?? chakra.color;
                const outlineColor = chakra.color;
                const glowRadius = CHAKRA_RADIUS * 2.1;
                const normalized = chakra.hasValue ? chakra.value / 100 : 0;
                const intensity = chakra.hasValue ? Math.max(0.35, normalized) : 0.2;
                const glowOpacity = chakra.hasValue ? 0.18 + intensity * 0.32 : 0.12;
                const fillOpacity = chakra.hasValue ? 0.85 : 0.35;
                const strokeOpacity = chakra.hasValue ? 0.82 : 0.4;
                const isNeutral = chakra.hasValue && chakra.priorityLabel.toLowerCase() === "neutral";
                const outlineStrokeWidth = chakra.hasValue && !isNeutral ? 12 : 4;
                const baseInnerRadius = CHAKRA_RADIUS + 3 - 2; // base radius minus half of default stroke
                const outlineRadius = baseInnerRadius + outlineStrokeWidth / 2;
                return (
                  <g key={chakra.id} id={chakra.id}>
                    <title>{`${chakra.name}: ${chakra.hasValue ? chakra.value : "not provided"} (${chakra.priorityLabel})`}</title>
                    <circle
                      cx={chakra.cx}
                      cy={chakra.cy}
                      r={glowRadius}
                      fill={outlineColor}
                      opacity={glowOpacity}
                      filter="url(#chakra-glow-blur)"
                      aria-hidden="true"
                    />
                    <circle
                      cx={chakra.cx}
                      cy={chakra.cy}
                      r={CHAKRA_RADIUS}
                      fill={baseColor}
                      opacity={fillOpacity}
                      aria-label={`${chakra.name} activation`}
                    />
                    <circle
                      cx={chakra.cx}
                      cy={chakra.cy}
                      r={outlineRadius}
                      fill="none"
                      stroke={outlineColor}
                      strokeWidth={outlineStrokeWidth}
                      opacity={strokeOpacity}
                    />
                  </g>
                );
              })}
            </svg>
          </div>
        </div>

        <div className="padmasana-sliders h-full md:col-start-4">
          <div
            ref={padmasanaSlidersRef}
            className="flex flex-col gap-2.5 rounded-2xl bg-white/5 px-6 py-6 md:self-stretch"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold uppercase tracking-wide text-text-tertiary">Chakras</span>
              <span className="text-sm text-text-tertiary">Value</span>
            </div>

            <div className="flex flex-col gap-2">
              {padmasanaSliderMetrics.map((chakra) => (
                <div key={`padmasana-slider-${chakra.id}`} className="padmasana-slider flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium uppercase tracking-wide" style={{ color: chakra.color }}>
                      {chakra.name}
                    </span>
                    <div className="flex items-center justify-end gap-1 text-right">
                      <span className="font-medium uppercase tracking-wide" style={{ color: chakra.color }}>
                        {chakra.priorityLabel}
                      </span>
                      <span className="w-8 text-right font-medium uppercase tracking-wide tabular-nums" style={{ color: chakra.color }}>
                        {chakra.hasValue ? chakra.value : "—"}
                      </span>
                    </div>
                  </div>
                  <div
                    role="img"
                    aria-label={`${chakra.name}: ${chakra.hasValue ? chakra.value : "not provided"} (${chakra.priorityLabel})`}
                    className="padmasana-slider-track relative h-2 w-full overflow-hidden rounded-full bg-white/10"
                  >
                    <div
                      className="padmasana-slider-fill absolute inset-y-0 left-0 rounded-full"
                      style={{
                        width: `${chakra.hasValue ? chakra.value : 0}%`,
                        backgroundColor: chakra.hasValue ? chakra.color : "#ffffff33",
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {metricCardStates.map((metric) => {
          const progress = metric.value ?? 0;
          const pieStyle: React.CSSProperties | undefined = metric.hasValue
            ? {
                backgroundImage: `conic-gradient(${metric.color} ${progress}%, rgba(255,255,255,0.08) ${progress}% 100%)`,
              }
            : undefined;

          return (
            <div key={metric.id} className={metric.gridClass}>
              <div className="flex h-full flex-col gap-4 rounded-2xl bg-white/5 p-6 backdrop-blur">
                <span className="text-sm font-semibold uppercase tracking-wide text-text-tertiary">{metric.name}</span>
                {metric.hasValue ? (
                  <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
                    <div
                      className="relative flex h-36 w-36 items-center justify-center rounded-full bg-white/10"
                      style={pieStyle}
                      role="img"
                      aria-label={`${metric.name}: ${progress} (${metric.label ?? "No label"})`}
                    >
                      <div className="flex h-24 w-24 flex-col items-center justify-center rounded-full bg-bg-card text-center shadow-inner">
                        <span className="text-3xl font-bold text-text-primary">{progress}</span>
                      </div>
                    </div>
                    {metric.label && (
                      <span className="text-xs uppercase tracking-wide text-text-secondary">{metric.label}</span>
                    )}
                  </div>
                ) : (
                  <div className="flex h-14 items-center justify-center rounded-[30px] bg-white/10 text-center text-text-secondary">
                    <span className="text-sm uppercase tracking-wide">No data</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export { getPriorityForValue, clampOpacity };
