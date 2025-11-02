export type RawFoodItem = {
  name: string;
  score?: number;
  severity?: string;
};

export type RawFoodCategory = {
  name: string;
  items: RawFoodItem[];
};

export type RawFoodPage = {
  page: number;
  section: string;
  categories: RawFoodCategory[];
};

export type RawFoodData = {
  pages: RawFoodPage[];
};

export type RawNutritionItem = {
  name: string;
  value: number;
};

export type RawNutritionData = {
  source_file?: string;
  item_count?: number;
  items: RawNutritionItem[];
};

export type RawHormoneItem = {
  name: string;
  value: number;
};

export type RawHormonesData = {
  source_file?: string;
  item_count?: number;
  items: RawHormoneItem[];
};

export type RawHeavyMetalItem = {
  name: string;
  value: number;
};

export type RawHeavyMetalsData = {
  source_file?: string;
  item_count?: number;
  items: RawHeavyMetalItem[];
};

export type RawToxinItem = {
  name: string;
  value: number;
};

export type RawToxinsData = {
  source_file?: string;
  item_count?: number;
  items: RawToxinItem[];
};

export type RawPeekData = {
  organs?: Record<string, number>;
  chakras?: Record<string, number>;
};
