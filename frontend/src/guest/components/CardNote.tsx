import React from "react";

export type NoteSeverity = "Low" | "Medium" | "High" | "Very Low";

export interface CardNoteProps {
  title: string;
  note: string;
  severity: NoteSeverity;
}

export default function CardNote({ title, note, severity }: CardNoteProps) {
  const severityStyle = (() => {
    switch (severity) {
      case "Low":
        return { border: "border-priority-medium", bg: "bg-priority-medium/5", shadow: "shadow-yellow-glow" };
      case "Medium":
        return { border: "border-priority-moderate", bg: "bg-priority-moderate/5", shadow: "" };
      case "High":
      case "Very Low":
        return { border: "border-priority-high", bg: "bg-priority-high/5", shadow: "" };
      default:
        return { border: "border-accent-teal", bg: "bg-accent-teal/5", shadow: "shadow-teal-glow" };
    }
  })();

  return (
    <div className="flex h-full flex-col gap-6 rounded-2xl bg-bg-card p-8 shadow-card md:p-10">
      <h3 className="text-3xl font-normal leading-tight md:text-4xl">{title}</h3>

      <p className="flex-1 text-2xl font-normal leading-[50px] text-text-secondary md:text-[28px]">{note}</p>

      <div
        className={`flex h-[51px] w-fit items-center justify-center rounded-full border px-4 ${severityStyle.border} ${severityStyle.bg} ${severityStyle.shadow}`}
      >
        <span className="text-2xl font-light leading-tight md:text-[28px]">{severity}</span>
      </div>
    </div>
  );
}
