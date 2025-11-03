import React from "react";
import { GENERAL_SEVERITY_META, GENERAL_SEVERITY_ORDER } from "../priority";

export interface OverallScoreCardProps {
  overallScore?: number;
  scoreStatus?: string;
  veryLowCount: number;
  lowCount: number;
  normalCount: number;
  moderateCount: number;
  highCount: number;
  veryHighCount: number;
  nextSteps?: string[];
}

const DEFAULT_NEXT_STEPS = ["Prioritize hydration", "Maintain consistent rest patterns", "Reintroduce moderate foods"];

export default function OverallScoreCard({
  overallScore = 93,
  scoreStatus = "Stable",
  veryLowCount,
  lowCount,
  normalCount,
  moderateCount,
  highCount,
  veryHighCount,
  nextSteps = DEFAULT_NEXT_STEPS,
}: OverallScoreCardProps) {
  const statusBadge = { bgColor: "bg-accent-teal/20", textColor: "text-accent-teal" };

  const counts = (
    [
      { severity: "very high" as const, count: veryHighCount },
      { severity: "high" as const, count: highCount },
      { severity: "moderate" as const, count: moderateCount },
      { severity: "normal" as const, count: normalCount },
      { severity: "low" as const, count: lowCount },
      { severity: "very low" as const, count: veryLowCount },
    ] satisfies Array<{ severity: (typeof GENERAL_SEVERITY_ORDER)[number]; count: number }>
  ).filter((entry) => entry.count > 0);

  return (
    <div className="flex flex-col gap-8 rounded-2xl bg-bg-card p-8 shadow-card md:p-10">
      <div className="flex flex-col items-center gap-4 text-center">
        <span className="text-2xl text-white/70 md:text-3xl">Overall Score</span>
        <span className="text-8xl font-bold text-white md:text-9xl">{Math.round(overallScore)}</span>
        <span className={`rounded-full px-4 py-1 text-xl font-medium md:text-2xl ${statusBadge.bgColor} ${statusBadge.textColor}`}>
          {scoreStatus}
        </span>
      </div>

      <div className="rounded-xl bg-white/5 p-6 shadow-inner-card md:p-8">
        <h4 className="mb-6 text-2xl font-normal text-text-secondary md:text-[28px]">Priority Breakdown:</h4>
        <div className="flex flex-col gap-4">
          {counts.map(({ severity, count }) => {
            const meta = GENERAL_SEVERITY_META[severity];
            return (
              <div key={severity} className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="h-4 w-4 rounded-full" style={{ backgroundColor: meta.color }} />
                  <div className="flex flex-col">
                    <span className="whitespace-nowrap text-xl font-medium text-white/70 md:text-2xl">{meta.label}</span>
                    <span className="text-sm text-text-secondary/70">{meta.range}</span>
                  </div>
                </div>
                <span className="text-2xl font-bold text-white md:text-3xl">{count}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-4 rounded-xl bg-white/5 p-6 shadow-inner-card md:p-8">
        <h4 className="text-2xl font-normal text-text-secondary md:text-[28px]">Next Steps:</h4>
        <ul className="list-disc space-y-2 pl-6 text-xl text-white/80 md:text-2xl">
          {nextSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
