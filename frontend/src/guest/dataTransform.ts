import type {
  FoodItem,
  FoodSeverity,
  HormoneItem,
  MetalItem,
  NutrientItem,
  NutritionData,
  ToxinItem,
} from "./components";
import type {
  RawFoodData,
  RawHeavyMetalsData,
  RawHormonesData,
  RawNutritionData,
  RawPeekData,
  RawToxinsData,
} from "./types";

const FOOD_CATEGORY_CANON: Record<string, string> = {
  dairy: "Dairy",
  eggs: "Eggs",
  fruits: "Fruits",
  fruit: "Fruits",
  grains: "Grains",
  grain: "Grains",
  legumes: "Legumes",
  meats: "Meats",
  meat: "Meats",
  nutsseeds: "Nuts & Seeds",
  "nuts&seeds": "Nuts & Seeds",
  "nuts seeds": "Nuts & Seeds",
  seafood: "Seafoods",
  seafoods: "Seafoods",
  fish: "Seafoods",
  vegetables: "Vegetables",
  vegetable: "Vegetables",
  wheat: "Wheat",
  heavymetals: "Heavy Metals",
  "heavy metals": "Heavy Metals",
  lectins: "Lectins",
};

export const FOOD_CATEGORY_ORDER = [
  "Dairy",
  "Eggs",
  "Fruits",
  "Grains",
  "Legumes",
  "Meats",
  "Nuts & Seeds",
  "Seafoods",
  "Vegetables",
  "Wheat",
  "Heavy Metals",
  "Lectins",
] as const;

const severityThresholds: Array<{ min: number; severity: FoodSeverity }> = [
  { min: 90, severity: "high" },
  { min: 80, severity: "moderate" },
  { min: 65, severity: "medium" },
  { min: 0, severity: "low" },
];

const toCanonical = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[\s&_-]+/g, "")
    .trim();

const toDisplayName = (name: string): string => {
  const canonical = toCanonical(name);
  if (FOOD_CATEGORY_CANON[canonical]) return FOOD_CATEGORY_CANON[canonical];

  // Fallback title-case split on spaces or camel-case
  const parts = name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean);
  return parts
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
};

export const classifySeverity = (score: number | undefined | null): FoodSeverity => {
  const value = Number.isFinite(score) ? Math.abs(Number(score)) : 0;
  for (const { min, severity } of severityThresholds) {
    if (value >= min) return severity;
  }
  return "low";
};

export const classifyHormoneSeverity = (score: number | undefined | null): "high" | "moderate" => {
  return classifySeverity(score) === "high" ? "high" : "moderate";
};

export function transformFoodData(raw: RawFoodData | null | undefined): Map<string, FoodItem[]> {
  const categories = new Map<string, FoodItem[]>();
  if (!raw?.pages?.length) {
    return categories;
  }

  for (const page of raw.pages) {
    for (const category of page.categories) {
      const displayName = toDisplayName(category.name || "Misc");
      const existing = categories.get(displayName) ?? [];
      for (const item of category.items) {
        if (typeof item.score !== "number") continue;
        const severity = (item.severity && ["high", "moderate", "medium", "low"].includes(item.severity))
          ? (item.severity as FoodSeverity)
          : classifySeverity(item.score);
        existing.push({
          name: item.name,
          score: item.score,
          severity,
        });
      }
      if (existing.length) {
        categories.set(displayName, existing);
      }
    }
  }
  return categories;
}

export function transformNutritionData(raw: RawNutritionData | null | undefined, limit = 10): NutritionData {
  const items: NutrientItem[] = (raw?.items ?? [])
    .map((item) => ({
      name: item.name.trim(),
      score: Number(item.value),
    }))
    .filter((item) => Number.isFinite(item.score))
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
    .slice(0, limit)
    .map((item) => ({ ...item, score: Math.round(item.score) }));

  return {
    note: items.length ? "" : undefined,
    nutrients: items,
  };
}

export function transformHeavyMetals(raw: RawHeavyMetalsData | null | undefined): MetalItem[] {
  return (raw?.items ?? [])
    .map((item) => ({
      name: item.name.trim(),
      score: Number(item.value),
    }))
    .filter((item) => Number.isFinite(item.score))
    .map((item) => ({
      ...item,
      severity: classifySeverity(item.score),
    }));
}

export function transformHormones(raw: RawHormonesData | null | undefined): HormoneItem[] {
  return (raw?.items ?? [])
    .map((item) => ({
      name: item.name.trim(),
      score: Number(item.value),
    }))
    .filter((item) => Number.isFinite(item.score))
    .map((item) => ({
      ...item,
      severity: classifyHormoneSeverity(item.score),
    }));
}

export function transformToxins(raw: RawToxinsData | null | undefined): ToxinItem[] {
  return (raw?.items ?? [])
    .map((item) => ({
      name: item.name.trim(),
      score: Number(item.value),
    }))
    .filter((item) => Number.isFinite(item.score))
    .map((item) => ({
      ...item,
      severity: classifySeverity(item.score),
    }));
}

export interface PriorityCounts {
  lowCount: number;
  mediumCount: number;
  moderateCount: number;
  highCount: number;
}

const incrementCounts = (counts: PriorityCounts, severity: FoodSeverity) => {
  if (severity === "high") counts.highCount += 1;
  else if (severity === "moderate") counts.moderateCount += 1;
  else if (severity === "medium") counts.mediumCount += 1;
  else counts.lowCount += 1;
};

export interface AggregatedInsights {
  categories: Array<{ name: string; items: FoodItem[] }>;
  nutrition: NutritionData;
  heavyMetals: MetalItem[];
  hormones: HormoneItem[];
  toxins: ToxinItem[];
  priorityCounts: PriorityCounts;
  overallScore: number;
  scoreStatus: string;
  topHighItems: Array<{ category: string; item: FoodItem }>;
  nextSteps: string[];
  energyMap: {
    organs: Record<string, number>;
    chakras: Record<string, number>;
  } | null;
}

export function aggregateInsights(
  foodMap: Map<string, FoodItem[]>,
  nutrition: NutritionData,
  heavyMetals: MetalItem[],
  hormones: HormoneItem[],
  toxins: ToxinItem[],
  energyMapRaw: RawPeekData | null,
): AggregatedInsights {
  const counts: PriorityCounts = { lowCount: 0, mediumCount: 0, moderateCount: 0, highCount: 0 };

  const categories: Array<{ name: string; items: FoodItem[] }> = [];

  const orderLookup = new Map<string, number>(FOOD_CATEGORY_ORDER.map((name, index) => [name, index]));
  const sortedKeys = Array.from(foodMap.keys()).sort((a, b) => {
    const aIndex = orderLookup.has(a) ? orderLookup.get(a)! : Number.MAX_SAFE_INTEGER;
    const bIndex = orderLookup.has(b) ? orderLookup.get(b)! : Number.MAX_SAFE_INTEGER;
    if (aIndex !== bIndex) return aIndex - bIndex;
    return a.localeCompare(b);
  });

  sortedKeys.forEach((key) => {
    const items = foodMap.get(key) ?? [];
    items.forEach((item) => incrementCounts(counts, item.severity));
    categories.push({ name: key, items: items.slice().sort((a, b) => b.score - a.score) });
  });

  heavyMetals.forEach((item) => incrementCounts(counts, item.severity));
  hormones.forEach((item) => incrementCounts(counts, item.severity === "high" ? "high" : "moderate"));
  toxins.forEach((item) => incrementCounts(counts, item.severity));
  const classifyEnergySeverity = (score: number | undefined | null): FoodSeverity => {
    const value = Number.isFinite(score) ? Math.max(0, Math.min(100, Number(score))) : 0;
    if (value >= 91) return "high";
    if (value >= 76) return "moderate";
    if (value >= 26) return "medium";
    return "low";
  };

  const sanitizedOrgans: Record<string, number> = {};
  const sanitizedChakras: Record<string, number> = {};

  if (energyMapRaw?.organs) {
    for (const [key, value] of Object.entries(energyMapRaw.organs)) {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        const clamped = Math.max(0, Math.min(100, Math.round(numeric)));
        sanitizedOrgans[key] = clamped;
        incrementCounts(counts, classifyEnergySeverity(clamped));
      }
    }
  }

  if (energyMapRaw?.chakras) {
    for (const [key, value] of Object.entries(energyMapRaw.chakras)) {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        const clamped = Math.max(0, Math.min(100, Math.round(numeric)));
        sanitizedChakras[key] = clamped;
        incrementCounts(counts, classifyEnergySeverity(clamped));
      }
    }
  }
  nutrition.nutrients.forEach((item) => incrementCounts(counts, classifySeverity(item.score)));

  const allScores: number[] = [];
  categories.forEach(({ items }) => items.forEach((item) => allScores.push(Math.abs(item.score))));
  heavyMetals.forEach((item) => allScores.push(Math.abs(item.score)));
  hormones.forEach((item) => allScores.push(Math.abs(item.score)));
  toxins.forEach((item) => allScores.push(Math.abs(item.score)));
  Object.values(sanitizedOrgans).forEach((value) => allScores.push(Math.abs(value)));
  Object.values(sanitizedChakras).forEach((value) => allScores.push(Math.abs(value)));

  const overallScore =
    allScores.length > 0 ? allScores.reduce((sum, value) => sum + value, 0) / allScores.length : 0;

  const scoreStatus =
    counts.highCount > 3 || overallScore >= 85
      ? "High Priority"
      : counts.moderateCount > 5 || overallScore >= 75
        ? "Moderate"
        : "Stable";

  const topHighItems: Array<{ category: string; item: FoodItem }> = [];
  categories.forEach(({ name, items }) => {
    items
      .filter((item) => item.severity === "high")
      .slice(0, 3)
      .forEach((item) => topHighItems.push({ category: name, item }));
  });

  heavyMetals
    .filter((item) => item.severity === "high")
    .slice(0, 2)
    .forEach((item) => topHighItems.push({ category: "Heavy Metals", item }));

  toxins
    .filter((item) => item.severity === "high")
    .slice(0, 2)
    .forEach((item) => topHighItems.push({ category: "Toxins", item }));

  const nextSteps = buildNextSteps(topHighItems, counts);

  const energyMap = Object.keys(sanitizedOrgans).length || Object.keys(sanitizedChakras).length
    ? {
        organs: sanitizedOrgans,
        chakras: sanitizedChakras,
      }
    : null;

  return {
    categories,
    nutrition,
    heavyMetals,
    hormones,
    toxins,
    priorityCounts: counts,
    overallScore,
    scoreStatus,
    topHighItems,
    nextSteps,
    energyMap,
  };
}

function buildNextSteps(topHighItems: Array<{ category: string; item: FoodItem }>, counts: PriorityCounts): string[] {
  const steps: string[] = [];

  if (topHighItems.length) {
    const focusByCategory = topHighItems.reduce<Record<string, string[]>>((acc, entry) => {
      acc[entry.category] = acc[entry.category] ?? [];
      if (acc[entry.category].length < 3) {
        acc[entry.category].push(entry.item.name);
      }
      return acc;
    }, {});

    const [primaryCategory, items] =
      Object.entries(focusByCategory).sort((a, b) => b[1].length - a[1].length)[0] ??
      (["priority foods", []] as [string, string[]]);

    steps.push(
      `Reduce exposure to ${primaryCategory.toLowerCase()} items such as ${items.join(", ")} over the next 7 days.`,
    );
  }

  if (counts.moderateCount > 0) {
    steps.push("Rotate moderate-priority foods and allow 72 hours before reintroducing them.");
  }

  if (counts.highCount === 0) {
    steps.push("Maintain hydration and continue current regimen to preserve stability.");
  } else {
    steps.push("Pair meals with supportive nutrients to offset inflammatory responses.");
  }

  return steps.slice(0, 3);
}
