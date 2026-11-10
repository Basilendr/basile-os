"use client";
import { useId, useMemo, useState } from "react";
import { motion } from "motion/react";

export type Point = { label: string; value: number };

/** Courbe/aire animée, accessible (titre + tableau de valeurs masqué), couleurs par jetons. */
export function AreaChart({ data, height = 160, color = "var(--accent)", format = (v: number) => String(v), title }: { data: Point[]; height?: number; color?: string; format?: (v: number) => string; title: string }) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const W = 600;
  const H = height;
  const pad = { t: 12, r: 8, b: 22, l: 8 };
  const max = Math.max(1, ...data.map((d) => d.value));
  const pts = useMemo(
    () => data.map((d, i) => [pad.l + (i / Math.max(1, data.length - 1)) * (W - pad.l - pad.r), pad.t + (1 - d.value / max) * (H - pad.t - pad.b)] as const),
    [data, max, H], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `${line} L${pts.at(-1)?.[0] ?? 0},${H - pad.b} L${pts[0]?.[0] ?? 0},${H - pad.b} Z`;
  return (
    <figure className="relative w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={title} preserveAspectRatio="none" style={{ height }} onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={`g${id}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.28" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={pad.l} x2={W - pad.r} y1={pad.t + f * (H - pad.t - pad.b)} y2={pad.t + f * (H - pad.t - pad.b)} stroke="var(--line-soft)" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
        ))}
        <motion.path d={area} fill={`url(#g${id})`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6 }} />
        <motion.path d={line} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.8, ease: [0.2, 0.8, 0.2, 1] }} />
        {pts.map((p, i) => (
          <rect key={i} x={p[0] - W / data.length / 2} y={0} width={W / data.length} height={H} fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
        {hover !== null && pts[hover] && (
          <>
            <line x1={pts[hover][0]} x2={pts[hover][0]} y1={pad.t} y2={H - pad.b} stroke="var(--line)" vectorEffect="non-scaling-stroke" />
            <circle cx={pts[hover][0]} cy={pts[hover][1]} r={4} fill={color} stroke="var(--card)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>
      <div className="t-meta mt-1 flex justify-between">
        <span>{data[0]?.label}</span>
        <span>{data.at(-1)?.label}</span>
      </div>
      {hover !== null && data[hover] && (
        <div className="pointer-events-none absolute top-0 rounded-[7px] border border-line bg-card px-2 py-1 text-[12px] shadow-[var(--shadow-md)]" style={{ left: `clamp(0px, calc(${(hover / Math.max(1, data.length - 1)) * 100}% - 40px), calc(100% - 100px))` }}>
          <span className="t-meta block">{data[hover].label}</span>
          <span className="t-num font-semibold">{format(data[hover].value)}</span>
        </div>
      )}
      <table className="sr-only">
        <caption>{title}</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.label}>
              <td>{d.label}</td>
              <td>{format(d.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** Histogramme (une ou deux séries), animé à l'entrée. */
export function BarChart({ data, height = 180, series, format = (v: number) => String(v), title }: { data: { label: string; values: number[] }[]; height?: number; series: { name: string; color: string }[]; format?: (v: number) => string; title: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.flatMap((d) => d.values));
  return (
    <figure className="w-full" aria-label={title}>
      <div className="flex items-end gap-[3px]" style={{ height }} onMouseLeave={() => setHover(null)}>
        {data.map((d, i) => (
          <div key={d.label} className="relative flex h-full flex-1 items-end justify-center gap-[2px]" onMouseEnter={() => setHover(i)}>
            {d.values.map((v, j) => (
              <motion.div
                key={j}
                className="w-full max-w-[22px] rounded-t-[3px]"
                style={{ background: series[j]?.color, opacity: hover === null || hover === i ? 1 : 0.45 }}
                initial={{ height: 0 }}
                animate={{ height: `${(v / max) * 100}%` }}
                transition={{ type: "spring", bounce: 0, visualDuration: 0.5, delay: i * 0.015 }}
              />
            ))}
            {hover === i && (
              <div className="pointer-events-none absolute bottom-full z-10 mb-1 rounded-[7px] border border-line bg-card px-2 py-1 text-[12px] whitespace-nowrap shadow-[var(--shadow-md)]">
                <span className="t-meta block">{d.label}</span>
                {d.values.map((v, j) => (
                  <span key={j} className="t-num block">
                    {series[j]?.name} : <b>{format(v)}</b>
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="t-meta mt-1.5 flex justify-between">
        <span>{data[0]?.label}</span>
        <span>{data.at(-1)?.label}</span>
      </div>
      {series.length > 1 && (
        <div className="t-meta mt-2 flex gap-3">
          {series.map((s) => (
            <span key={s.name} className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-[2px]" style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
      <table className="sr-only">
        <caption>{title}</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.label}>
              <td>{d.label}</td>
              {d.values.map((v, j) => (
                <td key={j}>{format(v)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** Anneau de progression. */
export function Ring({ value, size = 64, color = "var(--accent)", label }: { value: number; size?: number; color?: string; label?: string }) {
  const r = size / 2 - (size > 100 ? 8 : 5);
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label ?? `${value}%`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={size > 100 ? 10 : 6} />
      <motion.circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={size > 100 ? 10 : 6}
        strokeLinecap="round"
        strokeDasharray={c}
        initial={{ strokeDashoffset: c }}
        animate={{ strokeDashoffset: c * (1 - value / 100) }}
        transition={{ type: "spring", bounce: 0, visualDuration: 0.8 }}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fill="var(--fg)" fontSize={size * 0.24} fontWeight={600} className="t-num">
        {value}%
      </text>
    </svg>
  );
}
