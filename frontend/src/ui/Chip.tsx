import React from "react";
import { cn, type ClassValue } from "./cn";

const baseClasses =
  "inline-flex items-center justify-center rounded-full px-2.5 py-[2px] text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.04em]";

const variantClasses: Record<string, string> = {
  default: "bg-chip-default text-chip-default-text",
  success: "border border-success-border bg-success-surface text-chip-success-text",
  danger: "border border-error-border bg-error-surface text-chip-danger-text",
  info: "bg-info-surface text-chip-info-text",
  warning: "bg-chip-warning text-chip-warning-text",
  muted: "bg-chip-muted text-chip-muted-text",
};

type ChipVariant = keyof typeof variantClasses;

type ChipProps = React.HTMLAttributes<HTMLSpanElement> & {
  variant?: ChipVariant;
  className?: ClassValue;
};

const Chip = React.forwardRef<HTMLSpanElement, ChipProps>(({ className, variant = "default", children, ...props }, ref) => {
  return (
    <span ref={ref} className={cn(baseClasses, variantClasses[variant], className)} {...props}>
      {children}
    </span>
  );
});

Chip.displayName = "Chip";

export { Chip };
export type { ChipVariant };
