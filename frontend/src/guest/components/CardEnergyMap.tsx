import React, { useEffect, useMemo, useRef, useState } from "react";
import { BASE_LAYER_ELEMENTS } from "./energyMap/layers";
import { PADMASANA_OUTLINE, PADMASANA_VIEWBOX } from "./energyMap/padmasana";

export type EnergyStatus = "Stable" | "Imbalanced";

type Sex = "male" | "female";

interface CardEnergyMapProps {
  status: EnergyStatus;
  activeNodes?: number[];
  organSectionTitle?: string;
  sex?: Sex;
  showOnlyMale?: boolean;
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
}

const VIEWBOX = {
  body: "0 0 293 706",
  chakra: PADMASANA_VIEWBOX,
} as const;

const BAR_HEIGHT = 8;
const BAR_GAP = 6;
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

const STRUCTURE_COLOR = "#06B6D4";

export interface PeakPriorityTier {
  label: string;
  color: string;
  min: number;
  range: string;
}

export const PEAK_PRIORITY_TIERS: PeakPriorityTier[] = [
  { label: "Very High", color: "#EF4444", min: 91, range: "91 – 100" },
  { label: "High", color: "#F97316", min: 76, range: "76 – 90" },
  { label: "Neutral", color: "#9CA3AF", min: 26, range: "26 – 75" },
  { label: "Low", color: "#22C55E", min: 11, range: "11 – 25" },
  { label: "Very Low", color: "#0EA5E9", min: 0, range: "0 – 10" },
];

const clampOpacity = (value: number) => Math.max(MIN_OPACITY, Math.min(1, value));

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

const getLayerValue = (index: number, highlighted: boolean) => {
  const base = 48 + (index % 5) * 7;
  return Math.max(10, Math.min(100, base + (highlighted ? 28 : 0)));
};

const getChakraValue = (index: number, highlighted: boolean) => {
  const base = 40 + (index % 4) * 10;
  return Math.max(10, Math.min(100, base + (highlighted ? 32 : 0)));
};

export default function CardEnergyMap({
  status: _status,
  activeNodes = [],
  organSectionTitle,
  sex,
  showOnlyMale = false,
}: CardEnergyMapProps) {
  const anthroposSlidersRef = useRef<HTMLDivElement>(null);
  const padmasanaSlidersRef = useRef<HTMLDivElement>(null);
  const [anthroposSlidersHeight, setAnthroposSlidersHeight] = useState<number | null>(null);
  const [padmasanaSlidersHeight, setPadmasanaSlidersHeight] = useState<number | null>(null);
  const resolvedSex = sex ?? DEFAULT_SEX;
  const resolvedShowOnlyMale = Boolean(showOnlyMale);
  const effectiveShowOnlyMale = resolvedSex === "female" ? false : resolvedShowOnlyMale;
  const resolvedSectionTitle = organSectionTitle ?? "Organs";
  const activeChakraSet = useMemo(() => new Set(activeNodes), [activeNodes]);

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
    const chakraCount = CHAKRA_POINTS.length || 1;
    return LAYER_DEFINITIONS.map((definition, index) => {
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

      const highlighted = activeChakraSet.has(index % chakraCount);
      const value = getLayerValue(index, highlighted);
      const opacity =
        definition.category === "structure"
          ? 1
          : clampOpacity(value / 100);
      const priority = getPriorityForValue(value);
      const rawColor = definition.category === "structure" ? STRUCTURE_COLOR : priority.color;

      const elementProps: Record<string, unknown> = {
        key: definition.id,
        opacity,
      };

      if (definition.category === "structure") {
        elementProps.stroke = rawColor;
        elementProps.fill = "none";
      } else {
        elementProps.fill = rawColor;
      }

      const styledElement = React.cloneElement(baseElement, elementProps);

      return {
        ...definition,
        element: styledElement,
        color: rawColor,
        value,
        opacity,
        priorityLabel: priority.label,
      } as LayerMetric;
    }).filter((metric): metric is LayerMetric => metric !== null);
  }, [activeChakraSet, resolvedSex, effectiveShowOnlyMale]);

  const anthroposSliderMetrics = useMemo(() => {
    const metrics = layerMetrics.filter((metric) => metric.category !== "structure");
    metrics.sort((a, b) => {
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
      CHAKRA_POINTS.map((chakra, index) => {
        const isActive = activeChakraSet.has(index);
        const value = getChakraValue(index, isActive);
        const priority = getPriorityForValue(value);
        return {
          ...chakra,
          value,
          color: priority.color,
          priorityLabel: priority.label,
          isActive,
        };
      }),
    [activeChakraSet],
  );

  const anthroposSilouhetteStyle: React.CSSProperties | undefined =
    anthroposSlidersHeight != null
      ? { height: anthroposSlidersHeight, minHeight: anthroposSlidersHeight }
      : undefined;
  const padmasanaSilouhetteStyle: React.CSSProperties | undefined =
    padmasanaSlidersHeight != null
      ? { height: padmasanaSlidersHeight, minHeight: padmasanaSlidersHeight }
      : undefined;

  return (
    <div className="flex h-full flex-col gap-6 rounded-2xl bg-bg-card px-8 py-9 shadow-card">
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-5 md:flex-row md:items-stretch md:gap-8">
          <div className="anthropos-card flex w-full md:flex-1">
            <div
              className="anthropos-silouhette flex w-full items-center justify-center rounded-2xl bg-white/5 px-6 py-6 md:self-stretch"
              style={anthroposSilouhetteStyle}
            >
              <svg
                viewBox={VIEWBOX.body}
                xmlns="http://www.w3.org/2000/svg"
                preserveAspectRatio="xMidYMid meet"
                className="h-auto w-full max-w-[320px] overflow-visible sm:max-w-[360px] md:h-full md:w-auto md:max-h-full"
                role="img"
                aria-label="Anthropos silouhette"
              >
                {layerMetrics.map((layer) => layer.element)}
              </svg>
            </div>
          </div>

          <div className="anthropos-sliders w-full md:w-[240px] lg:w-[280px]">
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
                    <div className="flex items-center justify-between text-sm text-text-secondary">
                      <span className="font-medium uppercase tracking-wide">{metric.name}</span>
                      <div className="flex items-baseline gap-2 text-right">
                        <span className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">{metric.priorityLabel}</span>
                        <span className="text-sm font-semibold text-text-primary">{metric.value}</span>
                      </div>
                    </div>
                    <div
                      role="img"
                      aria-label={`${metric.name}: ${metric.value} (${metric.priorityLabel})`}
                      className="anthropos-slider-track relative h-2 w-full overflow-hidden rounded-full bg-white/10"
                    >
                      <div
                        className="anthropos-slider-fill absolute inset-y-0 left-0 rounded-full"
                        style={{ width: `${metric.value}%`, backgroundColor: metric.color }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-5 md:flex-row md:items-stretch md:gap-8">
          <div className="padmasana-card flex w-full md:flex-1">
            <div
              className="padmasana-silouhette flex w-full items-center justify-center rounded-2xl bg-white/5 px-6 py-6 md:self-stretch"
              style={padmasanaSilouhetteStyle}
            >
              <svg
                viewBox={VIEWBOX.chakra}
                xmlns="http://www.w3.org/2000/svg"
                preserveAspectRatio="xMidYMid meet"
                className="h-auto w-full max-w-[320px] sm:max-w-[360px] md:h-full md:w-auto md:max-h-full"
                role="img"
                aria-label="Padmasana silouhette"
              >
                {React.cloneElement(PADMASANA_OUTLINE, {
                  key: "padmasana-outline",
                  stroke: STRUCTURE_COLOR,
                  fill: "none",
                  opacity: 1,
                })}
                {padmasanaSliderMetrics.map((chakra) => (
                  <g key={chakra.id} id={chakra.id}>
                    <title>{`${chakra.name}: ${chakra.value} (${chakra.priorityLabel})`}</title>
                    <circle
                      cx={chakra.cx}
                      cy={chakra.cy}
                      r={CHAKRA_RADIUS}
                      fill={chakra.color}
                      opacity={Math.max(0.35, chakra.value / 100)}
                      aria-label={`${chakra.name} activation`}
                    />
                  </g>
                ))}
              </svg>
            </div>
          </div>

          <div className="padmasana-sliders w-full md:w-[240px] lg:w-[280px]">
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
                    <div className="flex items-center justify-between text-sm text-text-secondary">
                      <span className="font-medium uppercase tracking-wide">{chakra.name}</span>
                      <div className="flex items-baseline gap-2 text-right">
                        <span className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">{chakra.priorityLabel}</span>
                        <span className="text-sm font-semibold text-text-primary">{chakra.value}</span>
                      </div>
                    </div>
                    <div
                      role="img"
                      aria-label={`${chakra.name}: ${chakra.value} (${chakra.priorityLabel})`}
                      className="padmasana-slider-track relative h-2 w-full overflow-hidden rounded-full bg-white/10"
                    >
                      <div
                        className="padmasana-slider-fill absolute inset-y-0 left-0 rounded-full"
                        style={{ width: `${chakra.value}%`, backgroundColor: chakra.color }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export { getPriorityForValue, clampOpacity };
