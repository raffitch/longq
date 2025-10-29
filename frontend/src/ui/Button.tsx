import React from "react";
import { cn, type ClassValue } from "./cn";

const baseClasses =
  "inline-flex items-center justify-center gap-2 px-3.5 py-2 text-[13px] font-semibold leading-none transition-transform duration-100 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-info/40 disabled:cursor-not-allowed disabled:opacity-55";

const variantClasses: Record<string, string> = {
  primary: "bg-accent text-white hover:scale-[1.01] active:scale-[0.99] disabled:bg-[#4b5563] disabled:text-white disabled:opacity-100",
  secondary: "bg-neutral-dark text-text-primary hover:bg-surface-muted",
  info: "bg-accent-blue text-white hover:scale-[1.01] active:scale-[0.99]",
  danger: "bg-danger text-white hover:scale-[1.01] active:scale-[0.99]",
  ghost: "border border-border bg-transparent text-text-primary hover:border-border-strong hover:bg-surface-muted",
  soft: "border border-border bg-[rgba(148,163,184,0.12)] text-text-primary hover:bg-surface-muted/70",
};

const sizeClasses: Record<string, string> = {
  md: "rounded-lg",
  sm: "rounded-lg px-3 py-1.5 text-xs",
  icon: "h-11 w-11 gap-0 rounded-full p-0 text-[18px] leading-none",
};

type ButtonVariant = keyof typeof variantClasses;
type ButtonSize = keyof typeof sizeClasses;

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: ClassValue;
};

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(baseClasses, variantClasses[variant], sizeClasses[size], className)}
        {...props}
      >
        {children}
      </button>
    );
  },
);

Button.displayName = "Button";

export { Button };
