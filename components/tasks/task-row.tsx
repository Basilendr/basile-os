"use client";
import { CalendarDays, ListChecks, Repeat2, Bell } from "lucide-react";
import { Checkbox } from "@/components/ui/input";
import { Badge, Dot } from "@/components/ui/misc";
import { cn, formatDueDate, isoDate } from "@/lib/utils";
import { PRIORITY } from "@/lib/catalog";
import type { Task } from "@/types";

export const PRIORITY_TONE = { low: "neutral", medium: "accent", high: "warning", urgent: "danger" } as const;

export function TaskMeta({ t }: { t: Task }) {
  const overdue = t.dueDate && t.status !== "done" && t.dueDate < isoDate();
  return (
    <div className="t-meta flex flex-wrap items-center gap-x-2.5 gap-y-1">
      {t.dueDate && (
        <span className={cn("inline-flex items-center gap-1", overdue && "text-danger")}>
          <CalendarDays className="size-3" />
          {formatDueDate(t.dueDate)}
          {t.dueTime && ` · ${t.dueTime}`}
        </span>
      )}
      {t.projectName && (
        <span className="inline-flex items-center gap-1.5">
          <Dot color={t.projectColor ?? "var(--accent)"} className="size-1.5" />
          {t.projectName}
        </span>
      )}
      {!!t.subtaskTotal && (
        <span className="inline-flex items-center gap-1">
          <ListChecks className="size-3" />
          {t.subtaskDone}/{t.subtaskTotal}
        </span>
      )}
      {t.reminderAt && <Bell className="size-3" aria-label="Rappel" />}
      {t.postponedCount > 1 && (
        <span className="inline-flex items-center gap-1 text-warning" title="Échéance reportée plusieurs fois">
          <Repeat2 className="size-3" />
          reportée {t.postponedCount}×
        </span>
      )}
      {t.category && <span>#{t.category}</span>}
    </div>
  );
}

export function TaskRow({ t, onToggle, onOpen, selected }: { t: Task; onToggle: (done: boolean) => void; onOpen: () => void; selected?: boolean }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
      className={cn(
        "focus-ring group flex cursor-pointer items-start gap-3 rounded-[9px] px-3 py-2.5 transition-colors hover:bg-raised/60",
        selected && "bg-raised",
      )}
    >
      <Checkbox className="mt-0.5" checked={t.status === "done"} onChange={onToggle} label={t.status === "done" ? "Rouvrir" : "Terminer"} />
      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-[13.5px]", t.status === "done" ? "text-fg-3 line-through" : "text-fg")}>{t.title}</p>
        <TaskMeta t={t} />
      </div>
      {t.status !== "done" && t.priority !== "medium" && (
        <Badge tone={PRIORITY_TONE[t.priority]} className="shrink-0">
          {PRIORITY[t.priority]}
        </Badge>
      )}
      {t.status === "in_progress" && <Badge tone="violet">En cours</Badge>}
      {t.status === "review" && <Badge tone="warning">À vérifier</Badge>}
    </div>
  );
}
