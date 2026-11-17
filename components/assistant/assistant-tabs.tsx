"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { ASSISTANT_TABS, isActive } from "@/components/shell/nav";
import { cn } from "@/lib/utils";

/** Les trois espaces de l'assistant, réunis sous une seule entrée de la barre latérale. */
export function AssistantTabs({ className }: { className?: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Espaces de l'assistant" className={cn("inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full border border-line bg-card p-1 shadow-[var(--shadow-sm)] backdrop-blur-2xl", className)}>
      {ASSISTANT_TABS.map((t) => {
        const on = isActive(pathname, t.href);
        const Icon = t.icon;
        return (
          <Link key={t.href} href={t.href} aria-current={on ? "page" : undefined} className={cn("focus-ring relative inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium whitespace-nowrap transition-colors", on ? "text-[var(--seg-active-fg)]" : "text-fg-2 hover:text-fg")}>
            {on && <motion.span layoutId="assistant-tab" className="absolute inset-0 rounded-full bg-[var(--seg-active)] shadow-[0_2px_8px_-2px_rgb(0_0_0/0.3)]" transition={{ type: "spring", bounce: 0, visualDuration: 0.25 }} />}
            <Icon className="relative size-3.5" strokeWidth={2} />
            <span className="relative">{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
