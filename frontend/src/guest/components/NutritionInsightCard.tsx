import React from "react";
import {
  GENERAL_SEVERITY_META,
  GENERAL_SEVERITY_ORDER,
  type GeneralSeverity,
} from "../../shared/priority";
import { useThresholdLimitValue, useVisibleSeverities } from "../../hooks/useThresholdSettings";

export interface NutrientItem {
  name: string;
  score: number;
  severity: GeneralSeverity;
}

export interface NutritionData {
  note?: string;
  nutrients: NutrientItem[];
}

interface NutritionInsightCardProps {
  data: NutritionData | null;
}

const NutritionInsightCard: React.FC<NutritionInsightCardProps> = ({ data }) => {
  if (!data || !data.nutrients.length) {
    return <div className="rounded-2xl bg-bg-card p-8 text-text-secondary">No nutrition data available.</div>;
  }

  const hasTitle = Boolean(data.note);
  const limit = useThresholdLimitValue();
  const visibleSeverities = useVisibleSeverities();
  const visibleSet = new Set(visibleSeverities);

  const grouped = GENERAL_SEVERITY_ORDER.reduce<Record<GeneralSeverity, NutrientItem[]>>(
    (acc, severity) => {
      acc[severity] = [];
      return acc;
    },
    {} as Record<GeneralSeverity, NutrientItem[]>,
  );

  data.nutrients.forEach((item) => {
    if (!grouped[item.severity]) {
      grouped[item.severity] = [];
    }
    grouped[item.severity].push(item);
  });

  return (
    <div className="flex h-full flex-col gap-6 rounded-2xl bg-bg-card p-8 shadow-card md:p-10">
      {hasTitle && (
        <h3 className="text-3xl font-normal leading-tight text-text-secondary md:text-4xl">{data.note}</h3>
      )}

      <div className="flex flex-col gap-6">
        {GENERAL_SEVERITY_ORDER.map((severity) => {
          const items = grouped[severity];
          if (!items.length || !visibleSet.has(severity)) return null;
          const meta = GENERAL_SEVERITY_META[severity];
          return (
            <div key={severity} className="flex flex-wrap items-center gap-4 md:gap-6">
              {items
                .slice()
                .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
                .slice(0, limit)
                .map((item) => (
                  <div
                    key={`${item.name}-${item.score}`}
                    className="flex h-14 items-center rounded-[30px] px-4 md:px-6"
                    style={{ backgroundColor: meta.background }}
                  >
                    <span
                      className="whitespace-nowrap text-left text-2xl font-normal md:text-[28px]"
                      style={{ color: meta.color }}
                    >
                      {item.name} {Math.round(item.score)}
                    </span>
                  </div>
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default NutritionInsightCard;
