import React from "react";
import {
  GENERAL_SEVERITY_META,
  GENERAL_SEVERITY_ORDER,
  type GeneralSeverity,
} from "../priority";

export type MetalSeverity = GeneralSeverity;

export interface MetalItem {
  name: string;
  score: number;
  severity: MetalSeverity;
}

export interface HeavyMetalsCardProps {
  data: MetalItem[];
}

const HeavyMetalsCard: React.FC<HeavyMetalsCardProps> = ({ data }) => {
  const grouped = GENERAL_SEVERITY_ORDER.reduce<Record<GeneralSeverity, MetalItem[]>>(
    (acc, severity) => {
      acc[severity] = [];
      return acc;
    },
    {} as Record<GeneralSeverity, MetalItem[]>,
  );

  data.forEach((item) => {
    if (!grouped[item.severity]) {
      grouped[item.severity] = [];
    }
    grouped[item.severity].push(item);
  });

  return (
    <div className="flex h-full flex-col gap-6 rounded-2xl bg-bg-card p-8 shadow-card md:p-10">
      <h3 className="text-3xl font-normal leading-tight md:text-4xl">Heavy Metals</h3>

      <div className="flex flex-col gap-6">
        {GENERAL_SEVERITY_ORDER.map((severity) => {
          const items = grouped[severity];
          if (!items.length) return null;
          const meta = GENERAL_SEVERITY_META[severity];
          return (
            <div key={severity} className="flex flex-col gap-4">
              <h4 className="text-2xl font-normal text-text-secondary md:text-[28px]">
                {meta.label}
                <span className="ml-3 text-sm text-text-secondary/70">{meta.range}</span>
              </h4>
              <div className="flex flex-wrap items-center gap-4 md:gap-6">
                {items
                  .slice()
                  .sort((a, b) => b.score - a.score)
                  .map((item) => (
                    <div
                      key={`${item.name}-${item.score}`}
                      className="flex h-14 items-center justify-center rounded-[30px] px-4 md:px-6"
                      style={{ backgroundColor: meta.background }}
                    >
                      <span
                        className="whitespace-nowrap text-2xl font-normal md:text-[28px]"
                        style={{ color: meta.color }}
                      >
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

export default HeavyMetalsCard;
