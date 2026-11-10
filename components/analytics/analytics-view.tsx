"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, CheckCircle2, AlertTriangle, Repeat2, CalendarClock, Mail, Lightbulb } from "lucide-react";
import { api } from "@/lib/client/api";
import { PageHeader, Card, CardHeader, EmptyState, Progress } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/tabs";
import { AreaChart, BarChart } from "@/components/charts/charts";

type A = {
  period: string;
  bucket: string;
  series: { b: string; created: number; completed: number; planned_hours: number; emails_in: number; emails_out: number }[];
  totals: { completed: number; created: number; overdue: number; open: number; postponed: number; on_time: number; done_with_due: number };
  projects: { id: string; name: string; color: string; progress: number; done_period: number; total: number }[];
  postponed: { id: string; title: string; postponed_count: number; due_date: string | null }[];
  weekday: { dow: number; events: number; completed: number }[];
  categories: { category: string; n: number }[];
  insights: string[];
};

const label = (b: string, bucket: string) => (bucket === "month" ? new Date(b + "-01").toLocaleDateString("fr-FR", { month: "short", year: "2-digit" }) : new Date(b + "T00:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short" }));
const DAYS = ["", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

export function AnalyticsView() {
  const [period, setPeriod] = useState<"7d" | "30d" | "90d" | "12m">("30d");
  const { data: a } = useQuery({ queryKey: ["analytics", period], queryFn: () => api.get<A>(`/api/analytics?period=${period}`) });
  const hasData = a && (a.totals.created || a.totals.completed || a.series.some((s) => s.planned_hours || s.emails_in));
  return (
    <div className="mx-auto max-w-[1600px] px-1 pt-1 pb-10 md:px-3 md:pt-2">
      <PageHeader
        title="Analyses personnelles"
        description="Calculées à partir de tes tâches, projets, calendrier et emails réels."
        actions={<Segmented value={period} onChange={setPeriod} options={[{ value: "7d", label: "7 jours" }, { value: "30d", label: "30 jours" }, { value: "90d", label: "90 jours" }, { value: "12m", label: "12 mois" }]} />}
      />
      {a && !hasData && (
        <div className="surface mb-4">
          <EmptyState icon={<BarChart3 className="size-5" />} title="Pas encore assez de données" description="Les graphiques se rempliront au fil de tes tâches terminées, rendez-vous et emails." />
        </div>
      )}
      {a && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
            {[
              { l: "Tâches terminées", v: a.totals.completed, i: <CheckCircle2 /> },
              { l: "Tâches créées", v: a.totals.created, i: <BarChart3 /> },
              { l: "À temps", v: a.totals.done_with_due ? `${Math.round((100 * a.totals.on_time) / a.totals.done_with_due)} %` : "—", i: <CalendarClock /> },
              { l: "En retard", v: a.totals.overdue, i: <AlertTriangle /> },
              { l: "Reportées 2×+", v: a.totals.postponed, i: <Repeat2 /> },
            ].map((s) => (
              <Card key={s.l} className="p-4">
                <div className="flex items-center justify-between">
                  <span className="t-label">{s.l}</span>
                  <span className="text-fg-3 [&>svg]:size-4">{s.i}</span>
                </div>
                <p className="t-num mt-3 text-[26px] font-semibold">{s.v}</p>
              </Card>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 [&>*]:min-w-0">
            <Card className="lg:col-span-8">
              <CardHeader title="Évolution de la productivité" subtitle="Tâches créées et terminées" />
              <div className="px-4 pb-4">
                <BarChart title="Tâches créées et terminées" data={a.series.map((s) => ({ label: label(s.b, a.bucket), values: [s.created, s.completed] }))} series={[{ name: "Créées", color: "var(--fg-3)" }, { name: "Terminées", color: "var(--accent)" }]} />
              </div>
            </Card>
            <Card className="lg:col-span-4">
              <CardHeader title="Observations" icon={<Lightbulb className="size-4 text-warning" />} subtitle="Fondées uniquement sur les chiffres" />
              <ul className="flex flex-col gap-2 px-4 pb-4">
                {a.insights.length === 0 && <li className="t-meta">Aucune observation significative sur cette période.</li>}
                {a.insights.map((i) => (
                  <li key={i} className="rounded-[9px] border border-line-soft bg-bg-2/50 px-3 py-2 text-[13px] text-fg-2">
                    {i}
                  </li>
                ))}
              </ul>
            </Card>
            <Card className="lg:col-span-6">
              <CardHeader title="Temps planifié" subtitle="Heures d'événements au calendrier" icon={<CalendarClock className="size-4" />} />
              <div className="px-4 pb-4">
                <AreaChart title="Heures planifiées" data={a.series.map((s) => ({ label: label(s.b, a.bucket), value: s.planned_hours }))} format={(v) => `${v} h`} color="var(--accent-2)" />
              </div>
            </Card>
            <Card className="lg:col-span-6">
              <CardHeader title="Activité email" subtitle="Reçus (boîte de réception) et envoyés, d'après la synchronisation" icon={<Mail className="size-4" />} />
              <div className="px-4 pb-4">
                <BarChart title="Emails reçus et envoyés" data={a.series.map((s) => ({ label: label(s.b, a.bucket), values: [s.emails_in, s.emails_out] }))} series={[{ name: "Reçus", color: "var(--accent)" }, { name: "Envoyés", color: "var(--success)" }]} />
              </div>
            </Card>
            <Card className="lg:col-span-5">
              <CardHeader title="Progression des projets" />
              <div className="flex flex-col gap-3 px-4 pb-4">
                {a.projects.length === 0 && <p className="t-meta">Aucun projet actif.</p>}
                {a.projects.map((p) => (
                  <Link key={p.id} href={`/projects/${p.id}`} className="block">
                    <div className="mb-1 flex justify-between text-[13px]">
                      <span>{p.name}</span>
                      <span className="t-meta">
                        {p.progress} % · +{p.done_period} sur la période
                      </span>
                    </div>
                    <Progress value={p.progress} color={p.color} />
                  </Link>
                ))}
              </div>
            </Card>
            <Card className="lg:col-span-4">
              <CardHeader title="Habitudes par jour" subtitle="Rendez-vous et tâches terminées" />
              <div className="px-4 pb-4">
                <BarChart height={140} title="Activité par jour de semaine" data={a.weekday.map((w) => ({ label: DAYS[w.dow], values: [w.events, w.completed] }))} series={[{ name: "Rendez-vous", color: "var(--accent-2)" }, { name: "Terminées", color: "var(--accent)" }]} />
              </div>
            </Card>
            <Card className="lg:col-span-3">
              <CardHeader title="Souvent reportées" icon={<Repeat2 className="size-4" />} />
              <div className="px-2 pb-3">
                {a.postponed.length === 0 && <p className="t-meta px-2">Aucune.</p>}
                {a.postponed.map((t) => (
                  <Link key={t.id} href={`/tasks?task=${t.id}`} className="flex items-center gap-2 rounded-[7px] px-2 py-1.5 text-[13px] hover:bg-raised">
                    <span className="flex-1 truncate">{t.title}</span>
                    <span className="t-meta">{t.postponed_count}×</span>
                  </Link>
                ))}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
