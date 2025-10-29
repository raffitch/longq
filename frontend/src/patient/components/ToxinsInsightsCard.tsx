import React from "react";

export type ToxinSeverity = "high" | "moderate" | "medium" | "low";

export interface ToxinItem {
  name: string;
  score: number;
  severity: ToxinSeverity;
}

export interface ToxinsInsightsCardProps {
  data: ToxinItem[];
}

const SEVERITY_ORDER: ToxinSeverity[] = ["high", "moderate", "medium", "low"];

const SEVERITY_STYLES: Record<ToxinSeverity, { color: string; bgColor: string; title: string }> = {
  high: { color: "text-priority-high", bgColor: "bg-priority-high/20", title: "High Priority Signals" },
  moderate: { color: "text-priority-moderate", bgColor: "bg-priority-moderate/20", title: "Moderate Priority Signals" },
  medium: { color: "text-priority-medium", bgColor: "bg-priority-medium/20", title: "Medium Priority Signals" },
  low: { color: "text-priority-low", bgColor: "bg-priority-low/20", title: "Low Priority Signals" },
};

const ToxinsInsightsCard: React.FC<ToxinsInsightsCardProps> = ({ data }) => {
  const grouped = data.reduce<Partial<Record<ToxinSeverity, ToxinItem[]>>>((acc, item) => {
    (acc[item.severity] = acc[item.severity] || []).push(item);
    return acc;
  }, {});

  return (
    <div className="flex h-full flex-col gap-8 rounded-2xl bg-bg-card p-8 shadow-card md:p-10">
      <h3 className="text-3xl font-normal leading-tight md:text-4xl">Toxins</h3>

      <div className="flex flex-col gap-6">
        {SEVERITY_ORDER.map((severity) => {
          const items = grouped[severity];
          if (!items || !items.length) return null;
          const { color, bgColor, title } = SEVERITY_STYLES[severity];
          return (
            <div key={severity} className="flex flex-col gap-4">
              <h4 className="text-2xl font-normal text-text-secondary md:text-[28px]">{title}</h4>
              <div className="flex flex-wrap items-center gap-4 md:gap-6">
                {items.map((item) => (
                  <div
                    key={`${item.name}-${item.score}`}
                    className={`flex h-14 items-center justify-center rounded-[30px] px-4 md:px-6 ${bgColor}`}
                  >
                    <span className={`whitespace-nowrap text-2xl font-normal md:text-[28px] ${color}`}>
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
};

export default ToxinsInsightsCard;
