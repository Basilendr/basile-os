"use client";
import { useId, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, CalendarDays, CheckCircle2, Copy, ExternalLink, FolderKanban, Mail, MoreHorizontal, NotebookPen, Target, Timer, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Menu } from "@/components/ui/menu";
import { Segmented } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { BarChart } from "@/components/charts/charts";
import type { DashboardData } from "./overview";
import { useSize } from "@/hooks/use-size";

type Pair = { cur: number; prev: number; delta: number | null };

/** Évolution par rapport à la période précédente ; rien n'est affiché quand il n'y a pas de base de comparaison. */
export function Trend({ pair, className }: { pair: Pair; className?: string }) {
  const { delta } = pair;
  if (delta === null)
    return pair.cur ? <span className={cn("inline-flex items-center gap-0.5 text-[12px] font-semibold text-accent", className)}>Nouveau</span> : <span className={cn("text-[12px] text-fg-3", className)}>—</span>;
  const Icon = delta > 0 ? ArrowUpRight : delta < 0 ? ArrowDownRight : ArrowRight;
  return (
    <span className={cn("t-num inline-flex items-center gap-0.5 text-[12px] font-semibold", delta > 0 ? "text-success" : delta < 0 ? "text-danger" : "text-fg-3", className)}>
      <Icon className="size-3.5" strokeWidth={2.4} />
      {delta > 0 ? "+" : ""}
      {delta} %
    </span>
  );
}

function KpiCard({ icon, label, pair, href, period, empty }: { icon: ReactNode; label: string; pair: Pair | null; href: string; period: string; empty?: ReactNode }) {
  const router = useRouter();
  const { toast } = useToast();
  return (
    <div className="surface group relative flex min-w-0 flex-col justify-between overflow-hidden p-4" title={pair ? `${pair.cur} sur la période · ${pair.prev} la période précédente` : undefined}>
      <span aria-hidden className="pointer-events-none absolute -right-2 -bottom-3 text-fg opacity-[0.035] [&>svg]:size-[64px] [&>svg]:stroke-[1.5]">
        {icon}
      </span>
      <div className="flex items-start gap-2.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-[11px] border border-line bg-bg text-fg-2 [&>svg]:size-[17px]">{icon}</span>
        <span className="min-w-0 flex-1 pt-0.5 text-[13px] leading-snug font-medium text-fg-2">{label}</span>
        <Menu
          trigger={({ toggle }) => (
            <button onClick={toggle} className="focus-ring -mt-1 -mr-1 grid size-7 place-items-center rounded-[8px] text-fg-3 opacity-60 transition-opacity group-hover:opacity-100 hover:bg-raised hover:text-fg" aria-label={`Options — ${label}`}>
              <MoreHorizontal className="size-4" />
            </button>
          )}
          items={[
            { label: "Voir le détail", icon: <ExternalLink />, onSelect: () => router.push(href) },
            { label: "Copier la valeur", icon: <Copy />, disabled: !pair, onSelect: () => navigator.clipboard.writeText(`${label} (${period}) : ${pair?.cur ?? ""}`).then(() => toast({ kind: "success", title: "Copié" })) },
          ]}
        />
      </div>
      <div className="mt-3 flex items-end justify-between gap-2">
        {pair ? (
          <>
            <Link href={href} className="t-num text-[26px] leading-none font-semibold tracking-[-0.03em] hover:opacity-80">
              {pair.cur.toLocaleString("fr-FR")}
            </Link>
            <Trend pair={pair} />
          </>
        ) : (
          <>
            <span className="t-num text-[26px] leading-none font-semibold text-fg-3">—</span>
            <span className="text-[12px]">{empty}</span>
          </>
        )}
      </div>
    </div>
  );
}

export function KpiRow({ data, periodLabel, className }: { data: DashboardData; periodLabel: string; className?: string }) {
  const t = data.trend;
  return (
    <div className={cn("grid grid-cols-2 gap-4 @min-[940px]:grid-cols-4", className)}>
      <KpiCard icon={<CheckCircle2 />} label="Tâches terminées" pair={t.tasksDone} href="/tasks?view=done" period={periodLabel} />
      <KpiCard icon={<CalendarDays />} label="Rendez-vous" pair={t.events} href="/calendar" period={periodLabel} />
      <KpiCard
        icon={<Mail />}
        label="Emails reçus"
        pair={data.connections.gmail ? t.emails : null}
        href={data.connections.gmail ? "/inbox?box=gmail" : "/integrations"}
        period={periodLabel}
        empty={
          <Link href="/integrations" className="font-medium text-accent hover:underline">
            Connecter
          </Link>
        }
      />
      <KpiCard icon={<NotebookPen />} label="Notes modifiées" pair={t.notes} href="/notes" period={periodLabel} />
    </div>
  );
}

/** Anneaux concentriques en dégradé, sur leur piste, sans fond plein. */
function Rings({ rings, size = 150 }: { rings: { value: number; from: string; to: string; label: string }[]; size?: number }) {
  const id = useId();
  const stroke = 11;
  const gap = 5;
  const c = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={rings.map((r) => `${r.label} ${r.value} %`).join(", ")}>
      <defs>
        {rings.map((r, i) => (
          <linearGradient key={i} id={`${id}-${i}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={r.from} />
            <stop offset="1" stopColor={r.to} />
          </linearGradient>
        ))}
      </defs>
      {rings.map((ring, i) => {
        const r = c - stroke / 2 - i * (stroke + gap);
        const len = 2 * Math.PI * r;
        const v = Math.max(0, Math.min(100, ring.value));
        return (
          <g key={ring.label} transform={`rotate(-90 ${c} ${c})`}>
            <circle cx={c} cy={c} r={r} fill="none" stroke={ring.to} strokeOpacity={0.13} strokeWidth={stroke} />
            <motion.circle
              cx={c}
              cy={c}
              r={r}
              fill="none"
              stroke={`url(#${id}-${i})`}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={len}
              initial={{ strokeDashoffset: len }}
              animate={{ strokeDashoffset: len * (1 - Math.max(v, 0.5) / 100) }}
              transition={{ type: "spring", bounce: 0, visualDuration: 0.9, delay: i * 0.08 }}
            />
          </g>
        );
      })}
    </svg>
  );
}

/** Synthèse : anneaux de performance ou histogramme jour par jour. */
export function Insights({ data, className }: { data: DashboardData; className?: string }) {
  const [tab, setTab] = useState<"perf" | "trend">("perf");
  const s = data.stats;
  const total = s.doneToday + s.openToday;
  const today = total ? Math.round((s.doneToday / total) * 100) : 0;
  const onTime = data.trend.onTimeRate;
  const avg = data.projects.length ? Math.round(data.projects.reduce((a, p) => a + p.progress, 0) / data.projects.length) : 0;
  const rows = [
    { key: "today", label: "Tâches du jour", sub: total ? `${s.doneToday} sur ${total} terminée${s.doneToday > 1 ? "s" : ""}` : "Aucune tâche prévue", value: today, shown: `${today} %`, from: "#7cc2ff", to: "#2f7cf6", icon: <Target />, href: "/tasks" },
    { key: "ontime", label: "Ponctualité", sub: onTime === null ? "Pas encore de donnée" : "Finies avant l'échéance", value: onTime ?? 0, shown: onTime === null ? "—" : `${onTime} %`, from: "#6ee7a8", to: "#16a34a", icon: <Timer />, href: "/analytics" },
    { key: "projects", label: "Projets", sub: `${data.projects.length} en cours`, value: avg, shown: `${avg} %`, from: "#d8b4fe", to: "#8b5cf6", icon: <FolderKanban />, href: "/projects" },
  ];
  const series = data.trend.series.slice(-14);
  const [box, size] = useSize<HTMLDivElement>();
  const [ringBox, ringSize] = useSize<HTMLDivElement>();
  const ring = Math.max(84, Math.min(150, Math.round(ringSize.height) - 16, Math.round(ringSize.width) - 24));
  return (
    <section className={cn("surface flex min-h-0 flex-col p-4", className)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="t-section">Aperçu</h3>
          <p className="t-meta">{tab === "perf" ? "Ta progression en un coup d'œil" : `Tâches des ${series.length} derniers jours`}</p>
        </div>
      </div>
      <Segmented
        size="sm"
        className="mt-3 w-full [&>button]:flex-1 [&>button]:justify-center"
        value={tab}
        onChange={setTab}
        options={[
          { value: "perf", label: "Performance", icon: <Target /> },
          { value: "trend", label: "Tendances", icon: <TrendingUp /> },
        ]}
      />
      {tab === "perf" ? (
        <div className="mt-3 flex min-h-0 flex-1 flex-col">
          <div ref={ringBox} className="relative grid min-h-[92px] flex-1 basis-0 place-items-center overflow-hidden rounded-[14px] border border-line-soft bg-bg">
            <Rings rings={rows} size={ring} />
            <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
              <div>
                <p className="t-num leading-none font-semibold tracking-[-0.02em]" style={{ fontSize: Math.round(ring * 0.15) }}>
                  {today}%
                </p>
                {ring >= 120 && <p className="t-meta mt-0.5">aujourd'hui</p>}
              </div>
            </div>
          </div>
          <ul className="mt-2 flex flex-col">
            {rows.map((r) => (
              <li key={r.key}>
                <Link href={r.href} className="flex items-center gap-2.5 rounded-[10px] px-1.5 py-1 hover:bg-raised/60">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full [&>svg]:size-3.5" style={{ background: `color-mix(in srgb, ${r.to} 15%, transparent)`, color: r.to }}>
                    {r.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] leading-tight font-medium">{r.label}</span>
                    <span className="t-meta block truncate">{r.sub}</span>
                  </span>
                  <span className="t-num text-[12.5px] font-semibold" style={{ color: r.to }}>
                    {r.shown}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div ref={box} className="mt-3 flex min-h-[160px] flex-1 flex-col justify-end">
          <BarChart
            title="Tâches terminées et créées par jour"
            height={Math.max(120, Math.round(size.height) - 56)}
            series={[
              { name: "Terminées", color: "var(--chart-1)" },
              { name: "Créées", color: "color-mix(in srgb, var(--chart-1) 28%, transparent)" },
            ]}
            data={series.map((d) => ({ label: new Date(`${d.d}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" }), values: [d.done, d.created] }))}
          />
        </div>
      )}
    </section>
  );
}
