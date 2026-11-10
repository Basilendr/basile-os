"use client";
import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import { AreaChart, BarChart } from "@/components/charts/charts";

/**
 * Rendu Markdown minimal et sûr (aucun HTML brut interprété) :
 * titres, listes, tableaux, blocs de code, gras, italique, code, liens internes/externes.
 */
export function Markdown({ content }: { content: string }) {
  const lines = content.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) buf.push(lines[i++]);
      i++;
      const chart = lang === "chart" ? parseChart(buf.join("\n")) : null;
      if (chart) {
        blocks.push(<ChartBlock key={key++} spec={chart} />);
        continue;
      }
      blocks.push(
        <pre key={key++} data-lang={lang}>
          <code>{buf.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const h = line.match(/^(#{1,3})\s+(.*)/);
    if (h) {
      const Tag = (`h${h[1].length}` as "h1" | "h2" | "h3");
      blocks.push(<Tag key={key++}>{inline(h[2])}</Tag>);
      i++;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:-]+\|/.test(lines[i + 1])) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        if (!/^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i])) rows.push(lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
        i++;
      }
      blocks.push(
        <div key={key++} className="overflow-x-auto">
          <table>
            <thead>
              <tr>{rows[0]?.map((c, j) => <th key={j}>{inline(c)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.slice(1).map((r, ri) => (
                <tr key={ri}>{r.map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, ""));
      const L = ordered ? "ol" : "ul";
      blocks.push(<L key={key++}>{items.map((it, j) => <li key={j}>{inline(it)}</li>)}</L>);
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|```|\s*([-*]|\d+\.)\s+|\s*\|)/.test(lines[i])) para.push(lines[i++]);
    blocks.push(<p key={key++}>{inline(para.join(" "))}</p>);
  }
  return <div className="md">{blocks}</div>;
}

function inline(text: string): ReactNode {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("`")) out.push(<code key={k++}>{t.slice(1, -1)}</code>);
    else if (t.startsWith("**")) out.push(<strong key={k++}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("*")) out.push(<em key={k++}>{t.slice(1, -1)}</em>);
    else {
      const mm = t.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/)!;
      const href = mm[2];
      if (href.startsWith("/")) out.push(<Link key={k++} href={href}>{mm[1]}</Link>);
      else if (/^https?:\/\//.test(href))
        out.push(
          <a key={k++} href={href} target="_blank" rel="noopener noreferrer nofollow">
            {mm[1]}
          </a>,
        );
      else out.push(mm[1]);
    }
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <Fragment>{out}</Fragment>;
}

type ChartSpec = { type: "bar" | "line"; title: string; unit: string; data: { label: string; value: number }[] };

/** Bloc ```chart {json}``` produit par l'assistant : validé strictement, sinon affiché comme du code. */
function parseChart(src: string): ChartSpec | null {
  try {
    const j = JSON.parse(src) as Partial<ChartSpec>;
    if (!Array.isArray(j.data) || j.data.length < 2 || j.data.length > 31) return null;
    const data = j.data.map((d) => ({ label: String(d?.label ?? "").slice(0, 24), value: Number(d?.value) }));
    if (data.some((d) => !d.label || !Number.isFinite(d.value))) return null;
    return { type: j.type === "line" ? "line" : "bar", title: String(j.title ?? "Graphique").slice(0, 120), unit: String(j.unit ?? "").slice(0, 12), data };
  } catch {
    return null;
  }
}

function ChartBlock({ spec }: { spec: ChartSpec }) {
  const fmt = (v: number) => `${v.toLocaleString("fr-FR")}${spec.unit ? ` ${spec.unit}` : ""}`;
  return (
    <figure className="not-prose my-3 rounded-[14px] border border-line bg-card p-4">
      <figcaption className="mb-3 text-[13px] font-medium">{spec.title}</figcaption>
      {spec.type === "line" ? (
        <AreaChart data={spec.data} height={160} color="var(--chart-1)" format={fmt} title={spec.title} />
      ) : (
        <BarChart data={spec.data.map((d) => ({ label: d.label, values: [d.value] }))} height={170} series={[{ name: spec.title, color: "var(--chart-1)" }]} format={fmt} title={spec.title} />
      )}
    </figure>
  );
}
