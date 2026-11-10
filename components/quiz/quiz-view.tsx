"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, CalendarClock, Check, FileText, Flame, FolderOpen, ListChecks, Loader2, Plus, RefreshCw, RotateCcw, Settings2, Sparkles, Target, Trash2, X } from "lucide-react";
import { api } from "@/lib/client/api";
import { cn, plural } from "@/lib/utils";
import { Badge, Card, CardHeader, EmptyState, ErrorState, PageHeader, Progress, Skeleton, type Tone } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/tabs";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/input";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { DrivePicker, type PickedDoc } from "./drive-picker";

type Attempt = { score: number; total: number; answered: number; completed: boolean };
type Summary = { id: string; kind: string; title: string; subject: string | null; status: string; forDate: string; stage: string | null; homeworkId: string | null; count: number; error: string | null; sources: string[]; attempt: Attempt | null; completed: boolean; best: number | null; createdAt: string };
type Settings = { enabled: boolean; weekdayHour: number; wednesdayHour: number; weekendHour: number; questionCount: number; folderId: string | null; folderName: string | null };
type StageInfo = { stage: string; label: string; date: string; state: "done" | "todo" | "generating" | "error" | "missed" | "upcoming" | string; quizId: string | null; best: number | null };
type EvalInfo = { id: string; subject: string; title: string; details: string; dueDate: string; daysLeft: number; sources: PickedDoc[]; readiness: number | null; stages: StageInfo[]; extra: Summary[] };
type Overview = {
  ready: { drive: boolean; ai: boolean };
  settings: Settings;
  today: { date: string; weekend: boolean; slotHour: number; reached: boolean; state: "waiting" | "none" | "generating" | "ready" | "error" | string; quizzes: Summary[] };
  quizzes: Summary[];
  cards: { due: number; total: number };
  stats: {
    streak: number;
    doneToday: boolean;
    week: { questions: number; correct: number; pct: number | null; quizzes: number };
    subjects: { subject: string; total: number; correct: number; pct: number }[];
    weak: { topic: string; subject: string; lapses: number }[];
    activity: { date: string; questions: number; correct: number }[];
  };
  evals: EvalInfo[];
};

const KIND: Record<string, { label: string; tone: Tone }> = {
  daily: { label: "Quiz du soir", tone: "accent" },
  weekly: { label: "Bilan de la semaine", tone: "violet" },
  eval: { label: "Évaluation", tone: "warning" },
  custom: { label: "Mes documents", tone: "neutral" },
  review: { label: "Mes erreurs", tone: "success" },
};
const scoreTone = (p: number): Tone => (p >= 75 ? "success" : p >= 50 ? "warning" : "danger");
const scoreColor = (p: number) => (p >= 75 ? "var(--success)" : p >= 50 ? "var(--warning)" : "var(--danger)");
const day = (date: string, o: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }) => new Date(`${date}T12:00:00`).toLocaleDateString("fr-FR", o);
const inDays = (n: number) => (n <= 0 ? "aujourd'hui" : n === 1 ? "demain" : `dans ${n} jours`);

export function useQuizOverview() {
  return useQuery({
    queryKey: ["quiz", "overview"],
    queryFn: () => api.get<Overview>("/api/quiz"),
    // Pendant qu'un quiz est en préparation, on suit son avancement de près.
    refetchInterval: (q) => {
      const d = q.state.data;
      if (!d) return 60_000;
      const busy = d.today.state === "generating" || d.quizzes.some((x) => x.status === "generating") || (d.settings.enabled && d.evals.some((e) => e.stages.some((s) => s.state === "generating")));
      return busy ? 3000 : 60_000;
    },
  });
}

function useRun() {
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<void>, failTitle = "Action impossible") => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast({ kind: "error", title: failTitle, description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };
  return { busy, run };
}

/** Quiz de révision : quiz du jour, évaluations à préparer, erreurs à revoir et progression. */
export function QuizView() {
  const sp = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: o, error, refetch } = useQuizOverview();
  const { busy, run } = useRun();
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [picking, setPicking] = useState<string | null>(sp.get("eval"));
  const [removing, setRemoving] = useState<Summary | null>(null);
  const [filter, setFilter] = useState<"todo" | "done" | "all">("todo");
  const refresh = () => qc.invalidateQueries({ queryKey: ["quiz"] });

  const check = () =>
    run("check", async () => {
      const r = await api.post<{ pending: number }>("/api/quiz/check");
      await refresh();
      if (!r.pending) toast({ kind: "info", title: "Aucun nouveau cours pour l'instant", description: "Dès qu'un cours est enregistré dans ton Drive, ton quiz se prépare." });
    });
  const review = () =>
    run("review", async () => {
      const r = await api.post<{ id: string }>("/api/quiz/review");
      router.push(`/quiz/${r.id}`);
    });
  const retry = (id: string) =>
    run(`retry:${id}`, async () => {
      await api.post(`/api/quiz/${id}/regenerate`);
      await refresh();
    });
  const train = (evalId: string) =>
    run(`train:${evalId}`, async () => {
      const r = await api.post<{ id: string }>(`/api/quiz/evals/${evalId}`);
      router.push(`/quiz/${r.id}`);
    });

  const pickEval = o?.evals.find((e) => e.id === picking) ?? null;
  const todayIds = new Set(o?.today.quizzes.map((x) => x.id));
  const others = (o?.quizzes ?? []).filter((x) => !todayIds.has(x.id));
  const todo = others.filter((x) => !x.completed);
  const shown = filter === "todo" ? todo : filter === "done" ? others.filter((x) => x.completed) : others;

  return (
    <div className="mx-auto max-w-[1280px] px-1 pt-1 pb-10 md:px-3 md:pt-2">
      <PageHeader
        title="Quiz"
        description="Tes cours du jour transformés en questions chaque soir, un bilan le week-end et des révisions avant chaque évaluation."
        actions={
          <>
            <Button size="sm" variant="ghost" icon={<Settings2 className="size-3.5" />} onClick={() => setSettingsOpen(true)}>
              Réglages
            </Button>
            <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setCreating(true)}>
              Créer un quiz
            </Button>
          </>
        }
      />

      {error ? (
        <Card>
          <ErrorState error={error} onRetry={() => refetch()} />
        </Card>
      ) : !o ? (
        <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
          <div className="flex min-w-0 flex-col gap-4">
            {(!o.ready.drive || !o.ready.ai) && (
              <Card className="flex flex-wrap items-center gap-3 px-4 py-3">
                <AlertTriangle className="size-4 shrink-0 text-warning" />
                <p className="min-w-0 flex-1 text-[13px]">
                  {!o.ready.drive ? "Connecte Google Drive pour que tes cours soient lus chaque soir." : "Ajoute une clé d'IA dans les paramètres pour que les quiz puissent être rédigés."}
                </p>
                <Link href={!o.ready.drive ? "/integrations" : "/settings?s=config"}>
                  <Button size="sm" variant="primary">
                    {!o.ready.drive ? "Connecter Drive" : "Ouvrir les paramètres"}
                  </Button>
                </Link>
              </Card>
            )}

            <Today o={o} busy={busy} onCheck={check} onReview={review} onRetry={retry} />

            {o.evals.length > 0 && (
              <section className="flex flex-col gap-3">
                <h2 className="t-section px-1">Évaluations à préparer</h2>
                {o.evals.map((e) => (
                  <EvalCard key={e.id} e={e} busy={busy === `train:${e.id}`} onPick={() => setPicking(e.id)} onTrain={() => train(e.id)} />
                ))}
              </section>
            )}

            <Card className="overflow-hidden">
              <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-4 py-3">
                <h2 className="t-section mr-auto">Mes quiz</h2>
                <Segmented size="sm" value={filter} onChange={setFilter} options={[{ value: "todo", label: "À faire", count: todo.length }, { value: "done", label: "Terminés" }, { value: "all", label: "Tous" }]} />
              </div>
              {shown.length === 0 ? (
                <EmptyState
                  icon={<ListChecks className="size-5" />}
                  title={filter === "todo" ? "Rien en attente" : "Aucun quiz pour l'instant"}
                  description={filter === "todo" ? "Tes prochains quiz apparaîtront ici dès qu'ils seront prêts." : "Crée ton premier quiz à partir de tes documents, ou attends celui de ce soir."}
                  action={
                    <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setCreating(true)}>
                      Créer un quiz
                    </Button>
                  }
                />
              ) : (
                <ul className="divide-y divide-line-soft">
                  {shown.map((x) => (
                    <QuizRow key={x.id} x={x} retrying={busy === `retry:${x.id}`} onRetry={() => retry(x.id)} onRemove={() => setRemoving(x)} />
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <aside className="flex min-w-0 flex-col gap-4">
            <Card>
              <CardHeader title="Ma progression" icon={<Target className="size-4" />} />
              <div className="grid grid-cols-3 gap-2 px-4">
                <Stat icon={<Flame className={cn("size-3.5", o.stats.streak > 0 && "text-[var(--tone-orange)]")} />} value={String(o.stats.streak)} label={o.stats.streak > 1 ? "jours de suite" : "jour de suite"} />
                <Stat value={o.stats.week.pct === null ? "—" : `${o.stats.week.pct} %`} label="de réussite sur 7 jours" />
                <Stat value={String(o.stats.week.questions)} label="questions sur 7 jours" />
              </div>
              <div className="px-4 pt-4 pb-4">
                <div className="flex gap-1" role="img" aria-label="Activité des 14 derniers jours">
                  {o.stats.activity.map((a) => (
                    <span
                      key={a.date}
                      title={`${day(a.date)} : ${a.questions ? `${plural(a.questions, "question", "questions")}, ${a.correct} juste${a.correct > 1 ? "s" : ""}` : "aucun quiz"}`}
                      className={cn("h-6 flex-1 rounded-[5px]", a.questions === 0 && "bg-raised", a.date === o.today.date && "ring-1 ring-line ring-offset-1 ring-offset-[var(--card)]")}
                      style={a.questions ? { background: "var(--success)", opacity: 0.35 + 0.65 * Math.min(1, a.questions / 20) } : undefined}
                    />
                  ))}
                </div>
                <p className="t-meta mt-2">{o.stats.doneToday ? "Quiz fait aujourd'hui : la série continue." : o.stats.streak > 0 ? "Fais un quiz aujourd'hui pour garder ta série." : "14 derniers jours"}</p>
              </div>
            </Card>

            <Card>
              <CardHeader title="Mes erreurs à revoir" icon={<RotateCcw className="size-4" />} />
              <div className="px-4 pb-4">
                <p className="text-[13px]">
                  {o.cards.due > 0 ? (
                    <>
                      <span className="t-num text-[22px] font-semibold">{o.cards.due}</span> {o.cards.due > 1 ? "questions à revoir" : "question à revoir"} aujourd'hui
                    </>
                  ) : o.cards.total > 0 ? (
                    "Rien à revoir aujourd'hui."
                  ) : (
                    "Aucune erreur en mémoire."
                  )}
                </p>
                <p className="t-meta mt-1">Une question ratée revient le lendemain, puis au bout de 3, 7, 14 et 30 jours, jusqu'à ce qu'elle soit sue.{o.cards.total > 0 ? ` ${plural(o.cards.total, "question suivie", "questions suivies")}.` : ""}</p>
                <Button className="mt-3 w-full justify-center" variant={o.cards.due > 0 ? "primary" : "secondary"} disabled={o.cards.due === 0} loading={busy === "review"} onClick={review}>
                  Réviser maintenant
                </Button>
              </div>
            </Card>

            {o.stats.subjects.length > 0 && (
              <Card>
                <CardHeader title="Maîtrise par matière" subtitle="30 derniers jours" />
                <ul className="flex flex-col gap-3 px-4 pb-4">
                  {o.stats.subjects.map((s) => (
                    <li key={s.subject}>
                      <div className="mb-1 flex items-baseline justify-between gap-2 text-[13px]">
                        <span className="truncate font-medium">{s.subject}</span>
                        <span className="t-num shrink-0 text-fg-2">
                          {s.pct} % <span className="t-meta">· {s.total} q.</span>
                        </span>
                      </div>
                      <Progress value={s.pct} color={scoreColor(s.pct)} />
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {o.stats.weak.length > 0 && (
              <Card>
                <CardHeader title="Notions à retravailler" />
                <ul className="flex flex-col gap-2 px-4 pb-4">
                  {o.stats.weak.map((w) => (
                    <li key={w.topic} className="flex items-center gap-2 text-[13px]">
                      <span className="min-w-0 flex-1 truncate">{w.topic}</span>
                      <Badge>{w.subject}</Badge>
                      <span className="t-meta t-num shrink-0">×{w.lapses}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </aside>
        </div>
      )}

      <CreateDialog open={creating} onClose={() => setCreating(false)} defaultCount={o?.settings.questionCount ?? 10} />
      {o && <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} settings={o.settings} />}
      <DrivePicker
        open={!!pickEval}
        onClose={() => setPicking(null)}
        initial={pickEval?.sources}
        max={15}
        title={pickEval ? `Documents à réviser · ${pickEval.subject}` : undefined}
        confirmLabel="Enregistrer"
        onConfirm={(sources) => {
          const id = pickEval?.id;
          if (!id) return;
          run("sources", async () => {
            await api.put(`/api/quiz/evals/${id}`, { sources });
            await Promise.all([refresh(), qc.invalidateQueries({ queryKey: ["school"] })]);
            toast({ kind: "success", title: sources.length ? "Documents enregistrés" : "Documents retirés", description: sources.length ? "Tes quiz de révision seront proposés 7 jours avant, 3 jours avant et la veille." : undefined });
          });
        }}
      />
      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        title="Supprimer ce quiz ?"
        description={removing ? `« ${removing.title || "Quiz"} » et tes réponses seront supprimés.` : undefined}
        confirmLabel="Supprimer"
        danger
        loading={busy === "remove"}
        onConfirm={() => {
          const id = removing?.id;
          if (!id) return;
          run("remove", async () => {
            await api.del(`/api/quiz/${id}`);
            await refresh();
            setRemoving(null);
          });
        }}
      />
    </div>
  );
}

function Stat({ value, label, icon }: { value: string; label: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-[11px] border border-line-soft bg-bg px-2.5 py-2">
      <p className="t-num flex items-center gap-1 text-[19px] leading-tight font-semibold">
        {icon}
        {value}
      </p>
      <p className="t-meta mt-0.5 leading-tight">{label}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ quiz du jour */

function Today({ o, busy, onCheck, onReview, onRetry }: { o: Overview; busy: string | null; onCheck: () => void; onReview: () => void; onRetry: (id: string) => void }) {
  const { today } = o;
  const list = today.quizzes;
  const state = today.state;
  const label = today.weekend ? "Bilan de la semaine" : list.length > 1 ? "Quiz du jour par matière" : "Quiz du jour";
  const left = list.filter((x) => x.status === "ready" && !x.completed).length;
  const questions = list.reduce((n, x) => n + x.count, 0);
  let title: string;
  let sub: string;
  if (list.length && state !== "error") {
    title = left === 0 && list.every((x) => x.status === "ready") ? "Tous tes quiz du jour sont faits" : list.length === 1 ? list[0].title || list[0].subject || "Ton quiz du jour" : `${list.length} matières à réviser ce soir`;
    sub = list.some((x) => x.status === "generating") ? "Je lis tes cours et rédige une question par notion : une à deux minutes par matière." : `${plural(questions, "question", "questions")} sur ${list.length > 1 ? "les cours de la journée" : "le cours de la journée"}, une par notion.`;
  } else if (state === "error") {
    title = "Le quiz n'a pas pu être préparé";
    sub = list[0]?.error ?? "Une erreur est survenue pendant la préparation.";
  } else if (state === "waiting") {
    title = today.weekend ? `Ton bilan de la semaine arrive à ${today.slotHour} h` : `Tes quiz arrivent à ${today.slotHour} h`;
    sub = today.weekend ? "Un quiz général sur tous les cours enregistrés dans ton Drive cette semaine." : "Un quiz par matière sur les cours enregistrés dans ton Drive aujourd'hui, avec une question sur chaque notion.";
  } else {
    title = today.weekend ? "Pas de cours repéré cette semaine" : "Pas de nouveau cours repéré aujourd'hui";
    sub = o.settings.folderName ? `Aucun document de cours modifié dans « ${o.settings.folderName} ». Dès qu'un cours est enregistré, ton quiz se prépare.` : "Dès qu'un cours est enregistré dans ton Drive, ton quiz se prépare.";
  }
  const showActions = !list.length || state === "error";
  return (
    <Card className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_140%_at_0%_0%,color-mix(in_srgb,var(--accent)_13%,transparent),transparent_60%)]" />
      <div className="relative flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <div className="grid size-12 shrink-0 place-items-center rounded-[14px] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-accent">
          {state === "generating" ? <Loader2 className="size-6 animate-spin" /> : list.length && left === 0 && state === "ready" ? <Check className="size-6" /> : <Sparkles className="size-6" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="t-meta font-medium tracking-wide uppercase">
            {label} · {day(today.date, { weekday: "long", day: "numeric", month: "long" })}
          </p>
          <h2 className="mt-1 text-[19px] leading-snug font-semibold tracking-[-0.01em] text-balance">{title}</h2>
          <p className={cn("t-sub mt-1", state === "error" && "text-danger")}>{sub}</p>
        </div>
        {showActions && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {state === "error" && list[0] ? (
              <Button variant="primary" icon={<RefreshCw className="size-3.5" />} loading={busy === `retry:${list[0].id}`} onClick={() => onRetry(list[0].id)}>
                Réessayer
              </Button>
            ) : (
              <>
                {state === "none" && o.cards.due > 0 && (
                  <Button variant="primary" loading={busy === "review"} onClick={onReview}>
                    Revoir mes erreurs ({o.cards.due})
                  </Button>
                )}
                <Button variant={state === "none" && o.cards.due > 0 ? "secondary" : "primary"} loading={busy === "check"} disabled={!o.ready.drive || !o.ready.ai} onClick={onCheck}>
                  {state === "waiting" ? "Les préparer maintenant" : "Vérifier à nouveau"}
                </Button>
              </>
            )}
          </div>
        )}
      </div>
      {list.length > 0 && state !== "error" && (
        <ul className="relative grid gap-2 px-5 pb-5 sm:grid-cols-2">
          {list.map((x) => (
            <TodayQuiz key={x.id} x={x} retrying={busy === `retry:${x.id}`} onRetry={() => onRetry(x.id)} />
          ))}
        </ul>
      )}
      {list.length > 0 && state !== "error" && (
        <div className="relative flex justify-end px-5 pb-4 -mt-2">
          <button onClick={onCheck} disabled={busy === "check"} className="focus-ring rounded-[6px] text-[12.5px] text-fg-3 hover:text-fg-2 disabled:opacity-50">
            {busy === "check" ? "Recherche de nouveaux cours…" : "Un cours manque ? Vérifier à nouveau"}
          </button>
        </div>
      )}
    </Card>
  );
}

function TodayQuiz({ x, retrying, onRetry }: { x: Summary; retrying: boolean; onRetry: () => void }) {
  const started = !!x.attempt && x.attempt.answered > 0 && !x.attempt.completed;
  const inner = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[14px] font-semibold">{x.subject ?? "Cours du jour"}</span>
        {x.status === "generating" ? (
          <Badge tone="accent">
            <Loader2 className="size-3 animate-spin" />
            En préparation
          </Badge>
        ) : x.status === "error" ? (
          <Badge tone="danger">Erreur</Badge>
        ) : x.completed && x.best !== null ? (
          <Badge tone={scoreTone(x.best)}>{x.best} %</Badge>
        ) : (
          <span className="inline-flex items-center gap-1 text-[12.5px] font-medium text-accent">
            {started ? "Reprendre" : "Commencer"} <ArrowRight className="size-3.5" />
          </span>
        )}
      </div>
      <p className="t-meta mt-0.5 truncate">{x.status === "error" ? (x.error ?? "Erreur") : x.status === "generating" ? x.sources.join(", ") || "Lecture des cours…" : `${x.title ? `${x.title} · ` : ""}${plural(x.count, "question", "questions")}`}</p>
      {started && (
        <div className="mt-2 flex items-center gap-2">
          <Progress value={(x.attempt!.answered / Math.max(1, x.count)) * 100} />
          <span className="t-meta t-num shrink-0">
            {x.attempt!.answered}/{x.count}
          </span>
        </div>
      )}
    </>
  );
  const cls = "block rounded-[12px] border border-line-soft bg-card/80 px-3.5 py-3 transition-colors";
  return (
    <li>
      {x.status === "error" ? (
        <button onClick={onRetry} disabled={retrying} className={cn(cls, "focus-ring w-full text-left hover:border-line")}>
          {inner}
          <span className="mt-1 inline-flex items-center gap-1 text-[12px] font-medium text-accent">{retrying ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />} Réessayer</span>
        </button>
      ) : (
        <Link href={`/quiz/${x.id}`} className={cn(cls, "focus-ring hover:border-line", x.status === "ready" && !x.completed && "border-[color-mix(in_srgb,var(--accent)_30%,transparent)]")}>
          {inner}
        </Link>
      )}
    </li>
  );
}

/* ------------------------------------------------------------------ évaluations */

const STAGE_TEXT: Record<string, string> = { done: "Fait", todo: "À faire", generating: "En préparation", error: "Erreur", missed: "Passé", upcoming: "À venir" };

function EvalCard({ e, busy, onPick, onTrain }: { e: EvalInfo; busy: boolean; onPick: () => void; onTrain: () => void }) {
  const d = new Date(`${e.dueDate}T12:00:00`);
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="t-num w-12 shrink-0 rounded-[10px] border border-line bg-bg py-1.5 text-center">
          <p className="text-[17px] leading-none font-semibold">{d.getDate()}</p>
          <p className="t-meta mt-0.5 text-[10px] uppercase">{d.toLocaleDateString("fr-FR", { month: "short" })}</p>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-[14.5px] font-semibold">{e.subject}</h3>
            <Badge tone={e.daysLeft <= 1 ? "danger" : e.daysLeft <= 3 ? "warning" : "neutral"}>{inDays(e.daysLeft)}</Badge>
            {e.readiness !== null && <Badge tone={scoreTone(e.readiness)}>Dernier quiz : {e.readiness} %</Badge>}
          </div>
          <p className="t-sub mt-0.5 truncate">{e.title || e.details || day(e.dueDate, { weekday: "long", day: "numeric", month: "long" })}</p>
        </div>
        <Button size="sm" variant="secondary" className="hidden sm:inline-flex" disabled={!e.sources.length} loading={busy} onClick={onTrain}>
          M'entraîner
        </Button>
      </div>

      {e.sources.length === 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-[11px] border border-dashed border-line px-3 py-2.5">
          <FolderOpen className="size-4 shrink-0 text-fg-3" />
          <p className="min-w-0 flex-1 text-[13px] text-fg-2">Sélectionne les documents sur lesquels tu seras interrogé pour recevoir tes quiz de révision.</p>
          <Button size="sm" variant="primary" onClick={onPick}>
            Choisir les documents
          </Button>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {e.sources.slice(0, 5).map((s) => (
            <span key={s.id} className="inline-flex h-6 max-w-[220px] items-center gap-1 rounded-[7px] border border-line bg-raised px-2 text-[12px]">
              <FileText className="size-3 shrink-0 text-fg-3" />
              <span className="truncate">{s.name}</span>
            </span>
          ))}
          {e.sources.length > 5 && <span className="t-meta">+{e.sources.length - 5}</span>}
          <button onClick={onPick} className="focus-ring rounded-[6px] px-1.5 text-[12.5px] font-medium text-accent hover:underline">
            Modifier
          </button>
        </div>
      )}

      <ol className="mt-3 grid grid-cols-3 gap-2">
        {e.stages.map((s) => {
          const inner = (
            <>
              <span className="flex items-center gap-1.5 text-[12.5px] font-medium">
                <span
                  className={cn(
                    "grid size-4 shrink-0 place-items-center rounded-full border",
                    s.state === "done" ? "border-success bg-success text-white" : s.state === "todo" ? "border-accent bg-accent text-white" : s.state === "error" ? "border-danger text-danger" : "border-line text-fg-3",
                  )}
                >
                  {s.state === "done" ? <Check className="size-2.5" strokeWidth={3.5} /> : s.state === "generating" ? <Loader2 className="size-2.5 animate-spin" /> : s.state === "error" ? <X className="size-2.5" strokeWidth={3} /> : null}
                </span>
                {s.label}
              </span>
              <span className="t-meta mt-0.5 block">{day(s.date)}</span>
              <span className={cn("mt-1 block text-[12px]", s.state === "todo" ? "font-medium text-accent" : s.state === "done" ? "text-success" : s.state === "error" ? "text-danger" : "text-fg-3")}>
                {s.state === "done" && s.best !== null ? `Fait · ${s.best} %` : s.state === "upcoming" && !e.sources.length ? "Documents à choisir" : (STAGE_TEXT[s.state] ?? s.state)}
              </span>
            </>
          );
          const cls = cn("block rounded-[11px] border px-2.5 py-2", s.state === "todo" ? "border-[color-mix(in_srgb,var(--accent)_35%,transparent)] bg-[color-mix(in_srgb,var(--accent)_7%,transparent)]" : "border-line-soft bg-bg", s.quizId && "focus-ring transition-colors hover:border-line");
          return (
            <li key={s.stage}>
              {s.quizId ? (
                <Link href={`/quiz/${s.quizId}`} className={cls}>
                  {inner}
                </Link>
              ) : (
                <div className={cls}>{inner}</div>
              )}
            </li>
          );
        })}
      </ol>

      {e.extra.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="t-meta">Entraînements :</span>
          {e.extra.map((x) => (
            <Link key={x.id} href={`/quiz/${x.id}`} className="text-[12.5px] text-accent hover:underline">
              {x.status === "generating" ? "en préparation…" : x.best !== null ? `${x.best} %` : x.status === "error" ? "erreur" : "à faire"}
            </Link>
          ))}
        </div>
      )}
      <Button size="sm" variant="secondary" className="mt-3 w-full justify-center sm:hidden" disabled={!e.sources.length} loading={busy} onClick={onTrain}>
        M'entraîner maintenant
      </Button>
    </Card>
  );
}

/* ------------------------------------------------------------------ liste */

function QuizRow({ x, retrying, onRetry, onRemove }: { x: Summary; retrying: boolean; onRetry: () => void; onRemove: () => void }) {
  const k = KIND[x.kind] ?? KIND.custom;
  const partial = x.attempt && !x.attempt.completed && x.attempt.answered > 0;
  return (
    <li className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-raised/60">
      <Link href={`/quiz/${x.id}`} className="focus-ring flex min-w-0 flex-1 items-center gap-3 rounded-[8px]">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-[13.5px] font-medium">{x.title || (x.status === "generating" ? "Quiz en préparation…" : k.label)}</span>
            <Badge tone={k.tone}>{x.kind === "eval" && x.stage ? `Évaluation · ${x.stage === "j7" ? "J-7" : x.stage === "j3" ? "J-3" : "Veille"}` : k.label}</Badge>
          </div>
          <p className="t-meta mt-0.5 truncate">
            {day(x.forDate)}
            {x.count ? ` · ${plural(x.count, "question", "questions")}` : ""}
            {x.subject ? ` · ${x.subject}` : ""}
            {x.status === "error" && x.error ? ` · ${x.error}` : ""}
          </p>
        </div>
        {x.status === "generating" ? (
          <Badge tone="accent">
            <Loader2 className="size-3 animate-spin" />
            En préparation
          </Badge>
        ) : x.status === "error" ? (
          <Badge tone="danger">Erreur</Badge>
        ) : x.best !== null ? (
          <Badge tone={scoreTone(x.best)}>{x.best} %</Badge>
        ) : partial ? (
          <Badge>
            {x.attempt!.answered} / {x.count}
          </Badge>
        ) : (
          <span className="inline-flex items-center gap-1 text-[12.5px] font-medium text-accent">
            Commencer <ArrowRight className="size-3.5" />
          </span>
        )}
      </Link>
      {x.status === "error" && (
        <Button size="icon-sm" variant="ghost" loading={retrying} onClick={onRetry} aria-label="Réessayer">
          {!retrying && <RefreshCw className="size-3.5" />}
        </Button>
      )}
      <Button size="icon-sm" variant="ghost" className="text-fg-3 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100" onClick={onRemove} aria-label="Supprimer le quiz">
        <Trash2 className="size-3.5" />
      </Button>
    </li>
  );
}

/* ------------------------------------------------------------------ créer un quiz */

function CreateDialog({ open, onClose, defaultCount }: { open: boolean; onClose: () => void; defaultCount: number }) {
  const router = useRouter();
  const { busy, run } = useRun();
  const [docs, setDocs] = useState<PickedDoc[]>([]);
  const [picker, setPicker] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [difficulty, setDifficulty] = useState<"easy" | "normal" | "hard">("normal");
  const [focus, setFocus] = useState("");
  const [title, setTitle] = useState("");
  return (
    <>
      <Dialog
        open={open && !picker}
        onClose={onClose}
        title="Créer un quiz"
        description="Choisis les cours à réviser : l'IA les lit et rédige les questions."
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              Annuler
            </Button>
            <Button
              variant="primary"
              icon={<Sparkles className="size-3.5" />}
              disabled={!docs.length}
              loading={busy === "create"}
              onClick={() =>
                run(
                  "create",
                  async () => {
                    const r = await api.post<{ id: string }>("/api/quiz", { sources: docs, count: count ?? defaultCount, difficulty, focus: focus.trim() || undefined, title: title.trim() || undefined });
                    setDocs([]);
                    setFocus("");
                    setTitle("");
                    onClose();
                    router.push(`/quiz/${r.id}`);
                  },
                  "Quiz non créé",
                )
              }
            >
              Créer le quiz
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div>
            <p className="mb-1.5 text-[12.5px] font-medium text-fg-2">Documents</p>
            {docs.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {docs.map((d) => (
                  <span key={d.id} className="inline-flex h-6 max-w-[240px] items-center gap-1 rounded-[7px] border border-line bg-raised pr-1 pl-2 text-[12px]">
                    <FileText className="size-3 shrink-0 text-fg-3" />
                    <span className="truncate">{d.name}</span>
                    <button onClick={() => setDocs(docs.filter((x) => x.id !== d.id))} className="shrink-0 text-fg-3 hover:text-fg" aria-label={`Retirer ${d.name}`}>
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <Button size="sm" icon={<FolderOpen className="size-3.5" />} onClick={() => setPicker(true)}>
              {docs.length ? "Modifier la sélection" : "Choisir dans Google Drive"}
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nombre de questions">
              <Select value={String(count ?? defaultCount)} onChange={(e) => setCount(Number(e.target.value))}>
                {[...new Set([5, 10, 15, 20, 30, defaultCount])].sort((a, b) => a - b).map((n) => (
                  <option key={n} value={n}>
                    {n} questions
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-medium text-fg-2">Niveau</span>
              <Segmented value={difficulty} onChange={setDifficulty} options={[{ value: "easy", label: "Facile" }, { value: "normal", label: "Normal" }, { value: "hard", label: "Difficile" }]} className="self-start" />
            </div>
          </div>
          <Field label="Sur quoi insister ?" hint="Optionnel — par exemple « les dates », « le vocabulaire », « le chapitre 3 ».">
            <Textarea rows={2} value={focus} onChange={(e) => setFocus(e.target.value)} maxLength={500} className="min-h-[60px]" />
          </Field>
          <Field label="Titre" hint="Optionnel — sinon l'IA en propose un.">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
          </Field>
        </div>
      </Dialog>
      <DrivePicker open={open && picker} onClose={() => setPicker(false)} initial={docs} onConfirm={setDocs} />
    </>
  );
}

/* ------------------------------------------------------------------ réglages */

const HOURS = Array.from({ length: 17 }, (_, i) => i + 6);

function SettingsDialog({ open, onClose, settings }: { open: boolean; onClose: () => void; settings: Settings }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { busy, run } = useRun();
  const [v, setV] = useState(settings);
  const [picker, setPicker] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setV(settings);
  }
  const hour = (label: string, key: "weekdayHour" | "wednesdayHour" | "weekendHour", hint: string) => (
    <Field label={label} hint={hint}>
      <Select value={String(v[key])} onChange={(e) => setV({ ...v, [key]: Number(e.target.value) })}>
        {[...new Set([...HOURS, v[key]])].sort((a, b) => a - b).map((h) => (
          <option key={h} value={h}>
            {h} h
          </option>
        ))}
      </Select>
    </Field>
  );
  return (
    <>
      <Dialog
        open={open && !picker}
        onClose={onClose}
        title="Réglages des quiz"
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              Annuler
            </Button>
            <Button
              variant="primary"
              loading={busy === "save"}
              onClick={() =>
                run(
                  "save",
                  async () => {
                    await api.put("/api/quiz/settings", { enabled: v.enabled, weekdayHour: v.weekdayHour, wednesdayHour: v.wednesdayHour, weekendHour: v.weekendHour, questionCount: v.questionCount, folderId: v.folderId, folderName: v.folderName });
                    await qc.invalidateQueries({ queryKey: ["quiz"] });
                    toast({ kind: "success", title: "Réglages enregistrés" });
                    onClose();
                  },
                  "Réglages non enregistrés",
                )
              }
            >
              Enregistrer
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4 rounded-[11px] border border-line-soft bg-bg px-3 py-2.5">
            <div>
              <p className="text-[13.5px] font-medium">Quiz automatiques</p>
              <p className="t-meta">Quiz du soir, bilan du week-end et révisions avant les évaluations.</p>
            </div>
            <Switch checked={v.enabled} onChange={(x) => setV({ ...v, enabled: x })} label="Quiz automatiques" />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {hour("En semaine", "weekdayHour", "Lun., mar., jeu., ven.")}
            {hour("Le mercredi", "wednesdayHour", "Après-midi libre")}
            {hour("Le week-end", "weekendHour", "Bilan de la semaine")}
          </div>
          <Field label="Questions minimum par matière" hint="Le quiz s'allonge avec le cours : une question par notion, jusqu'à 25.">
            <Select value={String(v.questionCount)} onChange={(e) => setV({ ...v, questionCount: Number(e.target.value) })}>
              {[...new Set([5, 8, 10, 12, 15, 20, v.questionCount])].sort((a, b) => a - b).map((n) => (
                <option key={n} value={n}>
                  {n} questions
                </option>
              ))}
            </Select>
          </Field>
          <div>
            <p className="mb-1.5 text-[12.5px] font-medium text-fg-2">Dossier des cours</p>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex h-8 min-w-0 items-center gap-1.5 rounded-[9px] border border-line bg-raised px-2.5 text-[13px]">
                <FolderOpen className="size-3.5 shrink-0 text-fg-3" />
                <span className="truncate">{v.folderName || "Tout mon Drive"}</span>
              </span>
              <Button size="sm" onClick={() => setPicker(true)}>
                Changer
              </Button>
              {v.folderId && (
                <Button size="sm" variant="ghost" onClick={() => setV({ ...v, folderId: null, folderName: null })}>
                  Tout mon Drive
                </Button>
              )}
            </div>
            <p className="t-meta mt-1.5">Les quiz du soir et du week-end portent sur les documents modifiés dans ce dossier. Limite-le à ton dossier de cours pour ignorer le reste.</p>
          </div>
          <p className="t-meta flex items-start gap-1.5">
            <CalendarClock className="mt-px size-3.5 shrink-0" />
            Avant une évaluation, un quiz est proposé 7 jours avant, 3 jours avant et la veille, aux mêmes horaires.
          </p>
        </div>
      </Dialog>
      <DrivePicker open={open && picker} mode="folder" onClose={() => setPicker(false)} onConfirm={(f) => setV({ ...v, folderId: f[0]?.id ?? null, folderName: f[0]?.name ?? null })} />
    </>
  );
}
