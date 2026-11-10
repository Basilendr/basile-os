"use client";
import { useState } from "react";
import { AreaChart } from "@/components/charts/charts";
import { Segmented } from "@/components/ui/tabs";
import { Trend } from "./kpis";
import { WidgetCard } from "./widgets";
import { useSize } from "@/hooks/use-size";
import type { DashboardData } from "./overview";

const METRICS = {
  done: { label: "Terminées", title: "tâches terminées", color: "var(--chart-1)", pair: "tasksDone" },
  created: { label: "Créées", title: "tâches créées", color: "var(--chart-4)", pair: "tasksCreated" },
  events: { label: "Rendez-vous", title: "rendez-vous", color: "var(--chart-2)", pair: "events" },
} as const;
type Metric = keyof typeof METRICS;

/** Courbe d'activité de la période choisie (comptages quotidiens réels). */
export function TrendWidget({ data }: { data: DashboardData }) {
  const [m, setM] = useState<Metric>("done");
  const cfg = METRICS[m];
  const pair = data.trend[cfg.pair];
  const [box, size] = useSize<HTMLDivElement>();
  const points = data.trend.series.map((d) => ({ label: new Date(`${d.d}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }), value: d[m] }));
  return (
    <WidgetCard title="Activité" subtitle={`${data.trend.days} derniers jours`} bodyClassName="flex flex-col overflow-hidden">
      <Segmented size="sm" className="w-full shrink-0 [&>button]:flex-1 [&>button]:justify-center" value={m} onChange={setM} options={(Object.keys(METRICS) as Metric[]).map((k) => ({ value: k, label: METRICS[k].label }))} />
      <div className="mt-3 flex shrink-0 items-baseline gap-2">
        <span className="t-num text-[24px] leading-none font-semibold tracking-[-0.02em]">{pair.cur.toLocaleString("fr-FR")}</span>
        <span className="t-meta truncate">{cfg.title}</span>
        <Trend pair={pair} className="ml-auto" />
      </div>
      <div ref={box} className="mt-2 min-h-0 flex-1">
        {size.height > 40 && <AreaChart key={m} data={points} height={Math.max(48, Math.round(size.height) - 24)} color={cfg.color} title={`${cfg.title} par jour`} />}
      </div>
    </WidgetCard>
  );
}
