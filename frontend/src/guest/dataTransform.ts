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

const CARD_ENERGY_ORGAN_IDS = [
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

const CARD_ENERGY_ORGAN_ID_SET = new Set<string>(CARD_ENERGY_ORGAN_IDS);

const PEEK_ORGAN_NAME_MAP: Record<string, string> = {
  brain: "brain",
  "brain cns": "brain",
  cns: "brain",
  thyroid: "thyroid",
  parathyroid: "thyroid",
  "thyroid parathyroid": "thyroid",
  lung: "lungs",
  lungs: "lungs",
  bronchi: "lungs",
  bronchial: "lungs",
  "lungs bronchi": "lungs",
  heart: "heart",
  lymph: "lymphatic",
  lymphatic: "lymphatic",
  lymphatics: "lymphatic",
  "lymphatic system": "lymphatic",
  "lymphatic immune": "lymphatic",
  "immune system": "lymphatic",
  liver: "liver",
  spleen: "spleen",
  "spleen pancreas": "spleen",
  pancreas: "spleen",
  stomach: "stomach",
  "gall bladder": "gallbladder",
  gallbladder: "gallbladder",
  kidney: "kidneys",
  kidneys: "kidneys",
  "kidney bladder": "kidneys",
  "small intestine": "small_intestine",
  si: "small_intestine",
  duodenum: "small_intestine",
  jejunum: "small_intestine",
  ileum: "small_intestine",
  "large intestine": "large_intestine",
  colon: "large_intestine",
  li: "large_intestine",
  bladder: "bladder",
  "urinary bladder": "bladder",
  "san-jiao": "lymphatic",
  "san jiao": "lymphatic",
  sanjiao: "lymphatic",
  "triple burner": "lymphatic",
  prostate: "reproductive_male",
  testes: "reproductive_male",
  testicles: "reproductive_male",
  "male reproductive": "reproductive_male",
  "reproductive male": "reproductive_male",
  uterus: "reproductive_female",
  ovary: "reproductive_female",
  ovaries: "reproductive_female",
  endometrium: "reproductive_female",
  "female reproductive": "reproductive_female",
  "reproductive female": "reproductive_female",
};

const normalizePeekOrganId = (raw: string): string | null => {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const tryLookup = (candidate: string): string | null => {
    const key = candidate.toLowerCase();
    if (PEEK_ORGAN_NAME_MAP[key]) {
      return PEEK_ORGAN_NAME_MAP[key];
    }
    if (CARD_ENERGY_ORGAN_ID_SET.has(key)) {
      return key;
    }
    return null;
  };

  const dropParens = (input: string) => input.replace(/\(.*?\)/g, "").trim();
  const canonicalize = (input: string) => input.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

  const direct = tryLookup(trimmed);
  if (direct) return direct;

  const withoutPrefix = trimmed.replace(/^organs?\b[:\s\-–—>›|]*/i, "").trim();
  if (!withoutPrefix) {
    return null;
  }

  const baseCandidates = [withoutPrefix, dropParens(withoutPrefix)];
  for (const candidate of baseCandidates) {
    const lookedUp = tryLookup(candidate);
    if (lookedUp) return lookedUp;

    const canonicalId = canonicalize(candidate.toLowerCase());
    if (canonicalId && CARD_ENERGY_ORGAN_ID_SET.has(canonicalId)) {
      return canonicalId;
    }
  }

  const tokenSource = dropParens(withoutPrefix.toLowerCase());
  const tokens = tokenSource.split(/[^a-z0-9]+/).filter(Boolean);
  for (const token of tokens) {
    const alias = PEEK_ORGAN_NAME_MAP[token];
    if (alias) {
      return alias;
    }
  }

  if (tokens.includes("reproductive")) {
    if (tokens.includes("male")) return "reproductive_male";
    if (tokens.includes("female")) return "reproductive_female";
  }

  return null;
};

const CHAKRA_IDS = [
  "Chakra_01_Root",
  "Chakra_02_Sacral",
  "Chakra_03_SolarPlexus",
  "Chakra_04_Heart",
  "Chakra_05_Throat",
  "Chakra_06_ThirdEye",
  "Chakra_07_Crown",
] as const;

const CHAKRA_ALIAS_MAP: Record<string, string> = {
  "chakra 1": CHAKRA_IDS[0],
  "chakra1": CHAKRA_IDS[0],
  "chakra-1": CHAKRA_IDS[0],
  "1": CHAKRA_IDS[0],
  "01": CHAKRA_IDS[0],
  root: CHAKRA_IDS[0],
  "root chakra": CHAKRA_IDS[0],
  "chakra 2": CHAKRA_IDS[1],
  "chakra2": CHAKRA_IDS[1],
  "chakra-2": CHAKRA_IDS[1],
  "2": CHAKRA_IDS[1],
  "02": CHAKRA_IDS[1],
  sacral: CHAKRA_IDS[1],
  "sacral chakra": CHAKRA_IDS[1],
  "chakra 3": CHAKRA_IDS[2],
  "chakra3": CHAKRA_IDS[2],
  "chakra-3": CHAKRA_IDS[2],
  "3": CHAKRA_IDS[2],
  "03": CHAKRA_IDS[2],
  "solar plexus": CHAKRA_IDS[2],
  "solar plexus chakra": CHAKRA_IDS[2],
  "chakra 4": CHAKRA_IDS[3],
  "chakra4": CHAKRA_IDS[3],
  "chakra-4": CHAKRA_IDS[3],
  "4": CHAKRA_IDS[3],
  "04": CHAKRA_IDS[3],
  heart: CHAKRA_IDS[3],
  "heart chakra": CHAKRA_IDS[3],
  "chakra 5": CHAKRA_IDS[4],
  "chakra5": CHAKRA_IDS[4],
  "chakra-5": CHAKRA_IDS[4],
  "5": CHAKRA_IDS[4],
  "05": CHAKRA_IDS[4],
  throat: CHAKRA_IDS[4],
  "throat chakra": CHAKRA_IDS[4],
  "chakra 6": CHAKRA_IDS[5],
  "chakra6": CHAKRA_IDS[5],
  "chakra-6": CHAKRA_IDS[5],
  "6": CHAKRA_IDS[5],
  "06": CHAKRA_IDS[5],
  indigo: CHAKRA_IDS[5],
  "third eye": CHAKRA_IDS[5],
  "third eye chakra": CHAKRA_IDS[5],
  "chakra 7": CHAKRA_IDS[6],
  "chakra7": CHAKRA_IDS[6],
  "chakra-7": CHAKRA_IDS[6],
  "7": CHAKRA_IDS[6],
  "07": CHAKRA_IDS[6],
  violet: CHAKRA_IDS[6],
  crown: CHAKRA_IDS[6],
  "crown chakra": CHAKRA_IDS[6],
};

const normalizePeekChakraId = (raw: string): string | null => {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  if (CHAKRA_ALIAS_MAP[lower]) {
    return CHAKRA_ALIAS_MAP[lower];
  }

  const withoutPrefix = lower.replace(/^chakra\b[:\s\-–—>›|]*/, "").trim();
  if (withoutPrefix && CHAKRA_ALIAS_MAP[withoutPrefix]) {
    return CHAKRA_ALIAS_MAP[withoutPrefix];
  }

  const base = withoutPrefix.replace(/\(.*?\)/g, "").trim();
  if (base && CHAKRA_ALIAS_MAP[base]) {
    return CHAKRA_ALIAS_MAP[base];
  }

  const numberMatch = base.match(/(\d+)/);
  if (numberMatch) {
    const idx = Number.parseInt(numberMatch[1], 10);
    if (Number.isFinite(idx) && idx >= 1 && idx <= CHAKRA_IDS.length) {
      return CHAKRA_IDS[idx - 1];
    }
  }

  for (const [alias, chakraId] of Object.entries(CHAKRA_ALIAS_MAP)) {
    if (base.includes(alias)) {
      return chakraId;
    }
  }

  return null;
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
      const organId = normalizePeekOrganId(key);
      if (!organId) continue;
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) continue;
      const clamped = Math.max(0, Math.min(100, Math.round(numeric)));
      sanitizedOrgans[organId] = clamped;
    }
  }

  if (energyMapRaw?.chakras) {
    for (const [key, value] of Object.entries(energyMapRaw.chakras)) {
      const chakraId = normalizePeekChakraId(key);
      if (!chakraId) continue;
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) continue;
      const clamped = Math.max(0, Math.min(100, Math.round(numeric)));
      sanitizedChakras[chakraId] = clamped;
    }
  }

  Object.values(sanitizedOrgans).forEach((value) =>
    incrementCounts(counts, classifyEnergySeverity(value)),
  );
  Object.values(sanitizedChakras).forEach((value) =>
    incrementCounts(counts, classifyEnergySeverity(value)),
  );
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
