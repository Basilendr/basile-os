"use client";
import { useMemo, useState } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { useSize } from "@/hooks/use-size";
import { Badge } from "@/components/ui/misc";
import type { SchoolGrade } from "@/types";

type Pt = { date: string; value: number; avg: number; title: string; subject: string };

const num = (s: string | null) => Number(String(s ?? "").replace(",", "."));

/** Notes ramenées sur 20, dans l'ordre, avec la moyenne (coefficients compris) après chaque note. */
export function gradeSeries(grades: SchoolGrade[]): Pt[] {
  const list = grades
    .filter((g) => !g.nonSignificant && !Number.isNaN(num(g.value)) && g.value !== null && g.value !== "")
    .map((g) => ({ g, v: (num(g.value) / (num(g.outOf) || 20)) * 20, c: num(g.coef) || 1 }))
    .sort((a, b) => a.g.date.localeCompare(b.g.date));
  let sum = 0;
  let w = 0;
  return list.map(({ g, v, c }) => {
    sum += v * c;
    w += c;
    return { date: g.date, value: Math.round(v * 10) / 10, avg: Math.round((sum / w) * 100) / 100, title: g.title, subject: g.subject };
  });
}

/** Matières dont la moyenne a baissé d'au moins 0,5 point sur les 30 derniers jours. */
export function droppingSubjects(grades: SchoolGrade[], today = new Date().toISOString().slice(0, 10)) {
  const since = new Date(Date.parse(`${today}T12:00:00Z`) - 30 * 86_400_000).toISOString().slice(0, 10);
  const subjects = [...new Set(grades.map((g) => g.subject))];
  return subjects
    .map((subject) => {
      const s = gradeSeries(grades.filter((g) => g.subject === subject));
      const before = [...s].reverse().find((p) => p.date < since);
      const now = s.at(-1);
      return before && now && now.date >= since ? { subject, before: before.avg, now: now.avg, delta: Math.round((now.avg - before.avg) * 100) / 100 } : null;
    })
    .filter((x): x is { subject: string; before: number; now: number; delta: number } => !!x && x.delta <= -0.5)
    .sort((a, b) => a.delta - b.delta);
}

const shortDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });

/** Évolution des notes : chaque note (point) et la moyenne qui en découle (ligne), sur 20. */
export function GradeTrend({ grades, subject }: { grades: SchoolGrade[]; subject: string | null }) {
  const pts = useMemo(() => gradeSeries(subject ? grades.filter((g) => g.subject === subject) : grades), [grades, subject]);
  const dropping = useMemo(() => (subject ? [] : droppingSubjects(grades)), [grades, subject]);
  const [ref, size] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const W = Math.max(280, size.width || 600);
  const H = 200;
  const pad = { l: 28, r: 12, t: 10, b: 22 };
  const x = (i: number) => pad.l + (pts.length <= 1 ? (W - pad.l - pad.r) / 2 : (i / (pts.length - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - v / 20) * (H - pad.t - pad.b);
  const last = pts.at(-1);
  const first = pts[0];
  const trend = last && first && pts.length > 1 ? Math.round((last.avg - first.avg) * 100) / 100 : null;
  const h = hover !== null ? pts[hover] : null;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 pt-4">
        <h3 className="t-section">Évolution{subject ? ` · ${subject}` : ""}</h3>
        {trend !== null && (
          <span className="t-meta flex items-center gap-1">
            {trend >= 0 ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
            {trend >= 0 ? "+" : ""}
            {trend.toLocaleString("fr-FR")} pt depuis le {shortDate(first.date)}
          </span>
        )}
        <span className="t-meta ml-auto flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span className="h-[2px] w-4 rounded-full bg-accent" />
            Moyenne
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-fg-3" />
            Notes
          </span>
        </span>
      </div>
      {dropping.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-4 pt-2">
          {dropping.slice(0, 4).map((d) => (
            <Badge key={d.subject} tone="danger" className="gap-1">
              <TrendingDown className="size-3" />
              {d.subject} en baisse : {d.before.toLocaleString("fr-FR")} → {d.now.toLocaleString("fr-FR")}
            </Badge>
          ))}
        </div>
      )}
      <div ref={ref} className="relative px-2 pb-3">
        {pts.length === 0 ? (
          <p className="t-meta py-10 text-center">Pas encore de note chiffrée.</p>
        ) : (
          <svg width={W} height={H} role="img" aria-label={`Évolution de la moyenne${subject ? ` en ${subject}` : ""} : ${last?.avg.toLocaleString("fr-FR")} sur 20 après ${pts.length} notes`} onMouseLeave={() => setHover(null)}>
            {[0, 5, 10, 15, 20].map((v) => (
              <g key={v}>
                <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="var(--line-soft)" strokeWidth={1} strokeDasharray={v === 10 ? "3 3" : undefined} />
                <text x={pad.l - 6} y={y(v) + 3.5} textAnchor="end" className="fill-fg-3 text-[10px]">
                  {v}
                </text>
              </g>
            ))}
            {pts.length > 1 && <polyline fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" points={pts.map((p, i) => `${x(i)},${y(p.avg)}`).join(" ")} />}
            {pts.map((p, i) => (
              <circle key={i} cx={x(i)} cy={y(p.value)} r={hover === i ? 5 : 4} fill="var(--fg-3)" stroke="var(--card)" strokeWidth={2} />
            ))}
            {h && hover !== null && (
              <>
                <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="var(--line)" strokeWidth={1} />
                <circle cx={x(hover)} cy={y(h.avg)} r={4.5} fill="var(--accent)" stroke="var(--card)" strokeWidth={2} />
              </>
            )}
            {first && (
              <text x={pad.l} y={H - 6} className="fill-fg-3 text-[10px]">
                {shortDate(first.date)}
              </text>
            )}
            {last && pts.length > 1 && (
              <text x={W - pad.r} y={H - 6} textAnchor="end" className="fill-fg-3 text-[10px]">
                {shortDate(last.date)}
              </text>
            )}
            {/* Zones de survol plus larges que les points. */}
            {pts.map((_, i) => (
              <rect key={i} x={x(i) - Math.max(8, (W - pad.l - pad.r) / Math.max(1, pts.length) / 2)} y={0} width={Math.max(16, (W - pad.l - pad.r) / Math.max(1, pts.length))} height={H} fill="transparent" onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)} />
            ))}
          </svg>
        )}
        {h && hover !== null && (
          <div className="pointer-events-none absolute top-1 z-10 max-w-[220px] rounded-[10px] border border-line bg-card px-2.5 py-1.5 text-[12px] shadow-[var(--shadow-md)]" style={{ left: Math.min(Math.max(8, x(hover) - 80), W - 220) }}>
            <p className="t-meta">
              {shortDate(h.date)} · {h.subject}
            </p>
            <p className="truncate font-medium">{h.title || "Note"}</p>
            <p className="t-num">
              Note {h.value.toLocaleString("fr-FR")}/20 · moyenne {h.avg.toLocaleString("fr-FR")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
