"use client";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type Size = "sm" | "md" | "icon" | "icon-sm";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-primary text-primary-fg hover:opacity-90 shadow-[var(--shadow-sm)]",
  secondary: "bg-card text-fg border border-line shadow-[var(--shadow-sm)] hover:bg-bg-2",
  outline: "border border-line text-fg hover:bg-raised",
  ghost: "text-fg-2 hover:text-fg hover:bg-raised",
  danger: "bg-[color-mix(in_srgb,var(--danger)_14%,transparent)] text-danger hover:bg-[color-mix(in_srgb,var(--danger)_22%,transparent)]",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5 rounded-[9px]",
  md: "h-9 px-4 text-[13.5px] gap-2 rounded-[10px]",
  icon: "h-9 w-9 rounded-[10px] justify-center",
  "icon-sm": "h-8 w-8 rounded-[9px] justify-center",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
};

/** Bouton : retour visuel immédiat à l'appui (scale), jamais seulement au relâchement. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, icon, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        "focus-ring inline-flex shrink-0 select-none items-center font-medium whitespace-nowrap",
        "transition-[transform,background-color,color,filter] duration-100 ease-out active:scale-[0.97]",
        "disabled:pointer-events-none disabled:opacity-45 touch-manipulation",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-3.5 animate-spin" /> : icon}
      {children}
    </button>
  );
});
