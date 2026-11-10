"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpenCheck, CalendarClock, ChevronLeft, ChevronRight, ClipboardList, FileText, FolderOpen, GraduationCap, ListChecks, Plus, RefreshCw, Timer, Trash2, X } from "lucide-react";
import { api, qs } from "@/lib/client/api";
import { addDays, cn, formatDueDate, formatTime, isoDate, startOfDay } from "@/lib/utils";
import { Badge, Card, EmptyState, ErrorState, PageHeader, Skeleton } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/tabs";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { useSchoolAccount } from "@/components/settings/school-connect";
import { DrivePicker, type PickedDoc } from "@/components/quiz/drive-picker";
import { PomodoroView } from "./pomodoro";
import { useSize } from "@/hooks/use-size";
import type { SchoolGrade, SchoolHomework, SchoolLesson } from "@/types";

type Tab = "timetable" | "homework" | "evals" | "focus";
const PALETTE = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "#ff375f", "#5ac8fa", "#a2845e", "#64d2ff"];
/** Couleur stable par matière (École Directe fournit parfois la sienne). */
const subjectColor = (s: string, own?: string | null) => own || PALETTE[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length];

function mondayOf(d: Date) {
  const s = startOfDay(d);
  s.setDate(s.getDate() - ((s.getDay() + 6) % 7));
  return s;
}

export function SchoolView() {
  const sp = useSearchParams();
  const router = useRouter();
  const tab = (["timetable", "homework", "evals", "focus"].includes(sp.get("tab") ?? "") ? sp.get("tab") : "timetable") as Tab;
  const { data: account } = useSchoolAccount();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [syncing, setSyncing] = useState(false);
  const connected = account?.status === "connected";

  return (
    <div className="mx-auto flex min-h-full max-w-[1600px] flex-col px-1 pt-1 pb-4 md:px-3 md:pt-2 lg:h-full">
      <PageHeader
        title="École"
        description={
          account && account.status !== "disconnected"
            ? [account.studentName, account.className, account.schoolName].filter(Boolean).join(" · ")
            : "Emploi du temps, devoirs et évaluations — saisis à la main ou importés d'École Directe."
        }
        actions={
          <>
            {connected ? (
              <Button
                size="sm"
                icon={<RefreshCw className={cn("size-3.5", syncing && "animate-spin")} />}
                disabled={syncing}
                onClick={async () => {
                  setSyncing(true);
                  try {
                    await api.post("/api/school/sync");
                    qc.invalidateQueries({ queryKey: ["school"] });
                    toast({ kind: "success", title: "École Directe synchronisé" });
                  } catch (e) {
                    toast({ kind: "error", title: "Synchronisation échouée", description: (e as Error).message });
                  } finally {
                    setSyncing(false);
                  }
                }}
              >
                Synchroniser
              </Button>
            ) : (
              <Link href="/integrations#ecoledirecte">
                <Button size="sm" icon={<GraduationCap className="size-3.5" />}>
                  {account?.status === "qcm_required" ? "Terminer la connexion" : "Connecter École Directe"}
                </Button>
              </Link>
            )}
          </>
        }
      >
        <Segmented
          value={tab}
          onChange={(v) => router.replace(`/school?tab=${v}`, { scroll: false })}
          options={[
            { value: "timetable", label: "Emploi du temps", icon: <CalendarClock /> },
            { value: "homework", label: "Devoirs", icon: <ClipboardList /> },
            { value: "evals", label: "Évaluations et notes", icon: <BookOpenCheck /> },
            { value: "focus", label: "Pomodoro", icon: <Timer /> },
          ]}
        />
      </PageHeader>
      {account && account.status !== "disconnected" && account.lastError && (
        <p className="mb-4 rounded-[12px] border border-danger/25 bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] px-3 py-2 text-[12.5px] text-danger">École Directe : {account.lastError}</p>
      )}
      {tab === "timetable" ? <Timetable /> : tab === "homework" ? <HomeworkList /> : tab === "focus" ? <PomodoroView /> : <Evaluations />}
    </div>
  );
}

/* ------------------------------------------------------------------ emploi du temps */

function Timetable() {
  const [week, setWeek] = useState(() => mondayOf(new Date()));
  const [adding, setAdding] = useState(false);
  const end = addDays(week, 7);
  const { data, error, refetch } = useQuery({
    queryKey: ["school", "timetable", week.toISOString()],
    queryFn: () => api.get<{ items: SchoolLesson[] }>(`/api/school/timetable${qs({ from: week.toISOString(), to: end.toISOString() })}`),
  });
  const lessons = data?.items ?? [];
  const showWeekend = lessons.some((l) => [0, 6].includes(new Date(l.startAt).getDay()));
  const days = Array.from({ length: showWeekend ? 7 : 5 }, (_, i) => addDays(week, i));
  const today = isoDate();
  const [selected, setSelected] = useState<SchoolLesson | null>(null);
  // Plage horaire : 8 h – 18 h, élargie si un cours déborde ; la hauteur d'une heure s'adapte à l'écran.
  const HOURS = {
    start: Math.min(8, ...lessons.map((l) => new Date(l.startAt).getHours())),
    end: Math.max(18, ...lessons.map((l) => Math.ceil(new Date(l.endAt).getHours() + new Date(l.endAt).getMinutes() / 60))),
  };
  const [body, bodySize] = useSize<HTMLDivElement>();
  const HOUR_PX = Math.max(34, Math.floor((bodySize.height - 58) / (HOURS.end - HOURS.start)) || 48);
  const now = new Date();
  const nowTop = (now.getHours() + now.getMinutes() / 60 - HOURS.start) * HOUR_PX;

  return (
    <Card className="flex min-h-[460px] flex-1 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-4 py-3">
        <Button size="icon-sm" variant="ghost" onClick={() => setWeek(addDays(week, -7))} aria-label="Semaine précédente">
          <ChevronLeft className="size-4" />
        </Button>
        <Button size="icon-sm" variant="ghost" onClick={() => setWeek(addDays(week, 7))} aria-label="Semaine suivante">
          <ChevronRight className="size-4" />
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setWeek(mondayOf(new Date()))}>
          Cette semaine
        </Button>
        <span className="text-[14px] font-medium">
          {week.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })} – {addDays(week, days.length - 1).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
        </span>
        <span className="t-meta ml-auto">{lessons.length ? `${lessons.length} cours` : "Aucun cours cette semaine"}</span>
        <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setAdding(true)}>
          Ajouter un cours
        </Button>
      </div>
      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : !data ? (
        <Skeleton className="m-4 min-h-[300px] flex-1" />
      ) : (
        <div ref={body} className="min-h-0 flex-1 overflow-auto">
          <div className="grid min-w-[720px]" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` }}>
            <div />
            {days.map((d) => (
              <div key={d.toISOString()} className={cn("border-b border-l border-line-soft px-2 py-2.5 text-center", isoDate(d) === today && "bg-[color-mix(in_srgb,var(--accent)_5%,transparent)]")}>
                <p className="t-meta uppercase">{d.toLocaleDateString("fr-FR", { weekday: "short" })}</p>
                <p className={cn("t-num mx-auto mt-0.5 grid size-7 place-items-center rounded-full text-[14px] font-semibold", isoDate(d) === today && "bg-primary text-primary-fg")}>{d.getDate()}</p>
              </div>
            ))}
            <div className="relative" style={{ height: (HOURS.end - HOURS.start) * HOUR_PX }}>
              {Array.from({ length: HOURS.end - HOURS.start }, (_, i) => (
                <span key={i} className="t-meta t-num absolute right-2 -translate-y-1/2" style={{ top: i * HOUR_PX }}>
                  {i ? `${HOURS.start + i}:00` : ""}
                </span>
              ))}
            </div>
            {days.map((d) => {
              const iso = isoDate(d);
              const dayLessons = lessons.filter((l) => isoDate(new Date(l.startAt)) === iso);
              return (
                <div key={iso} className={cn("relative border-l border-line-soft", iso === today && "bg-[color-mix(in_srgb,var(--accent)_3%,transparent)]")} style={{ height: (HOURS.end - HOURS.start) * HOUR_PX }}>
                  {Array.from({ length: HOURS.end - HOURS.start }, (_, i) => (
                    <div key={i} className="absolute inset-x-0 border-t border-line-soft" style={{ top: i * HOUR_PX }} />
                  ))}
                  {iso === today && nowTop > 0 && nowTop < (HOURS.end - HOURS.start) * HOUR_PX && (
                    <div className="absolute inset-x-0 z-10 flex items-center" style={{ top: nowTop }}>
                      <span className="-ml-1 size-2 rounded-full bg-danger" />
                      <span className="h-px flex-1 bg-danger" />
                    </div>
                  )}
                  {dayLessons.map((l) => {
                    const s = new Date(l.startAt);
                    const e = new Date(l.endAt);
                    const top = (s.getHours() + s.getMinutes() / 60 - HOURS.start) * HOUR_PX;
                    const h = Math.max(22, ((e.getTime() - s.getTime()) / 3_600_000) * HOUR_PX - 3);
                    const color = subjectColor(l.subject, l.color);
                    return (
                      <button
                        key={l.id}
                        onClick={() => setSelected(l)}
                        className={cn("focus-ring absolute inset-x-1 overflow-hidden rounded-[9px] border px-2 py-1 text-left transition-shadow hover:shadow-[var(--shadow-md)]", l.cancelled && "opacity-55")}
                        style={{ top: Math.max(0, top) + 1, height: h, background: `color-mix(in srgb, ${color} 12%, var(--card))`, borderColor: `color-mix(in srgb, ${color} 30%, transparent)` }}
                      >
                        <span className="absolute inset-y-1 left-1 w-[3px] rounded-full" style={{ background: color }} />
                        <span className={cn("block truncate pl-1.5 text-[12px] font-semibold", l.cancelled && "line-through")}>{l.subject}</span>
                        {h > 34 && (
                          <span className="t-meta block truncate pl-1.5">
                            {formatTime(s)}–{formatTime(e)}
                            {l.room ? ` · ${l.room}` : ""}
                          </span>
                        )}
                        {h > 52 && l.teacher && <span className="t-meta block truncate pl-1.5">{l.teacher}</span>}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}
      <LessonDialog open={adding} onClose={() => setAdding(false)} defaultDate={isoDate(week) < today && today < isoDate(end) ? today : isoDate(week)} />
      <LessonDetails lesson={selected} onClose={() => setSelected(null)} />
    </Card>
  );
}

function LessonDetails({ lesson, onClose }: { lesson: SchoolLesson | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return (
    <Dialog open={!!lesson} onClose={onClose} title={lesson?.subject} description={lesson ? `${new Date(lesson.startAt).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })} · ${formatTime(lesson.startAt)}–${formatTime(lesson.endAt)}` : undefined} size="sm">
      {lesson && (
        <div className="space-y-3 text-[13px]">
          <dl className="grid grid-cols-[110px_1fr] gap-y-1.5">
            <dt className="text-fg-3">Salle</dt>
            <dd>{lesson.room || "—"}</dd>
            <dt className="text-fg-3">Professeur</dt>
            <dd>{lesson.teacher || "—"}</dd>
            <dt className="text-fg-3">Statut</dt>
            <dd>{lesson.cancelled ? <Badge tone="danger">Annulé</Badge> : <Badge tone="success">Maintenu</Badge>}</dd>
            <dt className="text-fg-3">Source</dt>
            <dd>{lesson.source === "ecoledirecte" ? "École Directe" : "Ajout manuel"}</dd>
          </dl>
          {lesson.source === "manual" && (
            <div className="flex justify-end">
              <Button
                variant="danger"
                size="sm"
                icon={<Trash2 className="size-3.5" />}
                onClick={async () => {
                  try {
                    await api.del(`/api/school/timetable/${lesson.id}`);
                    qc.invalidateQueries({ queryKey: ["school"] });
                    onClose();
                  } catch (e) {
                    toast({ kind: "error", title: "Suppression impossible", description: (e as Error).message });
                  }
                }}
              >
                Supprimer
              </Button>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

function LessonDialog({ open, onClose, defaultDate }: { open: boolean; onClose: () => void; defaultDate: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [v, setV] = useState({ subject: "", teacher: "", room: "", date: defaultDate, start: "08:00", end: "09:00", repeat: "1" });
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Ajouter un cours"
      description="Ajout manuel, visible avec les cours importés d'École Directe."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!v.subject.trim() || v.end <= v.start}
            onClick={async () => {
              setBusy(true);
              try {
                const n = Number(v.repeat);
                for (let i = 0; i < n; i++) {
                  const day = isoDate(addDays(new Date(`${v.date}T12:00:00`), i * 7));
                  await api.post("/api/school/timetable", {
                    subject: v.subject.trim(),
                    teacher: v.teacher.trim() || null,
                    room: v.room.trim() || null,
                    startAt: new Date(`${day}T${v.start}:00`).toISOString(),
                    endAt: new Date(`${day}T${v.end}:00`).toISOString(),
                  });
                }
                qc.invalidateQueries({ queryKey: ["school"] });
                toast({ kind: "success", title: n > 1 ? `${n} cours ajoutés` : "Cours ajouté" });
                setV({ ...v, subject: "", teacher: "", room: "" });
                onClose();
              } catch (e) {
                toast({ kind: "error", title: "Cours non ajouté", description: (e as Error).message });
              } finally {
                setBusy(false);
              }
            }}
          >
            Ajouter
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Matière" className="sm:col-span-2">
          <Input autoFocus value={v.subject} onChange={(e) => setV({ ...v, subject: e.target.value })} placeholder="Mathématiques" />
        </Field>
        <Field label="Professeur">
          <Input value={v.teacher} onChange={(e) => setV({ ...v, teacher: e.target.value })} />
        </Field>
        <Field label="Salle">
          <Input value={v.room} onChange={(e) => setV({ ...v, room: e.target.value })} />
        </Field>
        <Field label="Date">
          <Input type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} />
        </Field>
        <Field label="Répéter chaque semaine">
          <Select value={v.repeat} onChange={(e) => setV({ ...v, repeat: e.target.value })}>
            <option value="1">Non</option>
            <option value="4">4 semaines</option>
            <option value="8">8 semaines</option>
            <option value="16">16 semaines</option>
          </Select>
        </Field>
        <Field label="Début">
          <Input type="time" value={v.start} onChange={(e) => setV({ ...v, start: e.target.value })} />
        </Field>
        <Field label="Fin" error={v.end <= v.start ? "La fin doit être après le début" : undefined}>
          <Input type="time" value={v.end} onChange={(e) => setV({ ...v, end: e.target.value })} />
        </Field>
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ devoirs */

function useHomework(params: { from?: string; to?: string; kind: "all" | "homework" | "test"; done?: "0" | "1" }) {
  return useQuery({ queryKey: ["school", "homework", params], queryFn: () => api.get<{ items: SchoolHomework[] }>(`/api/school/homework${qs(params)}`) });
}

function HomeworkList() {
  const [filter, setFilter] = useState<"todo" | "all" | "done">("todo");
  const [adding, setAdding] = useState<null | { isTest: boolean }>(null);
  const from = isoDate(addDays(new Date(), filter === "todo" ? -14 : -60));
  const { data, error, refetch } = useHomework({ from, kind: "homework", done: filter === "todo" ? "0" : filter === "done" ? "1" : undefined });
  const groups = useMemo(() => {
    const m = new Map<string, SchoolHomework[]>();
    for (const h of data?.items ?? []) m.set(h.dueDate, [...(m.get(h.dueDate) ?? []), h]);
    return [...m.entries()];
  }, [data]);
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-4 py-3">
          <Segmented size="sm" value={filter} onChange={setFilter} options={[{ value: "todo", label: "À faire" }, { value: "all", label: "Tous" }, { value: "done", label: "Faits" }]} />
          <Button size="sm" variant="primary" className="ml-auto" icon={<Plus className="size-3.5" />} onClick={() => setAdding({ isTest: false })}>
            Ajouter un devoir
          </Button>
        </div>
        {error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : !data ? (
          <Skeleton className="m-4 h-64" />
        ) : groups.length === 0 ? (
          <EmptyState icon={<ClipboardList className="size-5" />} title={filter === "todo" ? "Aucun devoir à faire" : "Aucun devoir"} description="Les devoirs d'École Directe apparaissent ici après synchronisation. Tu peux aussi en ajouter." />
        ) : (
          <div className="divide-y divide-line-soft">
            {groups.map(([day, items]) => (
              <section key={day} className="px-4 py-3">
                <h3 className="t-meta mb-1.5 font-medium tracking-wide uppercase">
                  {formatDueDate(day)} · {new Date(`${day}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}
                </h3>
                {items.map((h) => (
                  <HomeworkRow key={h.id} h={h} />
                ))}
              </section>
            ))}
          </div>
        )}
      </Card>
      <UpcomingTests onAdd={() => setAdding({ isTest: true })} />
      <HomeworkDialog open={!!adding} isTest={adding?.isTest ?? false} onClose={() => setAdding(null)} />
    </div>
  );
}

function HomeworkRow({ h }: { h: SchoolHomework }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const late = !h.done && h.dueDate < isoDate();
  return (
    <div className="group rounded-[10px] px-2 py-2 hover:bg-raised/50">
      <div className="flex items-start gap-3">
        <Checkbox
          className="mt-0.5"
          checked={h.done}
          label={h.done ? "Marquer à faire" : "Marquer comme fait"}
          onChange={async (v) => {
            try {
              const r = await api.patch<{ synced: boolean }>(`/api/school/homework/${h.id}`, { done: v });
              qc.invalidateQueries({ queryKey: ["school"] });
              if (!r.synced) toast({ kind: "info", title: "Enregistré dans BASILE OS", description: "École Directe n'a pas pu être mis à jour pour le moment." });
            } catch (e) {
              toast({ kind: "error", title: "Non enregistré", description: (e as Error).message });
            }
          }}
        />
        <button className="min-w-0 flex-1 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span className="flex items-center gap-2">
            <span className="size-2 shrink-0 rounded-full" style={{ background: subjectColor(h.subject) }} />
            <span className={cn("truncate text-[13.5px] font-medium", h.done && "text-fg-3 line-through")}>{h.subject}</span>
            {h.isTest && <Badge tone="warning">Évaluation</Badge>}
            {late && <Badge tone="danger">En retard</Badge>}
            {h.source === "manual" && <Badge>Manuel</Badge>}
          </span>
          {h.title && <span className={cn("t-sub mt-0.5 block", !open && "truncate")}>{h.title}</span>}
        </button>
        {h.source === "manual" && (
          <button
            className="grid size-7 place-items-center rounded-[8px] text-fg-3 opacity-0 group-hover:opacity-100 hover:bg-raised hover:text-danger focus-visible:opacity-100"
            aria-label="Supprimer"
            onClick={async () => {
              await api.del(`/api/school/homework/${h.id}`).catch((e) => toast({ kind: "error", title: "Suppression impossible", description: (e as Error).message }));
              qc.invalidateQueries({ queryKey: ["school"] });
            }}
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>
      {open && h.contentHtml && (
        <iframe
          title={`Détail — ${h.subject}`}
          sandbox=""
          srcDoc={`<!doctype html><meta charset="utf-8"><style>body{font:13px/1.55 -apple-system,system-ui,sans-serif;color:#1d1d1f;margin:0;padding:10px 12px}a{color:#0071e3}img{max-width:100%}</style>${h.contentHtml}`}
          className="mt-2 ml-8 h-40 w-[calc(100%-2rem)] rounded-[10px] border border-line bg-white"
        />
      )}
      {open && (h.teacher || h.givenDate) && (
        <p className="t-meta mt-1.5 ml-8">
          {h.teacher ? `${h.teacher} · ` : ""}
          {h.givenDate ? `donné le ${new Date(`${h.givenDate}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}` : ""}
        </p>
      )}
    </div>
  );
}

function UpcomingTests({ onAdd }: { onAdd: () => void }) {
  const { data } = useHomework({ from: isoDate(), to: isoDate(addDays(new Date(), 30)), kind: "test" });
  return (
    <Card className="h-fit">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div>
          <h3 className="t-section">Évaluations à venir</h3>
          <p className="t-meta">30 prochains jours</p>
        </div>
        <Button size="icon-sm" variant="ghost" onClick={onAdd} aria-label="Ajouter une évaluation">
          <Plus className="size-4" />
        </Button>
      </div>
      <div className="px-2 pb-3">
        {!data ? (
          <Skeleton className="mx-2 h-24" />
        ) : data.items.length === 0 ? (
          <p className="t-meta px-2 py-6 text-center">Aucune évaluation prévue</p>
        ) : (
          data.items.map((t) => (
            <div key={t.id} className="flex items-center gap-3 rounded-[10px] px-2 py-2">
              <div className="t-num w-11 shrink-0 rounded-[9px] border border-line bg-bg py-1 text-center">
                <p className="text-[15px] leading-none font-semibold">{new Date(`${t.dueDate}T12:00:00`).getDate()}</p>
                <p className="t-meta mt-0.5 text-[10px] uppercase">{new Date(`${t.dueDate}T12:00:00`).toLocaleDateString("fr-FR", { month: "short" })}</p>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">{t.subject}</p>
                <p className="t-meta truncate">{t.title || formatDueDate(t.dueDate)}</p>
              </div>
              <Link
                href={`/quiz?eval=${t.id}`}
                title={t.quizSources?.length ? "Quiz de révision" : "Choisir les documents à réviser"}
                className={cn("focus-ring inline-flex h-7 shrink-0 items-center gap-1 rounded-[8px] border px-2 text-[12px] font-medium transition-colors", t.quizSources?.length ? "border-line text-fg-2 hover:bg-raised" : "border-[color-mix(in_srgb,var(--accent)_30%,transparent)] text-accent hover:bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]")}
              >
                <ListChecks className="size-3.5" />
                Quiz
              </Link>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

function HomeworkDialog({ open, onClose, isTest }: { open: boolean; onClose: () => void; isTest: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [v, setV] = useState({ subject: "", title: "", details: "", dueDate: isoDate(addDays(new Date(), 1)), isTest });
  const [busy, setBusy] = useState(false);
  const [docs, setDocs] = useState<PickedDoc[]>([]);
  const [picker, setPicker] = useState(false);
  const t = v.isTest || isTest;
  return (
    <>
    <Dialog
      open={open && !picker}
      onClose={onClose}
      title={isTest ? "Ajouter une évaluation" : "Ajouter un devoir"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!v.subject.trim() || !v.title.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await api.post("/api/school/homework", { subject: v.subject.trim(), title: v.title.trim(), details: v.details || undefined, dueDate: v.dueDate, isTest: t, quizSources: t && docs.length ? docs : undefined });
                qc.invalidateQueries({ queryKey: ["school"] });
                qc.invalidateQueries({ queryKey: ["quiz"] });
                toast({ kind: "success", title: t ? "Évaluation ajoutée" : "Devoir ajouté", description: t && docs.length ? "Tes quiz de révision arriveront 7 jours avant, 3 jours avant et la veille." : undefined });
                setV({ subject: "", title: "", details: "", dueDate: v.dueDate, isTest: false });
                setDocs([]);
                onClose();
              } catch (e) {
                toast({ kind: "error", title: "Non ajouté", description: (e as Error).message });
              } finally {
                setBusy(false);
              }
            }}
          >
            Ajouter
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Matière">
          <Input autoFocus value={v.subject} onChange={(e) => setV({ ...v, subject: e.target.value })} placeholder="Histoire-géographie" />
        </Field>
        <Field label={t ? "Date de l'évaluation" : "Pour le"}>
          <Input type="date" value={v.dueDate} onChange={(e) => setV({ ...v, dueDate: e.target.value })} />
        </Field>
        <Field label={t ? "Sujet de l'évaluation" : "À faire"} className="sm:col-span-2">
          <Input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} placeholder={t ? "Contrôle chapitre 4" : "Exercices 3 à 7 p. 112"} />
        </Field>
        <Field label="Détails" hint="Optionnel" className="sm:col-span-2">
          <Textarea rows={3} value={v.details} onChange={(e) => setV({ ...v, details: e.target.value })} />
        </Field>
        {!isTest && (
          <label className="flex items-center gap-2 text-[13px] sm:col-span-2">
            <Checkbox checked={v.isTest} onChange={(x) => setV({ ...v, isTest: x })} />
            C'est une évaluation (contrôle, interrogation)
          </label>
        )}
        {t && (
          <div className="sm:col-span-2">
            <p className="text-[12.5px] font-medium text-fg-2">Documents à réviser</p>
            <p className="t-meta mt-0.5">Les cours sur lesquels tu seras interrogé : un quiz te sera proposé 7 jours avant, 3 jours avant et la veille.</p>
            {docs.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {docs.map((d) => (
                  <span key={d.id} className="inline-flex h-6 max-w-[240px] items-center gap-1 rounded-[7px] border border-line bg-raised pr-1 pl-2 text-[12px]">
                    <FileText className="size-3 shrink-0 text-fg-3" />
                    <span className="truncate">{d.name}</span>
                    <button type="button" onClick={() => setDocs(docs.filter((x) => x.id !== d.id))} className="shrink-0 text-fg-3 hover:text-fg" aria-label={`Retirer ${d.name}`}>
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <Button size="sm" className="mt-2" icon={<FolderOpen className="size-3.5" />} onClick={() => setPicker(true)}>
              {docs.length ? "Modifier la sélection" : "Choisir dans Google Drive"}
            </Button>
          </div>
        )}
      </div>
    </Dialog>
    <DrivePicker open={open && picker} onClose={() => setPicker(false)} initial={docs} max={15} onConfirm={setDocs} />
    </>
  );
}

/* ------------------------------------------------------------------ évaluations & notes */

function Evaluations() {
  const { data, error, refetch } = useQuery({ queryKey: ["school", "grades"], queryFn: () => api.get<{ items: SchoolGrade[]; averages: { subjects: { subject: string; average: number; count: number }[]; general: number | null } }>("/api/school/grades") });
  const [adding, setAdding] = useState(false);
  const [testAdd, setTestAdd] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();
  const [subject, setSubject] = useState<string | null>(null);
  if (error) return <Card><ErrorState error={error} onRetry={() => refetch()} /></Card>;
  if (!data) return <Skeleton className="h-96 rounded-[18px]" />;
  const avg = data.averages;
  const grades = subject ? data.items.filter((g) => g.subject === subject) : data.items;
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Card className="p-4">
            <p className="text-[13px] font-medium text-fg-2">Moyenne générale</p>
            <p className="t-num mt-3 text-[32px] leading-none font-semibold tracking-[-0.03em]">
              {avg.general !== null ? avg.general.toLocaleString("fr-FR") : "—"}
              <span className="text-[15px] font-medium text-fg-3"> /20</span>
            </p>
            <p className="t-meta mt-2">Moyenne des moyennes par matière (calculée)</p>
          </Card>
          <Card className="p-4">
            <p className="text-[13px] font-medium text-fg-2">Notes</p>
            <p className="t-num mt-3 text-[32px] leading-none font-semibold tracking-[-0.03em]">{data.items.length}</p>
            <p className="t-meta mt-2">{avg.subjects.length} matière{avg.subjects.length > 1 ? "s" : ""}</p>
          </Card>
          <Card className="p-4">
            <p className="text-[13px] font-medium text-fg-2">Meilleure matière</p>
            {avg.subjects.length ? (
              (() => {
                const best = [...avg.subjects].sort((a, b) => b.average - a.average)[0];
                return (
                  <>
                    <p className="t-num mt-3 text-[32px] leading-none font-semibold tracking-[-0.03em]">{best.average.toLocaleString("fr-FR")}</p>
                    <p className="t-meta mt-2 truncate">{best.subject}</p>
                  </>
                );
              })()
            ) : (
              <p className="t-num mt-3 text-[32px] leading-none font-semibold text-fg-3">—</p>
            )}
          </Card>
        </div>
        <Card>
          <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-4 py-3">
            <h3 className="t-section">Notes{subject ? ` · ${subject}` : ""}</h3>
            {subject && (
              <Button size="sm" variant="ghost" onClick={() => setSubject(null)}>
                Toutes les matières
              </Button>
            )}
            <Button size="sm" variant="primary" className="ml-auto" icon={<Plus className="size-3.5" />} onClick={() => setAdding(true)}>
              Ajouter une note
            </Button>
          </div>
          {grades.length === 0 ? (
            <EmptyState icon={<BookOpenCheck className="size-5" />} title="Aucune note" description="Les notes d'École Directe apparaissent après synchronisation. Tu peux aussi les saisir." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-[13px]">
                <thead>
                  <tr className="t-meta text-left">
                    <th className="px-4 py-2 font-medium">Date</th>
                    <th className="px-2 py-2 font-medium">Matière</th>
                    <th className="px-2 py-2 font-medium">Évaluation</th>
                    <th className="px-2 py-2 text-right font-medium">Note</th>
                    <th className="px-2 py-2 text-right font-medium">Coef.</th>
                    <th className="px-2 py-2 text-right font-medium">Classe</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {grades.map((g) => {
                    const v = Number((g.value ?? "").replace(",", "."));
                    const on = Number(g.outOf.replace(",", ".")) || 20;
                    const tone = Number.isNaN(v) ? "neutral" : v / on >= 0.7 ? "success" : v / on >= 0.5 ? "neutral" : "danger";
                    return (
                      <tr key={g.id} className="group border-t border-line-soft hover:bg-raised/40">
                        <td className="t-num px-4 py-2.5 whitespace-nowrap text-fg-2">{new Date(`${g.date}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</td>
                        <td className="px-2 py-2.5">
                          <button className="flex items-center gap-2 hover:underline" onClick={() => setSubject(g.subject)}>
                            <span className="size-2 shrink-0 rounded-full" style={{ background: subjectColor(g.subject) }} />
                            <span className="truncate">{g.subject}</span>
                          </button>
                        </td>
                        <td className="max-w-[260px] truncate px-2 py-2.5 text-fg-2" title={g.comment ?? undefined}>
                          {g.title}
                          {g.nonSignificant && <span className="t-meta"> · non significative</span>}
                        </td>
                        <td className="px-2 py-2.5 text-right">
                          <Badge tone={tone as "success" | "neutral" | "danger"} className="t-num">
                            {g.value ?? "—"}/{g.outOf}
                          </Badge>
                        </td>
                        <td className="t-num px-2 py-2.5 text-right text-fg-2">{g.coef}</td>
                        <td className="t-num px-2 py-2.5 text-right text-fg-3">{g.classAverage || "—"}</td>
                        <td className="pr-2 text-right">
                          {g.source === "manual" && (
                            <button
                              className="grid size-7 place-items-center rounded-[8px] text-fg-3 opacity-0 group-hover:opacity-100 hover:text-danger focus-visible:opacity-100"
                              aria-label="Supprimer la note"
                              onClick={async () => {
                                await api.del(`/api/school/grades/${g.id}`).catch((e) => toast({ kind: "error", title: "Suppression impossible", description: (e as Error).message }));
                                qc.invalidateQueries({ queryKey: ["school"] });
                              }}
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
      <div className="flex flex-col gap-4">
        <UpcomingTests onAdd={() => setTestAdd(true)} />
        <Card>
          <div className="px-4 pt-4 pb-2">
            <h3 className="t-section">Moyennes par matière</h3>
            <p className="t-meta">Sur 20, coefficients inclus</p>
          </div>
          <div className="px-4 pb-4">
            {avg.subjects.length === 0 ? (
              <p className="t-meta py-6 text-center">Pas encore de moyenne</p>
            ) : (
              avg.subjects.map((s) => (
                <button key={s.subject} onClick={() => setSubject(s.subject)} className="block w-full py-1.5 text-left">
                  <span className="flex items-center justify-between gap-2 text-[13px]">
                    <span className="truncate">{s.subject}</span>
                    <span className="t-num font-semibold">{s.average.toLocaleString("fr-FR")}</span>
                  </span>
                  <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-raised">
                    <span className="block h-full rounded-full" style={{ width: `${(s.average / 20) * 100}%`, background: subjectColor(s.subject) }} />
                  </span>
                </button>
              ))
            )}
          </div>
        </Card>
      </div>
      <GradeDialog open={adding} onClose={() => setAdding(false)} />
      <HomeworkDialog open={testAdd} isTest onClose={() => setTestAdd(false)} />
    </div>
  );
}

function GradeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [v, setV] = useState({ subject: "", title: "", value: "", outOf: "20", coef: "1", date: isoDate() });
  const [busy, setBusy] = useState(false);
  const valid = v.subject.trim() && v.title.trim() && /^(\d{1,3}([.,]\d{1,2})?|Abs|Disp|NE)$/i.test(v.value.trim());
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Ajouter une note"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!valid}
            onClick={async () => {
              setBusy(true);
              try {
                await api.post("/api/school/grades", { ...v, subject: v.subject.trim(), title: v.title.trim(), value: v.value.trim() });
                qc.invalidateQueries({ queryKey: ["school"] });
                toast({ kind: "success", title: "Note ajoutée" });
                setV({ ...v, title: "", value: "" });
                onClose();
              } catch (e) {
                toast({ kind: "error", title: "Note non ajoutée", description: (e as Error).message });
              } finally {
                setBusy(false);
              }
            }}
          >
            Ajouter
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Matière">
          <Input autoFocus value={v.subject} onChange={(e) => setV({ ...v, subject: e.target.value })} />
        </Field>
        <Field label="Date">
          <Input type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} />
        </Field>
        <Field label="Évaluation" className="sm:col-span-2">
          <Input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} placeholder="Contrôle chapitre 4" />
        </Field>
        <div className="grid grid-cols-3 gap-3 sm:col-span-2">
          <Field label="Note" hint="Ou Abs, Disp, NE">
            <Input inputMode="decimal" value={v.value} onChange={(e) => setV({ ...v, value: e.target.value })} placeholder="15,5" />
          </Field>
          <Field label="Sur">
            <Input inputMode="decimal" value={v.outOf} onChange={(e) => setV({ ...v, outOf: e.target.value })} />
          </Field>
          <Field label="Coefficient">
            <Input inputMode="decimal" value={v.coef} onChange={(e) => setV({ ...v, coef: e.target.value })} />
          </Field>
        </div>
      </div>
    </Dialog>
  );
}
