import React from "react";

const BioAgeSignalIcon: React.FC<{ size?: number; color?: string }> = ({ size = 120, color = "#D22847" }) => (
  <svg width={size} height={size} viewBox="0 0 285 281" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M212.138 139.379C219.743 140.427 225.601 133.727 228.84 126.261C231.291 120.596 230.134 114.673 237.917 114.611C252.063 114.5 239.779 139.502 234.646 145.401C221.983 159.975 196.962 161.493 197.34 135.047C197.551 120.35 207.889 111.637 189.473 104.875C186.549 103.801 176.379 101.074 174.212 102.888C173.686 103.332 170.636 114.488 169.426 117.018C162.033 132.493 145.888 143.451 131.258 146.882C130.175 148.362 133.288 164.96 133.299 168.428C133.498 246.679 34.0863 224.195 40.828 145.068C45.2454 93.2993 90.9759 63.6575 131.689 64.003C152.535 64.1758 195.752 78.3179 210.056 96.7669C221.247 111.205 211.244 123.274 212.128 139.379H212.138ZM173.381 98.4452C174.443 99.198 178.019 98.3959 179.934 98.7784C187.043 100.21 201.642 103.344 203.503 113.093C205.407 123.04 196.877 132.616 202.462 145.154C209.309 160.518 228.535 149.115 235.277 138.737C237.938 134.64 245.942 118.227 237.906 118.264C232.553 118.289 232.564 128.099 229.419 133.11C225.128 139.971 209.099 150.325 208.457 136.318C207.816 122.423 219.006 111.107 206.343 97.4086C190.577 80.3541 150.695 67.4953 129.544 67.7298C89.7979 68.1741 46.76 98.0874 43.815 148.585C40.0918 212.595 117.585 239.892 128.555 181.373C129.954 173.907 130.417 153.916 127.02 147.597C126.609 146.832 117.585 141.526 114.809 138.169C111.685 134.405 109.581 130.099 108.141 125.15C111.569 120.14 111.475 126.631 113.431 129.913C116.649 135.306 122.297 142.353 127.966 143.772C133.635 145.191 151 134.109 155.827 129.469C161.296 124.212 171.13 110.169 170.994 101.703C170.952 98.8525 165.451 90.4116 166.902 88.7703C170.089 85.1545 172.687 97.9516 173.371 98.4452H173.381Z"
      fill={color}
      transform="rotate(180 142.5 140.5)"
    />
  </svg>
);

export interface CardDonutProps {
  title: string;
  value: number;
  note: string;
  badge: "Very Low" | "Low" | "Medium" | "High" | "Stable";
}

export default function CardDonut({ title, note, badge }: CardDonutProps) {
  const badgeStyle = (() => {
    switch (badge) {
      case "Very Low":
        return { border: "border-priority-high", bg: "bg-priority-high/5", shadow: "" };
      case "Low":
        return { border: "border-priority-medium", bg: "bg-priority-medium/5", shadow: "shadow-yellow-glow" };
      case "Stable":
        return { border: "border-accent-teal", bg: "bg-accent-teal/5", shadow: "shadow-teal-glow" };
      case "Medium":
      case "High":
      default:
        return { border: "border-priority-moderate", bg: "bg-priority-moderate/5", shadow: "" };
    }
  })();

  const containerWidth = 285;
  const containerHeight = 281;

  return (
    <div className="flex h-full items-end justify-between gap-6 rounded-2xl bg-bg-card p-8 shadow-card md:p-10">
      <div className="flex flex-1 flex-col gap-4">
        <h3 className="text-3xl font-normal leading-tight md:text-4xl">{title}</h3>

        <div className="relative flex items-center justify-center" style={{ width: containerWidth, height: containerHeight }}>
          <svg
            width={containerWidth}
            height={containerHeight}
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
          >
            <circle
              cx={containerWidth / 2}
              cy={containerHeight / 2}
              r={120}
              stroke="rgba(255,255,255,0.15)"
              strokeWidth={4}
              fill="none"
            />
          </svg>
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <BioAgeSignalIcon size={144} />
          </div>
        </div>
      </div>

      <div className="flex max-w-[323px] flex-col gap-6">
        <p className="text-2xl font-normal leading-[50px] text-text-secondary md:text-[28px]">{note}</p>
        <div
          className={`flex h-[51px] w-fit items-center justify-center rounded-full border px-4 ${badgeStyle.border} ${badgeStyle.bg} ${badgeStyle.shadow}`}
        >
          <span className="text-2xl font-light leading-tight md:text-[28px]">{badge}</span>
        </div>
      </div>
    </div>
  );
}
