"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, GraduationCap, Mail } from "lucide-react";
import { api } from "@/lib/client/api";
import { formatDueDate, formatTime } from "@/lib/utils";
import { Badge, EmptyState, ErrorState, Skeleton } from "@/components/ui/misc";
import { WidgetCard } from "./widgets";
import { Button } from "@/components/ui/button";
import type { SchoolSummary } from "@/types";

/** Résumé scolaire : cours du jour, devoirs à venir, évaluations, messages École Directe. */
export function SchoolWidget() {
  const { data, error, refetch } = useQuery({ queryKey: ["school", "summary"], queryFn: () => api.get<SchoolSummary>("/api/school/summary"), refetchInterval: 5 * 60_000 });
  if (error) return <WidgetCard title="École"><ErrorState error={error} onRetry={() => refetch()} /></WidgetCard>;
  if (!data) return <WidgetCard title="École"><Skeleton className="h-40" /></WidgetCard>;
  const empty = data.account.status === "disconnected" && !data.lessons.length && !data.homework.length && !data.tests.length;
  const now = Date.now();
  const next = data.lessons.find((l) => new Date(l.endAt).getTime() > now && !l.cancelled);
  return (
    <WidgetCard
      title="École"
      subtitle={data.account.status !== "disconnected" ? [data.account.className, data.account.schoolName].filter(Boolean).join(" · ") || "École Directe" : "Saisie manuelle"}
      action={
        <Link href="/school" className="t-meta hover:text-fg">
          Ouvrir
        </Link>
      }
      bodyClassName="flex flex-col"
    >
      {empty ? (
        <EmptyState
          className="py-0"
          icon={<GraduationCap className="size-5" />}
          title="Emploi du temps, devoirs, notes"
          description="Connecte École Directe ou ajoute tes cours et devoirs à la main."
          action={
            <div className="flex gap-2">
              <Link href="/integrations#ecoledirecte"><Button size="sm" variant="primary">Connecter</Button></Link>
              <Link href="/school?tab=homework"><Button size="sm">Ajouter</Button></Link>
            </div>
          }
        />
      ) : (
        <div className="flex flex-1 flex-col gap-3">
          <div className="grid grid-cols-3 gap-2">
            <Link href="/school?tab=homework" className="rounded-[12px] border border-line-soft bg-bg px-3 py-2.5 hover:border-line">
              <p className="t-num text-[20px] leading-none font-semibold">{data.homework.length}</p>
              <p className="t-meta mt-1">devoir{data.homework.length > 1 ? "s" : ""} · 7 j</p>
            </Link>
            <Link href="/school?tab=evals" className="rounded-[12px] border border-line-soft bg-bg px-3 py-2.5 hover:border-line">
              <p className="t-num text-[20px] leading-none font-semibold">{data.tests.length}</p>
              <p className="t-meta mt-1">éval{data.tests.length > 1 ? "s" : ""} · 21 j</p>
            </Link>
            <Link href="/school?tab=evals" className="rounded-[12px] border border-line-soft bg-bg px-3 py-2.5 hover:border-line">
              <p className="t-num text-[20px] leading-none font-semibold">{data.average !== null ? data.average.toLocaleString("fr-FR") : "—"}</p>
              <p className="t-meta mt-1">moyenne</p>
            </Link>
          </div>
          {next ? (
            <Link href="/school?tab=timetable" className="flex items-center gap-3 rounded-[12px] px-1 py-1 hover:bg-raised/50">
              <span className="h-9 w-[3px] shrink-0 rounded-full" style={{ background: next.color ?? "var(--chart-1)" }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{next.subject}</span>
                <span className="t-meta block truncate">
                  {new Date(next.startAt).getTime() <= now ? "En cours" : "Prochain cours"} · {formatTime(next.startAt)}–{formatTime(next.endAt)}
                  {next.room ? ` · salle ${next.room}` : ""}
                </span>
              </span>
            </Link>
          ) : (
            <p className="t-meta flex items-center gap-2 px-1"><BookOpen className="size-3.5" />Plus de cours aujourd'hui</p>
          )}
          {data.tests[0] && (
            <Link href="/school?tab=evals" className="flex items-center gap-2 px-1 text-[12.5px]">
              <Badge tone="warning">Éval</Badge>
              <span className="min-w-0 flex-1 truncate">{data.tests[0].subject}{data.tests[0].title ? ` — ${data.tests[0].title}` : ""}</span>
              <span className="t-meta">{formatDueDate(data.tests[0].dueDate)}</span>
            </Link>
          )}
          {data.unreadMessages > 0 && (
            <Link href="/inbox?box=school" className="mt-auto flex items-center gap-2 px-1 text-[12.5px] text-accent hover:underline">
              <Mail className="size-3.5" />
              {data.unreadMessages} message{data.unreadMessages > 1 ? "s" : ""} École Directe non lu{data.unreadMessages > 1 ? "s" : ""}
            </Link>
          )}
        </div>
      )}
    </WidgetCard>
  );
}
