"use client";
import { cn } from "@/lib/utils";
import { highlight } from "@/services/definitions/core";

export type DefDeckSummary = {
  id: string;
  title: string;
  subject: string | null;
  source: string;
  status: string;
  error: string | null;
  keywords: string;
  createdAt: string;
  total: number;
  fresh: number;
  due: number;
  mastered: number;
};
export type DefOverview = {
  date: string;
  ready: { drive: boolean; ai: boolean };
  decks: DefDeckSummary[];
  totals: { due: number; fresh: number; total: number; mastered: number; studiedToday: number };
};
export type DefCard = {
  id: string;
  term: string;
  definition: string;
  keywords: string[];
  keywordsBy: string;
  state: string;
  interval: number;
  ease: number;
  reps: number;
  lapses: number;
  dueDate: string | null;
  due: boolean;
};

/**
 * Définition avec ses mots importants surlignés.
 * `found` / `missing` : après une réponse écrite, les mots retrouvés en vert, les oubliés en rouge.
 */
export function Marked({ definition, keywords, found, missing, className, hide }: { definition: string; keywords: string[]; found?: string[]; missing?: string[]; className?: string; hide?: boolean }) {
  const segs = highlight(definition, keywords);
  return (
    <span className={className}>
      {segs.map((s, i) => {
        if (!s.key) return <span key={i}>{s.text}</span>;
        const ok = found?.includes(s.key);
        const ko = missing?.includes(s.key);
        return (
          <mark
            key={i}
            className={cn(
              "rounded-[4px] px-0.5 font-semibold text-fg [box-decoration-break:clone]",
              ok ? "bg-[color-mix(in_srgb,var(--success)_24%,transparent)]" : ko ? "bg-[color-mix(in_srgb,var(--danger)_20%,transparent)]" : "bg-[color-mix(in_srgb,var(--warning)_30%,transparent)]",
              hide && "text-transparent",
            )}
          >
            {s.text}
          </mark>
        );
      })}
    </span>
  );
}

/** Mots clés en pastilles. */
export function KeyChips({ keywords, found, className }: { keywords: string[]; found?: string[]; className?: string }) {
  if (!keywords.length) return null;
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {keywords.map((k) => {
        const ok = found?.includes(k);
        const ko = found && !ok;
        return (
          <span
            key={k}
            className={cn(
              "inline-flex h-6 items-center rounded-full border px-2 text-[12px]",
              ok ? "border-success/40 text-success" : ko ? "border-danger/40 text-danger" : "border-line text-fg-2",
            )}
          >
            {ok ? "✓ " : ko ? "✗ " : ""}
            {k}
          </span>
        );
      })}
    </div>
  );
}

export function defState(c: Pick<DefCard, "state" | "interval" | "due">) {
  if (c.state === "new") return { label: "Nouvelle", tone: "accent" as const };
  if (c.due) return { label: "À revoir", tone: "warning" as const };
  if (c.interval >= 21) return { label: "Sue", tone: "success" as const };
  return { label: `Dans ${c.interval} j`, tone: "neutral" as const };
}
