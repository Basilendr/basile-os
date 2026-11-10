"use client";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { CalendarRange, Check, ChevronDown, Download, LayoutGrid, Replace, Sun } from "lucide-react";
import { api } from "@/lib/client/api";
import { addDays, cn, isoDate, startOfDay } from "@/lib/utils";
import { WIDGETS, WIDGET_SLOTS, type WidgetKey } from "@/lib/catalog";
import { Button } from "@/components/ui/button";
import { Card, ErrorState, PageHeader, Skeleton } from "@/components/ui/misc";
import { Menu } from "@/components/ui/menu";
import { useToast } from "@/components/ui/toast";
import { BriefingWidget } from "./briefing-widget";
import { QuickActions } from "./quick-actions";
import { Hero } from "./hero";
import { Insights, KpiRow } from "./kpis";
import { TrendWidget } from "./trend-widget";
import { SchoolWidget } from "./school-widget";
import { ActivityWidget, DeadlinesWidget, MiniCalendarWidget, ProjectsWidget, TodayWidget } from "./widgets";
import type { Activity, CalendarEvent, Project, Task } from "@/types";

type Pair = { cur: number; prev: number; delta: number | null };
type Size = "sm" | "md" | "lg" | "full";

export type DashboardData = {
  stats: {
    doneToday: number;
    openToday: number;
    overdue: number;
    upcomingEvents: number;
    nextEvent: { id: string; title: string; startAt: string } | null;
    unreadEmails: number | null;
    importantEmails: number | null;
    activeProjects: number;
    importantNotifications: number;
  };
  connections: { gmail: boolean; calendar: boolean };
  events: CalendarEvent[];
  todayTasks: Task[];
  projects: Project[];
  deadlines: { id: string; title: string; dueDate: string; priority: string; projectName: string | null }[];
  conflicts: { a: string; b: string; titles: [string, string] }[];
  activity: Activity[];
  trend: {
    days: number;
    tasksDone: Pair;
    tasksCreated: Pair;
    events: Pair;
    emails: Pair;
    notes: Pair;
    onTimeRate: number | null;
    series: { d: string; done: number; created: number; events: number }[];
  };
  widgets: { widgetKey: WidgetKey; position: number; size: Size; visible: boolean }[];
  briefing: { id: string; content: string; sources: { type: string; id: string; title: string; href: string }[]; createdAt: string } | null;
  context: string;
};

const PERIODS = [
  { days: 7, label: "7 derniers jours" },
  { days: 30, label: "30 derniers jours" },
  { days: 90, label: "90 derniers jours" },
] as const;

/** Accueil sur un seul écran : ciel et météo, indicateurs, aperçu, puis trois widgets au choix. */
export function Overview() {
  const range = useMemo(() => {
    const from = startOfDay();
    return { from, to: addDays(from, 1) };
  }, []);
  const [days, setDays] = useState<number>(7);
  useEffect(() => {
    try {
      const v = Number(localStorage.getItem("bos.overview.days"));
      if (PERIODS.some((p) => p.days === v)) setDays(v);
    } catch {}
  }, []);
  const pickDays = (d: number) => {
    setDays(d);
    try {
      localStorage.setItem("bos.overview.days", String(d));
    } catch {}
  };
  const { data, error, refetch } = useQuery({
    queryKey: ["dashboard", days],
    queryFn: () => api.get<DashboardData>(`/api/dashboard?from=${range.from.toISOString()}&to=${range.to.toISOString()}&days=${days}`),
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  });
  const [editing, setEditing] = useState(false);
  const period = PERIODS.find((p) => p.days === days) ?? PERIODS[0];

  return (
    <div className="@container mx-auto h-full w-full max-w-[1600px]">
    <div className="flex min-h-full flex-col px-1 pt-1 pb-3 md:px-3 md:pt-2 @min-[940px]:h-full">
      <PageHeader
        title="Accueil"
        description="Ta journée, tes priorités et ton activité en un coup d'œil."
        actions={
          <>
            <Link href="/today">
              <Button size="sm" variant="primary" icon={<Sun className="size-3.5" />}>
                Aujourd'hui
              </Button>
            </Link>
            <Menu
              align="end"
              trigger={({ toggle }) => (
                <Button size="sm" icon={<CalendarRange className="size-3.5" />} onClick={toggle}>
                  {period.label}
                  <ChevronDown className="size-3.5 text-fg-3" />
                </Button>
              )}
              items={PERIODS.map((p) => ({ label: p.label, icon: p.days === days ? <Check /> : <span />, onSelect: () => pickDays(p.days) }))}
            />
            <span className="hidden md:contents">
            <Button size="sm" icon={<Download className="size-3.5" />} disabled={!data} onClick={() => data && exportCsv(data, period.label)}>
              Exporter
            </Button>
            <Button variant={editing ? "primary" : "secondary"} size="sm" icon={editing ? <Check className="size-3.5" /> : <LayoutGrid className="size-3.5" />} onClick={() => setEditing((e) => !e)}>
              {editing ? "Terminer" : "Personnaliser"}
            </Button>
            </span>
          </>
        }
      />
      {error ? (
        <Card>
          <ErrorState error={error} onRetry={() => refetch()} />
        </Card>
      ) : !data ? (
        <div className="grid flex-1 gap-4 @min-[940px]:min-h-0 @min-[940px]:grid-cols-12 @min-[940px]:grid-rows-[224px_108px_minmax(250px,1fr)]">
          <Skeleton className="h-full min-h-[224px] rounded-[20px] @min-[940px]:col-span-8" />
          <Skeleton className="h-full min-h-[300px] rounded-[20px] @min-[940px]:col-span-4 @min-[940px]:row-span-2" />
          <Skeleton className="h-full min-h-[104px] rounded-[20px] @min-[940px]:col-span-8" />
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-full min-h-[250px] rounded-[20px] @min-[940px]:col-span-4" />
          ))}
        </div>
      ) : (
        <div className="rise-in grid flex-1 grid-cols-1 gap-4 @min-[640px]:grid-cols-2 @min-[940px]:min-h-0 @min-[940px]:grid-cols-12 @min-[940px]:grid-rows-[auto_auto_minmax(230px,1fr)]">
          <Hero context={data.context} className="@min-[640px]:col-span-2 @min-[940px]:col-span-8" />
          <Insights data={data} className="@min-[940px]:col-span-4 @min-[940px]:col-start-9 @min-[940px]:row-span-2 @min-[940px]:row-start-1" />
          <KpiRow data={data} periodLabel={period.label} className="@min-[940px]:col-span-8" />
          <Slots data={data} editing={editing} />
        </div>
      )}
    </div>
    </div>
  );
}

/** Les trois emplacements du bas : en mode « Personnaliser », chacun peut afficher un autre widget. */
function Slots({ data, editing }: { data: DashboardData; editing: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const ordered = useMemo(() => [...data.widgets].sort((a, b) => a.position - b.position), [data.widgets]);
  const [slots, setSlots] = useState<WidgetKey[]>(() => pickSlots(ordered));
  useEffect(() => setSlots(pickSlots(ordered)), [ordered]);

  const choose = (index: number, key: WidgetKey) => {
    const next = [...slots];
    const other = next.indexOf(key);
    if (other >= 0) next[other] = next[index];
    next[index] = key;
    setSlots(next);
    const rest = (Object.keys(WIDGETS) as WidgetKey[]).filter((k) => !next.includes(k));
    const widgets = [...next, ...rest].map((k, i) => ({ widgetKey: k, position: i, size: "sm" as const, visible: i < WIDGET_SLOTS }));
    api
      .put("/api/dashboard/widgets", { widgets })
      .then(() => qc.invalidateQueries({ queryKey: ["dashboard"] }))
      .catch((e) => toast({ kind: "error", title: "Disposition non enregistrée", description: (e as Error).message }));
  };

  return (
    <>
      {slots.map((k, i) => (
        <div key={`${i}-${k}`} className={cn("relative h-[310px] min-w-0 @min-[940px]:col-span-4 @min-[940px]:h-auto @min-[940px]:min-h-0", editing && "rounded-[22px] ring-2 ring-accent/40 ring-offset-2 ring-offset-bg")}>
          {editing && (
            <div className="absolute top-3 right-3 z-10">
              <Menu
                trigger={({ toggle }) => (
                  <Button size="sm" variant="primary" icon={<Replace className="size-3.5" />} onClick={toggle}>
                    Changer
                  </Button>
                )}
                items={[
                  { type: "label", label: `Emplacement ${i + 1}` },
                  ...(Object.keys(WIDGETS) as WidgetKey[]).map((w) => ({ label: WIDGETS[w].label, icon: w === k ? <Check /> : <span />, onSelect: () => choose(i, w) })),
                ]}
              />
            </div>
          )}
          <WidgetBody k={k} data={data} />
        </div>
      ))}
    </>
  );
}

function pickSlots(ordered: DashboardData["widgets"]): WidgetKey[] {
  const shown = ordered.filter((w) => w.visible && w.widgetKey in WIDGETS).map((w) => w.widgetKey);
  const fill = (Object.keys(WIDGETS) as WidgetKey[]).filter((k) => !shown.includes(k));
  return [...shown, ...fill].slice(0, WIDGET_SLOTS);
}

function WidgetBody({ k, data }: { k: WidgetKey; data: DashboardData }) {
  switch (k) {
    case "today":
      return <TodayWidget data={data} />;
    case "school":
      return <SchoolWidget />;
    case "trend":
      return <TrendWidget data={data} />;
    case "mini_calendar":
      return <MiniCalendarWidget />;
    case "briefing":
      return <BriefingWidget briefing={data.briefing} />;
    case "deadlines":
      return <DeadlinesWidget items={data.deadlines} />;
    case "projects":
      return <ProjectsWidget projects={data.projects} />;
    case "activity":
      return <ActivityWidget items={data.activity} />;
    case "quick_actions":
      return <QuickActions />;
  }
}

/** Export CSV des indicateurs de la période et de la série quotidienne (données réelles). */
function exportCsv(d: DashboardData, label: string) {
  const t = d.trend;
  const rows: (string | number)[][] = [
    ["Indicateur", "Période", "Période précédente", "Évolution %"],
    ["Tâches terminées", t.tasksDone.cur, t.tasksDone.prev, t.tasksDone.delta ?? ""],
    ["Tâches créées", t.tasksCreated.cur, t.tasksCreated.prev, t.tasksCreated.delta ?? ""],
    ["Rendez-vous", t.events.cur, t.events.prev, t.events.delta ?? ""],
    ...(d.connections.gmail ? [["Emails reçus", t.emails.cur, t.emails.prev, t.emails.delta ?? ""]] : []),
    ["Notes modifiées", t.notes.cur, t.notes.prev, t.notes.delta ?? ""],
    [],
    ["Jour", "Tâches terminées", "Tâches créées", "Rendez-vous"],
    ...t.series.map((x) => [x.d, x.done, x.created, x.events]),
  ];
  const csv = "﻿" + rows.map((r) => r.map((c) => (/[;"\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(";")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `basile-os-${label.replace(/\s+/g, "-").toLowerCase()}-${isoDate()}.csv` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
