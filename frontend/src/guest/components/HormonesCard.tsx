import React from "react";

export type HormoneSeverity = "high" | "moderate";

export interface HormoneItem {
  name: string;
  score: number;
  severity: HormoneSeverity;
}

export interface HormonesCardProps {
  data: HormoneItem[];
}

const SEVERITY_STYLES: Record<HormoneSeverity, { color: string; bgColor: string }> = {
  high: { color: "text-priority-high", bgColor: "bg-priority-high/20" },
  moderate: { color: "text-priority-moderate", bgColor: "bg-priority-moderate/20" },
};

const SECTION_TITLES: Record<HormoneSeverity, string> = {
  high: "High Priority Signals",
  moderate: "Moderate Priority Signals",
};

const ORDER: HormoneSeverity[] = ["high", "moderate"];

const HormonesCard: React.FC<HormonesCardProps> = ({ data }) => {
  const grouped = data.reduce<Partial<Record<HormoneSeverity, HormoneItem[]>>>((acc, item) => {
    (acc[item.severity] = acc[item.severity] || []).push(item);
    return acc;
  }, {});

  return (
    <div className="flex h-full flex-col gap-8 rounded-2xl bg-bg-card p-8 shadow-card md:p-10">
      <h3 className="text-3xl font-normal leading-tight md:text-4xl">Hormones</h3>

      <div className="flex flex-col gap-6">
        {ORDER.map((severity) => {
          const items = grouped[severity];
          if (!items || !items.length) return null;
          const styles = SEVERITY_STYLES[severity];
          return (
            <div key={severity} className="flex flex-col gap-4">
              <h4 className="text-2xl font-normal text-text-secondary md:text-[28px]">{SECTION_TITLES[severity]}</h4>
              <div className="flex flex-wrap items-center gap-4 md:gap-6">
                {items.map((item) => (
                  <div
                    key={`${item.name}-${item.score}`}
                    className={`flex h-14 items-center justify-center rounded-[30px] px-4 md:px-6 ${styles.bgColor}`}
                  >
                    <span className={`whitespace-nowrap text-2xl font-normal md:text-[28px] ${styles.color}`}>
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

export default HormonesCard;
