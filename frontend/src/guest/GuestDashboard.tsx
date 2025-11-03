import React from "react";
import type { Sex } from "../api";
import {
  CardEnergyMap,
  FoodCategoryCard,
  HeavyMetalsCard,
  HormonesCard,
  NutritionInsightCard,
  PEAK_PRIORITY_TIERS,
  ToxinsInsightsCard,
  type FoodItem,
} from "./components";
import { BiohazardIcon, DairyIcon, EggsIcon, FruitsIcon, GrainIcon, MeatIcon, SeafoodIcon } from "./icons";
import type { AggregatedInsights, PriorityCounts } from "./dataTransform";
import { GENERAL_SEVERITY_META, GENERAL_SEVERITY_ORDER } from "../shared/priority";

interface GuestDashboardProps {
  clientFullName: string | null;
  reportDate?: string | null;
  aggregated: AggregatedInsights;
  isPreview: boolean;
  sex: Sex;
}

const defaultIcon = (
  <svg className="h-16 w-16 text-accent-teal" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" fill="none">
    <circle cx="32" cy="32" r="20" stroke="currentColor" strokeWidth={3} />
  </svg>
);

const leafIcon = (
  <svg className="h-16 w-16 text-accent-teal" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" fill="none">
    <path
      d="M32 6C14 12 6 28 6 40c0 10 8 18 18 18 16 0 28-16 28-30 0-11-6-20-20-22Z"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const sproutIcon = (
  <svg className="h-16 w-16 text-accent-teal" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" fill="none">
    <path
      d="M32 58V22M32 22c-8 8-18 8-24 2 6-10 16-12 24-8m0 8c8-8 18-8 24-2-6 10-16 12-24 8"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const getCategoryIcon = (name: string): React.ReactNode => {
  const key = name.toLowerCase();
  if (key.includes("dairy")) return <DairyIcon className="h-16 w-16 text-accent-teal" />;
  if (key.includes("egg")) return <EggsIcon className="h-16 w-16 text-accent-teal" />;
  if (key.includes("fruit")) return <FruitsIcon className="h-16 w-16 text-accent-teal" />;
  if (key.includes("grain") || key.includes("wheat")) return <GrainIcon className="h-16 w-16 text-accent-teal" />;
  if (key.includes("meat")) return <MeatIcon className="h-16 w-16 text-accent-teal" />;
  if (key.includes("seafood") || key.includes("fish")) return <SeafoodIcon className="h-16 w-16 text-accent-teal" />;
  if (key.includes("heavy")) return <BiohazardIcon className="h-16 w-16 text-accent-teal" />;
  if (key.includes("vegetable")) return leafIcon;
  if (key.includes("legume") || key.includes("nut") || key.includes("seed") || key.includes("lectin")) return sproutIcon;
  return defaultIcon;
};

const formatDate = (input?: string | null): string => {
  if (!input) {
    return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(new Date());
  }
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    return input;
  }
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(parsed);
};

const computeEnergyStatus = (counts: PriorityCounts) =>
  counts.highCount + counts.veryHighCount > 2 ? "Imbalanced" : "Stable";

const GuestDashboard: React.FC<GuestDashboardProps> = ({ clientFullName, reportDate, aggregated, isPreview, sex }) => {
  const {
    categories,
    nutrition,
    heavyMetals,
    hormones,
    toxins,
    priorityCounts,
    energyMap,
  } = aggregated;

  const showNutrition = nutrition.nutrients.length > 0;
  const showHeavyMetals = heavyMetals.length > 0;
  const showHormones = hormones.length > 0;
  const showToxins = toxins.length > 0;

  const sections: Array<{ name: string; items: FoodItem[] }> = categories.filter((section) => section.items.length > 0);
  const showPriorityLegend =
    sections.length > 0 || showNutrition || showHeavyMetals || showHormones || showToxins;

  const organCount = energyMap?.organs ? Object.keys(energyMap.organs).length : 0;
  const chakraCount = energyMap?.chakras ? Object.keys(energyMap.chakras).length : 0;
  const hasEnergyMap = organCount > 0 || chakraCount > 0;

  return (
    <div className="min-h-screen bg-[#0b0d10] text-text-primary">
      <main className="mx-auto flex max-w-[1440px] flex-col gap-12 px-4 pb-24 pt-10 md:px-8 lg:px-12">
        <header className="flex flex-col gap-8">
          <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
            <div className="flex flex-col items-start gap-1">
              <h1 className="font-logo text-5xl font-semibold text-text-primary md:text-7xl lg:text-8xl leading-none">
                <span className="inline-flex items-baseline">
                  <span>Quantum Qi</span>
                  <span className="logo-tm">TM</span>
                </span>
              </h1>
              <span className="pl-1 text-xs font-medium tracking-[0.18em] text-teal-300">
                by Longevity Wellness
              </span>
            </div>
            <div className="relative">
              <div
                className="pointer-events-none absolute inset-0 -z-10 rounded-full bg-cyan-400/45 blur-3xl"
                aria-hidden="true"
              />
              <svg className="h-auto w-32 fill-accent-teal" viewBox="0 0 192 97" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Logo">
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M46.628 6.275L39.818 11.999L42.246 14.025C46.265 17.381 73.133 40.195 96.043 59.706C107.892 69.796 120.717 80.706 124.543 83.95L131.5 89.848L131.809 78.45L132.119 67.052L126.309 61.736C123.114 58.812 112.4 49.591 102.5 41.244C92.6 32.897 77.789 20.327 69.586 13.31C61.383 6.293 54.394 0.552002 54.055 0.552002C53.716 0.552002 50.374 3.128 46.628 6.275ZM143.469 15.181L143.72 26.81L147.11 29.963C148.974 31.697 153.846 35.914 157.936 39.334L165.371 45.552H178.769C186.138 45.552 192.017 45.187 191.833 44.741C191.469 43.856 183.54 36.942 163.5 20.04C156.35 14.009 149.15 7.834 147.5 6.318C145.85 4.802 144.212 3.559 143.859 3.557C143.507 3.554 143.331 8.785 143.469 15.181ZM131 7.603C129.075 9.279 123.675 13.876 119 17.819C114.325 21.762 108.87 26.411 106.878 28.151L103.256 31.315L110.317 37.273L117.378 43.232L126.689 35.235L136 27.238V15.895C136 9.656 135.662 4.553 135.25 4.554C134.838 4.556 132.925 5.928 131 7.603ZM16.622 31.765L0.968018 45.052L14.996 45.33C27.297 45.573 29.26 45.388 30.934 43.83C31.984 42.852 35.777 39.577 39.364 36.552C42.95 33.527 45.885 30.602 45.886 30.052C45.888 29.09 34.885 19.354 33.132 18.765C32.661 18.607 25.232 24.457 16.622 31.765ZM3.05202 53.302C3.10902 54.14 52.1 95.752 53.628 96.261C54.161 96.439 61.551 90.672 70.049 83.445C78.547 76.218 86.581 69.454 87.903 68.415C89.224 67.375 90.124 66.404 89.903 66.258C89.681 66.112 86.471 63.388 82.77 60.205L76.04 54.418L65.361 63.485C55.338 71.995 52.638 73.65 51.833 71.776C51.65 71.349 46.591 66.849 40.591 61.776L29.682 52.552H16.341C9.00402 52.552 3.02302 52.89 3.05202 53.302ZM159.482 56.646C156.742 58.897 152.239 62.68 149.476 65.052C146.713 67.424 143.433 70.194 142.188 71.208C140.035 72.961 139.937 73.63 140.211 84.75L140.5 96.448L152.5 86.374C159.1 80.832 170.688 71.122 178.25 64.794C185.813 58.466 192 53.123 192 52.921C192 52.718 185.804 52.552 178.232 52.552H164.463L159.482 56.646Z"
                  fill="currentColor"
                />
              </svg>
            </div>
          </div>

          <div className="flex flex-col gap-4 rounded-2xl bg-bg-card p-6 text-text-secondary md:flex-row md:items-center md:gap-12 lg:gap-18">
            <div className="flex flex-col">
              <span className="text-xl md:text-2xl">Guest Name</span>
              <span className="text-2xl text-text-primary md:text-4xl">{clientFullName ?? "Guest"}</span>
            </div>

            <div className="flex flex-col">
              <span className="text-xl md:text-2xl">Date</span>
              <span className="text-2xl text-text-primary md:text-4xl">{formatDate(reportDate)}</span>
            </div>

          </div>
        </header>
        {hasEnergyMap && (
          <>
            <section aria-labelledby="key-highlights">
              <div className="flex flex-col gap-6">
                <h2 id="key-highlights" className="text-4xl font-bold md:text-5xl lg:text-6xl">
                  PEEK Report
                </h2>
                <div className="flex flex-col gap-6">
                  <div className="flex flex-wrap gap-4 rounded-2xl bg-white/5 p-6 md:gap-6 lg:gap-8">
                    {PEAK_PRIORITY_TIERS.map((tier) => (
                      <div key={tier.label} className="flex items-center gap-3">
                        <span className="h-7 w-7 rounded-full" style={{ background: tier.color }} aria-hidden="true" />
                        <span className="text-xl md:text-2xl lg:text-[28px]">{tier.label}</span>
                      </div>
                    ))}
                  </div>
                  <CardEnergyMap
                    status={computeEnergyStatus(priorityCounts)}
                    sex={sex}
                    organValues={energyMap?.organs}
                    chakraValues={energyMap?.chakras}
                  />
                </div>
              </div>
            </section>
            {showPriorityLegend && (
              <>
                <div className="h-px w-full bg-white/20" aria-hidden="true" />
                <div className="flex flex-wrap gap-4 rounded-2xl bg-bg-card p-6 md:gap-6 lg:gap-8">
                  {GENERAL_SEVERITY_ORDER.map((severity) => {
                    const meta = GENERAL_SEVERITY_META[severity];
                    return (
                      <div key={severity} className="flex items-center gap-3">
                        <span
                          className="h-7 w-7 rounded-full"
                          style={{ background: meta.color }}
                          aria-hidden="true"
                        />
                        <div className="flex flex-col text-text-primary">
                          <span className="text-xl md:text-2xl lg:text-[28px]">{meta.label}</span>
                          <span className="text-sm text-text-secondary/70">{meta.range}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}

        {sections.length > 0 && (
          <>
            <div className="h-px w-full bg-white/20" aria-hidden="true" />
            <section aria-labelledby="food-categories" className="flex flex-col gap-6">
              <h2 id="food-categories" className="text-4xl font-bold md:text-5xl lg:text-6xl">
                Food Categories
              </h2>
              <div className="flex flex-col gap-6">
                {sections.map((section) => (
                  <FoodCategoryCard key={section.name} category={section.name} icon={getCategoryIcon(section.name)} items={section.items} />
                ))}
              </div>
            </section>
          </>
        )}

        {showNutrition && (
          <>
            <div className="h-px w-full bg-white/20" aria-hidden="true" />
            <section aria-labelledby="nutrition-insights" className="flex flex-col gap-6">
              <h2 id="nutrition-insights" className="text-4xl font-bold md:text-5xl lg:text-6xl">
                Nutrition Insights
              </h2>
              <NutritionInsightCard data={nutrition} />
            </section>
          </>
        )}

        {showHeavyMetals && (
          <>
            <div className="h-px w-full bg-white/20" aria-hidden="true" />
            <section aria-labelledby="heavy-metals" className="flex flex-col gap-6">
              <h2 id="heavy-metals" className="text-4xl font-bold md:text-5xl lg:text-6xl">
                Heavy Metals Insights
              </h2>
              <HeavyMetalsCard data={heavyMetals} />
            </section>
          </>
        )}

        {showHormones && (
          <>
            <div className="h-px w-full bg-white/20" aria-hidden="true" />
            <section aria-labelledby="hormones" className="flex flex-col gap-6">
              <h2 id="hormones" className="text-4xl font-bold md:text-5xl lg:text-6xl">
                Hormones Insights
              </h2>
              <HormonesCard data={hormones} />
            </section>
          </>
        )}

        {showToxins && (
          <>
            <div className="h-px w-full bg-white/20" aria-hidden="true" />
            <section aria-labelledby="toxins" className="flex flex-col gap-6">
              <h2 id="toxins" className="text-4xl font-bold md:text-5xl lg:text-6xl">
                Toxins Insights
              </h2>
              <ToxinsInsightsCard data={toxins} />
            </section>
          </>
        )}

        <p className="mt-12 px-4 text-lg font-light leading-relaxed text-text-secondary md:px-10 md:text-xl">
          Note: These results provide a snapshot of current wellness indicators. Review with your practitioner before making significant lifestyle changes.
        </p>
      </main>
    </div>
  );
};

export default GuestDashboard;
