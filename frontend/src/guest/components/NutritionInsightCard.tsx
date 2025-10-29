import React from "react";

export interface NutrientItem {
  name: string;
  score: number;
}

export interface NutritionData {
  note?: string;
  nutrients: NutrientItem[];
}

const getScoreColorClass = (score: number): string => {
  if (score >= 85) return "bg-priority-high";
  if (score >= 70) return "bg-priority-moderate";
  if (score >= 50) return "bg-priority-medium";
  return "bg-priority-low";
};

const NutrientBar: React.FC<{ item: NutrientItem }> = ({ item }) => {
  const colorClass = getScoreColorClass(item.score);
  const barWidth = `${Math.min(Math.abs(item.score), 100)}%`;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-xl font-medium md:text-2xl">
        <span className="text-text-primary">{item.name}</span>
        <span className="text-text-primary">{Math.round(item.score)}</span>
      </div>
      <div className="h-2.5 w-full rounded-full bg-background-gray">
        <div
          className={`h-full rounded-full transition-all duration-500 ease-out ${colorClass}`}
          style={{ width: barWidth }}
          role="progressbar"
          aria-valuenow={item.score}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
    </div>
  );
};

interface NutritionInsightCardProps {
  data: NutritionData | null;
}

const NutritionInsightCard: React.FC<NutritionInsightCardProps> = ({ data }) => {
  if (!data || !data.nutrients.length) {
    return <div className="rounded-2xl bg-bg-card p-8 text-text-secondary">No nutrition data available.</div>;
  }

  const hasTitle = Boolean(data.note);

  return (
    <div className="overflow-hidden rounded-2xl bg-bg-card shadow-card">
      {hasTitle && (
        <div className="p-6 md:p-8">
          <h3 className="text-2xl font-semibold text-text-primary md:text-3xl">{data.note}</h3>
        </div>
      )}

      <div className={`flex flex-col gap-6 px-6 pb-6 md:gap-8 md:px-8 md:pb-8 ${hasTitle ? "pt-6" : "pt-8"}`}>
        {data.nutrients.map((item) => (
          <NutrientBar key={`${item.name}-${item.score}`} item={item} />
        ))}
      </div>
    </div>
  );
};

export default NutritionInsightCard;
