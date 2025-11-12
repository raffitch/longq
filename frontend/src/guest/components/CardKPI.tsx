import React from "react";

export type KPIStatus = "Stable" | "Imbalanced" | "Low" | "Medium" | "High";

export interface CardKPIProps {
  title: string;
  value: number | string;
  status: KPIStatus;
  delta?: {
    value: number;
    direction: "up" | "down";
  };
}

export default function CardKPI({ title, value, status, delta }: CardKPIProps) {
  const statusStyle = (() => {
    switch (status) {
      case "Stable":
        return { border: "border-accent-teal", bg: "bg-accent-teal/5", shadow: "shadow-teal-glow" };
      case "Low":
        return {
          border: "border-priority-medium",
          bg: "bg-priority-medium/5",
          shadow: "shadow-yellow-glow",
        };
      case "Imbalanced":
      case "High":
      case "Medium":
      default:
        return { border: "border-priority-moderate", bg: "bg-priority-moderate/5", shadow: "" };
    }
  })();

  return (
    <div className="flex h-full flex-col gap-14 rounded-2xl bg-bg-card p-8 shadow-card md:p-10">
      <h3 className="text-3xl font-normal leading-tight md:text-4xl">{title}</h3>

      <div className="flex flex-1 flex-col justify-center">
        <div className="mb-8 text-7xl font-normal leading-none md:text-8xl lg:text-[128px]">
          {value}
        </div>

        <div
          className={`flex h-[51px] w-fit items-center rounded-full border px-4 ${statusStyle.border} ${statusStyle.bg} ${statusStyle.shadow}`}
        >
          <span className="text-2xl font-light leading-tight md:text-[28px]">{status}</span>
        </div>

        {delta && (
          <div className="mt-4 flex items-center gap-2 text-sm">
            <span className={delta.direction === "up" ? "text-priority-low" : "text-priority-high"}>
              {delta.direction === "up" ? "↑" : "↓"} {delta.value}%
            </span>
            <span className="text-text-secondary">vs. last session</span>
          </div>
        )}
      </div>
    </div>
  );
}
