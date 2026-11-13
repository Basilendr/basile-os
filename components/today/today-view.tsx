"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, CalendarDays, CheckCircle2, ClipboardList, FileText, ListChecks, Mail, Pause, Play, Timer } from "lucide-react";
import { api } from "@/lib/client/api";
import { cn, formatTime } from "@/lib/utils";
import { Badge, ErrorState, PageHeader, Skeleton } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { WidgetCard } from "@/components/overview/widgets";
import { usePomodoro } from "@/components/school/pomodoro";
import { subjectColor } from "@/components/school/school-view";
import type { SchoolDayEvent, SchoolLesson } from "@/types";

type Hw = { id: string; subject: string; title: string; dueDate: string; done: boolean; isTest: boolean };
type QuizSummary = { id: string; title: string; subject: string | null; status: string; count: number; completed: boolean; best: number | null; attempt: { answered: number; total: number; completed: boolean } | null };
type Today = {
  date: string;
  name: string | null;
  school: {
    lessons: SchoolLesson[];
    days: SchoolDayEvent[];
    document: { fileId: number; name: string; fromName: string; date: string } | null;
    nextDate: string;
    nextLessons: { id: string; subject: string; startAt: string }[];
    homeworkToday: Hw[];
    homeworkNext: Hw[];
    homeworkLater: Hw[];
    tests: Hw[];
    unreadMessages: number;
  };
  quiz: { state: string; slotHour: number; quizzes: QuizSummary[]; cardsDue: number; streak: number } | null;
  focus: { todayMinutes: number; sessions: number; streak: number } | null;
  tasks: { id: string; title: string; dueDate: string | null; dueTime: string | null; priority: string; overdue: boolean }[];
  events: { id: string; title: string; startAt: string; endAt: string; allDay: boolean; location: string | null }[];
};

const day = (iso: string, o: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long" }) => new Date(`${iso}T12:00:00`).toLocaleDateString("fr-FR", o);
const daysUntil = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
const relDay = (from: string, to: string) => {
  const n = daysUntil(from, to);
  return n === 0 ? "aujourd'hui" : n === 1 ? "demain" : n < 7 ? day(to, { weekday: "long" }) : day(to, { weekday: "short", day: "numeric", month: "short" });
};
const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? "Bonne nuit" : h < 12 ? "Bonjour" : h < 18 ? "Bon après-midi" : "Bonsoir";
};

/** « Aujourd'hui » : tout ce qui compte pour la journée sur un seul écran. */
export function TodayView() {
  const { data, error, refetch } = useQuery({ queryKey: ["today"], queryFn: () => api.get<Today>("/api/today"), refetchInterval: 60_000 });
  const first = data?.name?.split(" ")[0];
  // L'heure du serveur (UTC) n'est pas celle du navigateur : salutation calculée une fois la page affichée.
  const [hello, setHello] = useState("Bonjour");
  useEffect(() => setHello(greeting()), []);
  return (
    <div className="mx-auto w-full max-w-[1400px] px-1 pt-1 pb-6 md:px-3 md:pt-2">
      <PageHeader
        title={`${hello}${first ? ` ${first}` : ""}`}
        description={data ? day(data.date).replace(/^./, (c) => c.toUpperCase()) : "Ta journée en un coup d'œil."}
        actions={
          <Link href="/" className="hidden md:block">
            <Button size="sm">Accueil</Button>
          </Link>
        }
      />
      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : !data ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className={cn("min-h-[160px] md:min-h-[220px] rounded-[20px]", i === 0 && "xl:row-span-2")} />
          ))}
        </div>
      ) : (
        <div className="rise-in grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Lessons data={data} className="xl:row-span-2" />
          <Homework data={data} />
          <QuizCard data={data} />
          <FocusCard data={data} />
          <Agenda data={data} />
        </div>
      )}
    </div>
  );
}

function Lessons({ data, className }: { data: Today; className?: string }) {
  const now = Date.now();
  const { lessons, days, document } = data.school;
  const off = days.find((d) => d.kind === "holiday" || d.kind === "vacation" || (d.kind === "closed" && !d.startTime));
  const current = lessons.find((l) => !l.cancelled && new Date(l.startAt).getTime() <= now && new Date(l.endAt).getTime() > now);
  const next = lessons.find((l) => !l.cancelled && new Date(l.startAt).getTime() > now);
  const left = lessons.filter((l) => !l.cancelled && new Date(l.endAt).getTime() > now).length;
  return (
    <WidgetCard
      className={cn("md:min-h-[260px]", className)}
      title="Cours du jour"
      subtitle={off ? off.title : lessons.length ? (left ? `${left} cours restant${left > 1 ? "s" : ""}` : "Journée de cours terminée") : "Pas de cours aujourd'hui"}
      action={
        <Link href="/school?tab=timetable" className="t-meta hover:text-fg">
          Emploi du temps
        </Link>
      }
    >
      {days.map((d) => (
        <p key={d.title} className="mb-2 rounded-[10px] border border-line-soft bg-raised px-3 py-2 text-[12.5px] font-medium">
          {d.title}
          {d.startTime ? ` · ${d.startTime}–${d.endTime ?? ""}` : ""}
        </p>
      ))}
      {lessons.length === 0 ? (
        <div className="t-meta flex flex-col gap-2 py-4">
          <span className="flex items-center gap-2">
            <BookOpen className="size-3.5" />
            {off ? "Profite de ta journée." : "Aucun cours prévu."}
          </span>
          {data.school.nextLessons.length > 0 && (
            <span>
              Prochains cours {relDay(data.date, data.school.nextDate)} : {[...new Set(data.school.nextLessons.map((l) => l.subject))].slice(0, 5).join(", ")}
            </span>
          )}
        </div>
      ) : (
        <ol className="flex flex-col gap-1">
          {lessons.map((l) => {
            const past = new Date(l.endAt).getTime() <= now;
            const live = l === current;
            return (
              <li key={l.id} className={cn("flex items-center gap-3 rounded-[12px] px-2 py-1.5", live && "bg-[color-mix(in_srgb,var(--accent)_9%,transparent)]", (past || l.cancelled) && "opacity-55")}>
                <span className="t-num w-[86px] shrink-0 text-[12px] text-fg-2">
                  {formatTime(l.startAt)}–{formatTime(l.endAt)}
                </span>
                <span className="h-8 w-[3px] shrink-0 rounded-full" style={{ background: subjectColor(l.subject, l.color) }} />
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate text-[13px] font-medium", l.cancelled && "line-through")}>{l.subject}</span>
                  <span className="t-meta block truncate">
                    {l.cancelled ? l.change?.note || "Annulé" : [l.room?.replace(/<[^>]*>/g, "").trim() && `salle ${l.room.replace(/<[^>]*>/g, "").trim()}`, l.teacher].filter(Boolean).join(" · ")}
                  </span>
                </span>
                {live && <Badge tone="success">En cours</Badge>}
                {!live && l === next && <Badge>Ensuite</Badge>}
                {l.change && l.change.kind !== "cancelled" && <Badge tone="warning">Modifié</Badge>}
              </li>
            );
          })}
        </ol>
      )}
      {document && (
        <Link href="/school?tab=timetable" className="t-meta mt-3 flex items-center gap-1.5 hover:text-fg">
          <FileText className="size-3.5" />
          Emploi du temps reçu de {document.fromName} le {new Date(document.date).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}
        </Link>
      )}
      {data.school.unreadMessages > 0 && (
        <Link href="/inbox?box=school" className="mt-2 flex items-center gap-1.5 text-[12.5px] text-accent hover:underline">
          <Mail className="size-3.5" />
          {data.school.unreadMessages} message{data.school.unreadMessages > 1 ? "s" : ""} École Directe non lu{data.school.unreadMessages > 1 ? "s" : ""}
        </Link>
      )}
    </WidgetCard>
  );
}

function Homework({ data }: { data: Today }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const s = data.school;
  const toggle = async (h: Hw) => {
    try {
      await api.patch(`/api/school/homework/${h.id}`, { done: !h.done });
      qc.invalidateQueries({ queryKey: ["today"] });
      qc.invalidateQueries({ queryKey: ["school"] });
    } catch (e) {
      toast({ kind: "error", title: "Mise à jour impossible", description: (e as Error).message });
    }
  };
  const nextLabel = relDay(data.date, s.nextDate);
  const row = (h: Hw, when?: string) => (
    <li key={h.id} className="flex items-start gap-2.5 py-1">
      <Checkbox checked={h.done} onChange={() => toggle(h)} />
      <span className={cn("min-w-0 flex-1 text-[13px]", h.done && "text-fg-3 line-through")}>
        <span className="font-medium">{h.subject}</span>
        {h.title ? <span className="text-fg-2"> — {h.title}</span> : null}
      </span>
      {when && <span className="t-meta shrink-0">{when}</span>}
    </li>
  );
  const nothing = !s.homeworkToday.length && !s.homeworkNext.length && !s.homeworkLater.length && !s.tests.length;
  return (
    <WidgetCard
      className="md:min-h-[220px]"
      title={`Devoirs pour ${nextLabel}`}
      subtitle={s.homeworkNext.length ? `${s.homeworkNext.filter((h) => !h.done).length} à faire sur ${s.homeworkNext.length}` : "Rien à rendre"}
      action={
        <Link href="/school?tab=homework" className="t-meta hover:text-fg">
          Tous
        </Link>
      }
    >
      {nothing ? (
        <p className="t-meta flex items-center gap-2 py-4">
          <CheckCircle2 className="size-3.5" />
          Aucun devoir ni évaluation dans les jours qui viennent.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {s.tests.length > 0 && (
            <ul className="flex flex-col gap-1">
              {s.tests.slice(0, 4).map((t) => {
                const n = daysUntil(data.date, t.dueDate);
                return (
                  <li key={t.id} className="flex items-center gap-2 text-[12.5px]">
                    <Badge tone={n <= 2 ? "danger" : "warning"}>{n === 0 ? "Aujourd'hui" : `J-${n}`}</Badge>
                    <span className="min-w-0 flex-1 truncate">
                      Éval {t.subject}
                      {t.title ? ` — ${t.title}` : ""}
                    </span>
                    <Link href="/quiz" className="t-meta shrink-0 hover:text-fg">
                      Réviser
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          {s.homeworkToday.filter((h) => !h.done).length > 0 && (
            <div>
              <p className="t-meta mb-0.5 font-medium">Pour aujourd'hui</p>
              <ul>{s.homeworkToday.filter((h) => !h.done).map((h) => row(h))}</ul>
            </div>
          )}
          {s.homeworkNext.length > 0 && (
            <div>
              <p className="t-meta mb-0.5 font-medium">Pour {nextLabel}</p>
              <ul>{s.homeworkNext.map((h) => row(h))}</ul>
            </div>
          )}
          {s.homeworkLater.length > 0 && (
            <div>
              <p className="t-meta mb-0.5 font-medium">Plus tard</p>
              <ul>{s.homeworkLater.slice(0, 4).map((h) => row(h, relDay(data.date, h.dueDate)))}</ul>
            </div>
          )}
        </div>
      )}
    </WidgetCard>
  );
}

function QuizCard({ data }: { data: Today }) {
  const q = data.quiz;
  return (
    <WidgetCard
      className="md:min-h-[200px]"
      title="Quiz du jour"
      subtitle={!q ? "Indisponible" : q.streak > 0 ? `Série : ${q.streak} jour${q.streak > 1 ? "s" : ""}` : undefined}
      action={
        <Link href="/quiz" className="t-meta hover:text-fg">
          Quiz
        </Link>
      }
    >
      {!q || q.quizzes.length === 0 ? (
        <div className="flex flex-col items-start gap-3 py-2">
          <p className="t-meta flex items-center gap-2">
            <ListChecks className="size-3.5 shrink-0" />
            Choisis le document de ton quiz du jour, et la partie à réviser si tu veux.
          </p>
          <Link href="/quiz">
            <Button size="sm" variant="primary">
              Choisir mon quiz
            </Button>
          </Link>
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {q.quizzes.map((x) => (
            <li key={x.id}>
              <Link href={`/quiz/${x.id}`} className="flex items-center gap-2 rounded-[10px] border border-line-soft px-3 py-2 hover:border-line">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{x.subject || x.title}</span>
                  <span className="t-meta block">{x.status === "generating" ? "En préparation…" : x.status === "error" ? "Échec de création" : `${x.count} questions`}</span>
                </span>
                {x.completed ? <Badge tone="success">{x.best ?? 0} %</Badge> : x.attempt && !x.attempt.completed ? <Badge tone="warning">Reprendre</Badge> : x.status === "ready" ? <Badge>À faire</Badge> : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {q && q.cardsDue > 0 && (
        <Link href="/quiz" className="mt-3 flex items-center gap-1.5 text-[12.5px] text-accent hover:underline">
          <ClipboardList className="size-3.5" />
          {q.cardsDue} question{q.cardsDue > 1 ? "s" : ""} à revoir
        </Link>
      )}
    </WidgetCard>
  );
}

function FocusCard({ data }: { data: Today }) {
  const p = usePomodoro();
  const running = p?.state.running;
  const label = p ? (p.state.phase === "focus" ? "Concentration" : "Pause") : "";
  const remaining = Math.round((p?.state.endAt ? Math.max(0, p.state.endAt - p.now) : (p?.state.remaining ?? 0)) / 1000);
  const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");
  const subject = data.school.lessons.find((l) => !l.cancelled && new Date(l.endAt).getTime() > Date.now())?.subject ?? data.school.homeworkNext[0]?.subject;
  return (
    <WidgetCard
      className="md:min-h-[200px]"
      title="Pomodoro"
      subtitle={data.focus ? `${data.focus.todayMinutes} min de travail aujourd'hui${data.focus.streak > 1 ? ` · ${data.focus.streak} jours d'affilée` : ""}` : undefined}
      action={
        <Link href="/school?tab=focus" className="t-meta hover:text-fg">
          Ouvrir
        </Link>
      }
    >
      {p ? (
        <div className="flex flex-col items-center gap-3 py-2">
          <p className="t-num text-[40px] leading-none font-semibold tracking-tight">
            {mm}:{ss}
          </p>
          <p className="t-meta">
            {label}
            {p.state.subject ? ` · ${p.state.subject}` : ""}
          </p>
          <div className="flex gap-2">
            {running ? (
              <Button size="sm" icon={<Pause className="size-3.5" />} onClick={p.pause}>
                Pause
              </Button>
            ) : (
              <Button
                size="sm"
                variant="primary"
                icon={<Play className="size-3.5" />}
                onClick={() => {
                  if (!p.state.subject && subject) p.setSubject(subject);
                  p.start();
                }}
              >
                {p.state.subject || !subject ? "Démarrer" : `Démarrer · ${subject}`}
              </Button>
            )}
          </div>
        </div>
      ) : (
        <p className="t-meta flex items-center gap-2 py-4">
          <Timer className="size-3.5" />
          Minuteur indisponible.
        </p>
      )}
    </WidgetCard>
  );
}

function Agenda({ data }: { data: Today }) {
  const empty = !data.tasks.length && !data.events.length;
  return (
    <WidgetCard
      className="md:min-h-[200px]"
      title="Tâches et rendez-vous"
      subtitle={empty ? "Rien de prévu" : `${data.events.length} rendez-vous · ${data.tasks.length} tâche${data.tasks.length > 1 ? "s" : ""}`}
      action={
        <Link href="/tasks" className="t-meta hover:text-fg">
          Tâches
        </Link>
      }
    >
      {empty ? (
        <p className="t-meta flex items-center gap-2 py-4">
          <CalendarDays className="size-3.5" />
          Aucune tâche ni rendez-vous aujourd'hui.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {data.events.map((e) => (
            <li key={e.id}>
              <Link href={`/calendar?event=${e.id}`} className="flex items-center gap-2 rounded-[8px] px-1 py-1 text-[13px] hover:bg-raised/60">
                <span className="t-num w-[46px] shrink-0 text-[12px] text-fg-2">{e.allDay ? "Jour" : formatTime(e.startAt)}</span>
                <span className="min-w-0 flex-1 truncate">{e.title}</span>
              </Link>
            </li>
          ))}
          {data.tasks.map((t) => (
            <li key={t.id}>
              <Link href={`/tasks?task=${t.id}`} className="flex items-center gap-2 rounded-[8px] px-1 py-1 text-[13px] hover:bg-raised/60">
                <CheckCircle2 className="size-3.5 shrink-0 text-fg-3" />
                <span className="min-w-0 flex-1 truncate">{t.title}</span>
                {t.overdue && <Badge tone="danger">En retard</Badge>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}
