import React from "react";
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

const SEVERITY_LABELS: Record<FoodSeverity, string> = {
  high: "High Reaction",
  moderate: "Moderate Reaction",
  medium: "Medium Reaction",
  low: "Low Reaction",
};

const DISPLAY_ORDER: FoodSeverity[] = ["high", "moderate", "medium", "low"];

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

  return (
    <div className="flex items-center gap-12 rounded-[32px] bg-white/5 p-6 backdrop-blur md:gap-16 md:p-8">
      <div className="relative flex h-[268px] w-[271px] flex-shrink-0 items-center justify-center">
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

      <div className="flex min-w-0 flex-1 flex-col gap-6 md:gap-8">
        {DISPLAY_ORDER.map((severity) => {
          const severityItems = groupedItems[severity];
          if (!severityItems.length) return null;

          return (
            <div key={severity} className="flex flex-col gap-4 md:gap-6">
              <h4 className="text-2xl font-normal text-white/60 md:text-[28px]">{SEVERITY_LABELS[severity]}</h4>
              <div className="flex flex-wrap items-center gap-4 md:gap-6">
                {severityItems.map((item) => (
                  <div
                    key={`${item.name}-${item.score}`}
                    className={`flex h-14 items-center justify-center rounded-[30px] px-4 md:px-6 ${SEVERITY_BG[severity]}`}
                  >
                    <span className={`whitespace-nowrap text-xl font-normal md:text-[28px] ${SEVERITY_TEXT[severity]}`}>
                      {item.name} {Math.round(item.score)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
