import React from "react";
import { useThresholdLimitValue, useVisibleSeverities } from "../../hooks/useThresholdSettings";
import type { GeneralSeverity } from "../../shared/priority";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";

export type FoodSeverity = "high" | "moderate" | "medium" | "low";

export interface FoodItem {
  name: string;
  score: number;
  severity: FoodSeverity;
}

export interface FoodCategoryCardProps {
  category: string;
  icon: React.ReactNode;
  items: FoodItem[];
}

const SEVERITY_COLORS: Record<FoodSeverity, string> = {
  high: "#E63946",
  moderate: "#FF8A00",
  medium: "#FFC300",
  low: "#43AA8B",
};

const SEVERITY_BG: Record<FoodSeverity, string> = {
  high: "bg-priority-high/20",
  moderate: "bg-priority-moderate/20",
  medium: "bg-priority-medium/20",
  low: "bg-priority-low/20",
};

const SEVERITY_TEXT: Record<FoodSeverity, string> = {
  high: "text-priority-high",
  moderate: "text-priority-moderate",
  medium: "text-priority-medium",
  low: "text-priority-low",
};

const DISPLAY_ORDER: FoodSeverity[] = ["high", "moderate", "medium", "low"];

export const FOOD_SEVERITY_TO_GENERAL: Record<FoodSeverity, GeneralSeverity> = {
  high: "high",
  moderate: "moderate",
  medium: "normal",
  low: "low",
};

export const FOOD_REACTION_LEGEND = DISPLAY_ORDER.map((severity) => ({
  severity,
  label: severity.charAt(0).toUpperCase() + severity.slice(1),
  color: SEVERITY_COLORS[severity],
}));

const formatCategoryLabel = (label: string): string[] => {
  const canonical = label.toLowerCase();
  if (canonical === "nuts & seeds") {
    return ["Nuts &", "Seeds"];
  }
  if (canonical === "heavy metals") {
    return ["Heavy", "Metals"];
  }
  return [label];
};

export default function FoodCategoryCard({ category, icon, items }: FoodCategoryCardProps) {
  const limit = useThresholdLimitValue();
  const visibleSeverities = useVisibleSeverities();
  const visibleSet = new Set(visibleSeverities);

  const groupedItems = items.reduce<Record<FoodSeverity, FoodItem[]>>((acc, item) => {
    if (!acc[item.severity]) {
      acc[item.severity] = [];
    }
    acc[item.severity].push(item);
    return acc;
  }, { high: [], moderate: [], medium: [], low: [] });

  const chartData = DISPLAY_ORDER.map((severity) => ({
    name: severity,
    value: groupedItems[severity].length,
    color: SEVERITY_COLORS[severity],
  })).filter((entry) => entry.value > 0);

  const pillSections = DISPLAY_ORDER.reduce<React.ReactElement[]>((acc, severity) => {
    const severityItems = groupedItems[severity];
    const general = FOOD_SEVERITY_TO_GENERAL[severity];
    if (!severityItems.length || !visibleSet.has(general)) {
      return acc;
    }
    acc.push(
      <div key={severity} className="flex flex-wrap gap-3 md:gap-4">
        {severityItems.slice(0, limit).map((item) => (
          <div
            key={`${item.name}-${item.score}`}
            className={`flex h-14 items-center rounded-[30px] px-4 md:px-6 ${SEVERITY_BG[severity]}`}
          >
            <span className={`whitespace-nowrap text-left text-xl font-normal md:text-[28px] ${SEVERITY_TEXT[severity]}`}>
              {item.name} {Math.round(item.score)}
            </span>
          </div>
        ))}
      </div>,
    );
    return acc;
  }, []);

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:gap-6 md:items-start">
      <div className="rounded-[32px] bg-white/5 p-4 backdrop-blur md:p-6">
        <div className="flex min-w-0 flex-col gap-4 md:gap-5">
          {pillSections.length ? (
            pillSections
          ) : (
            <span className="text-sm text-text-secondary">No visible items.</span>
          )}
        </div>
      </div>
      <div className="rounded-[32px] bg-white/5 p-4 backdrop-blur md:p-6 w-fit justify-self-center md:justify-self-end">
        <div className="flex items-center justify-center">
          {chartData.length ? (
            <div className="relative h-[268px] w-[271px]">
              <ResponsiveContainer width="100%" height="100%" className="pointer-events-none">
                <PieChart>
                  <Pie
                    data={chartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={95}
                    outerRadius={100}
                    paddingAngle={2}
                    dataKey="value"
                    stroke="none"
                    isAnimationActive={false}
                  >
                    {chartData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} opacity={0.9} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-4 text-center">
                {icon}
                <span className="text-3xl font-bold leading-snug text-text-primary">
                  {formatCategoryLabel(category).map((line, idx, arr) => (
                    <React.Fragment key={`${line}-${idx}`}>
                      {line}
                      {idx < arr.length - 1 && <br />}
                    </React.Fragment>
                  ))}
                </span>
              </div>
            </div>
          ) : (
            <span className="text-sm text-text-secondary">No data available.</span>
          )}
        </div>
      </div>
    </div>
  );
}
