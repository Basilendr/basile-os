"use client";
import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Activity as ActivityIcon, AlarmClock, AlertTriangle, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, FolderKanban, Mail, Plus } from "lucide-react";
import { api } from "@/lib/client/api";
import { addDays, cn, formatDueDate, formatTime, isoDate, relativeTime } from "@/lib/utils";
import { PRIORITY } from "@/lib/catalog";
import { Badge, EmptyState, Progress } from "@/components/ui/misc";
import { Checkbox } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useUI } from "@/components/shell/ui-context";
import { ProjectIcon } from "@/components/projects/project-icon";
import { useEvents, useUpdateTask } from "@/hooks/use-data";
import type { Activity, Task } from "@/types";
import type { DashboardData } from "./overview";

/** Carte de widget à hauteur fixe : en-tête, puis contenu qui défile à l'intérieur (la page, elle, ne défile pas). */
export function WidgetCard({ title, subtitle, action, children, className, bodyClassName }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cn("surface flex h-full min-h-0 flex-col", className)}>
      <header className="flex items-start justify-between gap-3 px-4 pt-4 pb-2.5">
        <div className="min-w-0">
          <h3 className="t-section truncate">{title}</h3>
          {subtitle && <p className="t-meta truncate">{subtitle}</p>}
        </div>
        {action}
      </header>
      <div className={cn("min-h-0 flex-1 overflow-y-auto pb-4", /(^|\s)px-/.test(bodyClassName ?? "") ? null : "px-4", bodyClassName)}>{children}</div>
    </section>
  );
}

type Item = { id: string; kind: "event" | "task"; start: Date | null; end: Date | null; title: string; color?: string | null; href: string; task?: Task; allDay?: boolean };

/** Aujourd'hui : rendez-vous et tâches du jour sur une seule ligne de temps, avec ajout rapide. */
export function TodayWidget({ data }: { data: DashboardData }) {
  const update = useUpdateTask();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const now = Date.now();
  const items = useMemo(
    () =>
      (
        [
          ...data.events.map((e) => ({ id: e.id, kind: "event" as const, start: new Date(e.startAt), end: new Date(e.endAt), title: e.title, color: e.color, href: `/calendar?event=${e.id}`, allDay: e.allDay })),
          ...data.todayTasks.map((t) => ({ id: t.id, kind: "task" as const, start: t.dueTime ? new Date(`${t.dueDate}T${t.dueTime}:00`) : null, end: null, title: t.title, color: t.projectColor, href: `/tasks?task=${t.id}`, task: t })),
        ] as Item[]
      ).sort((a, b) => (a.allDay ? -1 : b.allDay ? 1 : (a.start?.getTime() ?? Infinity) - (b.start?.getTime() ?? Infinity))),
    [data.events, data.todayTasks],
  );
  const open = data.todayTasks.filter((t) => t.status !== "done").length;
  return (
    <WidgetCard
      title="Aujourd'hui"
      subtitle={`${data.events.length} rendez-vous · ${open} tâche${open > 1 ? "s" : ""} à faire`}
      bodyClassName="flex flex-col gap-2"
    >
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!title.trim()) return;
          try {
            await api.post("/api/tasks", { title: title.trim(), dueDate: isoDate() });
            setTitle("");
            ["dashboard", "tasks"].forEach((q) => qc.invalidateQueries({ queryKey: [q] }));
          } catch (err) {
            toast({ kind: "error", title: "Tâche non créée", description: (err as Error).message });
          }
        }}
      >
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ajouter une tâche pour aujourd'hui…" className="h-9 min-w-0 flex-1 rounded-[11px] border border-line bg-bg px-3 text-[13px] placeholder:text-fg-3 focus:border-fg-3 focus:outline-none" />
        <button type="submit" disabled={!title.trim()} className="focus-ring grid size-9 shrink-0 place-items-center rounded-[11px] bg-primary text-primary-fg transition-opacity disabled:opacity-30" aria-label="Ajouter">
          <Plus className="size-4" />
        </button>
      </form>
      {data.conflicts.length > 0 && (
        <p className="flex items-center gap-2 rounded-[10px] bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] px-2.5 py-1.5 text-[12px] text-warning">
          <AlertTriangle className="size-3.5 shrink-0" />
          Conflit : « {data.conflicts[0].titles[0]} » et « {data.conflicts[0].titles[1]} »
        </p>
      )}
      {items.length === 0 ? (
        <p className="t-meta m-auto py-4 text-center">Journée libre : aucun rendez-vous ni tâche datée.</p>
      ) : (
        <ol className="-mx-1.5">
          {items.map((it) => {
            const past = it.kind === "event" ? (it.end?.getTime() ?? 0) < now : it.task?.status === "done";
            return (
              <li key={`${it.kind}-${it.id}`} className={cn("flex items-center gap-2.5 rounded-[10px] px-1.5 py-1.5 hover:bg-raised/60", past && "opacity-50")}>
                <span className="t-num w-10 shrink-0 text-right text-[12px] font-medium text-fg-2">{it.allDay ? "Jour" : it.start ? formatTime(it.start) : "—"}</span>
                <span className="h-6 w-[3px] shrink-0 rounded-full" style={{ background: it.color ?? (it.kind === "event" ? "var(--accent)" : "var(--line)") }} />
                {it.task ? <Checkbox checked={it.task.status === "done"} onChange={(v) => update.mutate({ id: it.task!.id, patch: { status: v ? "done" : "todo" } })} label="Terminer" /> : <CalendarDays className="size-4 shrink-0 text-fg-3" />}
                <Link href={it.href} className={cn("min-w-0 flex-1 truncate text-[13px]", it.task?.status === "done" && "line-through")}>
                  {it.title}
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </WidgetCard>
  );
}

export function MiniCalendarWidget() {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const start = useMemo(() => {
    const s = new Date(month);
    s.setDate(1 - ((s.getDay() + 6) % 7));
    return s;
  }, [month]);
  const { data } = useEvents(start, addDays(start, 42));
  const days = useMemo(() => new Set((data?.items ?? []).map((e) => isoDate(new Date(e.startAt)))), [data]);
  const today = isoDate();
  return (
    <WidgetCard
      title="Calendrier"
      subtitle={month.toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}
      action={
        <span className="flex gap-0.5">
          <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="grid size-7 place-items-center rounded-[8px] text-fg-3 hover:bg-raised hover:text-fg" aria-label="Mois précédent">
            <ChevronLeft className="size-4" />
          </button>
          <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="grid size-7 place-items-center rounded-[8px] text-fg-3 hover:bg-raised hover:text-fg" aria-label="Mois suivant">
            <ChevronRight className="size-4" />
          </button>
        </span>
      }
    >
      <div className="grid grid-cols-7 text-center">
        {["L", "M", "M", "J", "V", "S", "D"].map((d, i) => (
          <span key={i} className="t-meta pb-1">
            {d}
          </span>
        ))}
        {Array.from({ length: 42 }, (_, i) => {
          const d = addDays(start, i);
          const iso = isoDate(d);
          const inMonth = d.getMonth() === month.getMonth();
          return (
            <Link key={i} href="/calendar" className="relative mx-auto grid h-7 w-8 place-items-center">
              <span className={cn("t-num grid size-[26px] place-items-center rounded-full text-[12px]", iso === today ? "bg-primary font-semibold text-primary-fg" : inMonth ? "text-fg hover:bg-raised" : "text-fg-3/50")}>{d.getDate()}</span>
              {days.has(iso) && iso !== today && <span className="absolute bottom-0 size-1 rounded-full bg-accent" />}
            </Link>
          );
        })}
      </div>
    </WidgetCard>
  );
}

export function DeadlinesWidget({ items }: { items: DashboardData["deadlines"] }) {
  const today = isoDate();
  return (
    <WidgetCard title="Échéances" subtitle="7 prochains jours" bodyClassName="px-2">
      {items.length === 0 ? (
        <EmptyState className="py-6" icon={<AlarmClock className="size-5" />} title="Aucune échéance proche" />
      ) : (
        items.map((d) => (
          <Link key={d.id} href={`/tasks?task=${d.id}`} className="flex items-center gap-3 rounded-[10px] px-2 py-2 hover:bg-raised/60">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px]">{d.title}</span>
              {d.projectName && <span className="t-meta block truncate">{d.projectName}</span>}
            </span>
            {(d.priority === "urgent" || d.priority === "high") && <Badge tone={d.priority === "urgent" ? "danger" : "warning"}>{PRIORITY[d.priority as keyof typeof PRIORITY]}</Badge>}
            <Badge tone={d.dueDate < today ? "danger" : "neutral"}>{formatDueDate(d.dueDate)}</Badge>
          </Link>
        ))
      )}
    </WidgetCard>
  );
}

export function ProjectsWidget({ projects }: { projects: DashboardData["projects"] }) {
  const { openCreate } = useUI();
  return (
    <WidgetCard
      title="Projets actifs"
      subtitle={`${projects.length} en cours`}
      action={
        <Link href="/projects" className="t-meta hover:text-fg">
          Tout voir
        </Link>
      }
      bodyClassName="flex flex-col gap-2"
    >
      {projects.length === 0 ? (
        <EmptyState
          className="py-6"
          icon={<FolderKanban className="size-5" />}
          title="Aucun projet actif"
          action={
            <button onClick={() => openCreate("project")} className="text-[13px] font-medium text-accent hover:underline">
              Créer un projet
            </button>
          }
        />
      ) : (
        projects.map((p) => (
          <Link key={p.id} href={`/projects/${p.id}`} className="rounded-[12px] border border-line-soft p-2.5 transition-colors hover:bg-raised/50">
            <span className="flex items-center gap-2.5">
              <ProjectIcon name={p.icon} className="size-4" style={{ color: p.color }} />
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{p.name}</span>
              <span className="t-num text-[12px] text-fg-2">{p.progress} %</span>
            </span>
            <Progress value={p.progress} color={p.color} className="mt-2" />
          </Link>
        ))
      )}
    </WidgetCard>
  );
}

const ACTIVITY_ICON: Record<string, ReactNode> = { task: <CheckCircle2 />, project: <FolderKanban />, note: <ActivityIcon />, event: <CalendarDays />, email: <Mail /> };

export function ActivityWidget({ items }: { items: Activity[] }) {
  return (
    <WidgetCard title="Fil d'activité" subtitle="Derniers changements" bodyClassName="px-2">
      {items.length === 0 ? (
        <EmptyState className="py-6" icon={<ActivityIcon className="size-5" />} title="Pas encore d'activité" />
      ) : (
        <ol>
          {items.map((a) => (
            <li key={a.id} className="flex items-start gap-2.5 rounded-[8px] px-2 py-1.5">
              <span className="mt-0.5 text-fg-3 [&>svg]:size-3.5">{ACTIVITY_ICON[a.type.split(".")[0]] ?? <ActivityIcon />}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-fg-2">{a.title}</span>
                <span className="t-meta">{relativeTime(a.createdAt)}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </WidgetCard>
  );
}
