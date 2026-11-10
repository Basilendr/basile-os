"use client";
import { useId, type ReactNode } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

/** Contrôle segmenté : l'indicateur glisse d'un onglet à l'autre (layoutId). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = "md",
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; icon?: ReactNode; count?: number }[];
  className?: string;
  size?: "sm" | "md";
}) {
  const id = useId();
  return (
    <div role="tablist" className={cn("inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-[10px] border border-line-soft bg-raised p-0.5", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "focus-ring relative inline-flex shrink-0 items-center gap-1.5 rounded-[8px] font-medium whitespace-nowrap transition-colors duration-150",
              size === "sm" ? "h-6 px-2 text-[12px]" : "h-7 px-2.5 text-[12.5px]",
              active ? "text-fg" : "text-fg-3 hover:text-fg-2",
            )}
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
                className="absolute inset-0 rounded-[8px] border border-line bg-[var(--seg-active)] shadow-[0_1px_2px_rgb(0_0_0/0.06),0_1px_1px_rgb(0_0_0/0.04)]"
                transition={{ type: "spring", bounce: 0, visualDuration: 0.25 }}
              />
            )}
            <span className="relative inline-flex items-center gap-1.5 [&>svg]:size-3.5">
              {o.icon}
              {o.label}
              {o.count !== undefined && <span className="t-num text-[11px] text-fg-3">{o.count}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
