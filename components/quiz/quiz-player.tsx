"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, Check, FileText, Lightbulb, Loader2, RefreshCw, RotateCcw, Sparkles, X } from "lucide-react";
import { api } from "@/lib/client/api";
import { cn, plural, relativeTime } from "@/lib/utils";
import { Badge, Card, ErrorState, Kbd, Progress, Skeleton } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

type Reveal = { answerIndex?: number; answerBool?: boolean; answer?: string; explanation: string; source?: string };
type Answered = { value: string; correct: boolean; feedback?: string };
type Question = { id: string; type: "mcq" | "tf" | "open"; prompt: string; choices?: string[]; subject: string; topic: string; difficulty: number; review: boolean; answered?: Answered; reveal?: Reveal };
type QuizData = {
  id: string;
  kind: string;
  title: string;
  subject: string | null;
  status: string;
  forDate: string;
  stage: string | null;
  error: string | null;
  sources: { id: string; name: string }[];
  count: number;
  homework: { id: string; subject: string; title: string; dueDate: string } | null;
  questions: Question[];
  keyPoints: string[];
  attempt: { score: number; total: number; answered: number; completed: boolean } | null;
  history: { score: number; total: number; at: string }[];
};
type AnswerResult = { correct: boolean; feedback?: string; reveal: Reveal; done: boolean; score: number; total: number; answered: number; keyPoints: string[] };

const KIND: Record<string, string> = { daily: "Quiz du jour", weekly: "Bilan de la semaine", eval: "Révision d'évaluation", custom: "Mes documents", review: "Mes erreurs à revoir" };
const STAGE: Record<string, string> = { j7: "J-7", j3: "J-3", j1: "Veille" };
const LETTERS = ["A", "B", "C", "D", "E"];
const STEPS = ["Lecture de tes cours dans Google Drive…", "Repérage des notions importantes…", "Rédaction des questions…", "Vérification des réponses…"];

const rightText = (q: Question) => (q.type === "mcq" ? (q.choices?.[q.reveal?.answerIndex ?? -1] ?? "") : q.type === "tf" ? (q.reveal?.answerBool ? "Vrai" : "Faux") : (q.reveal?.answer ?? ""));
const givenText = (q: Question) => {
  const v = q.answered?.value ?? "";
  if (!v) return "Pas de réponse";
  return q.type === "mcq" ? (q.choices?.[Number(v)] ?? "") : q.type === "tf" ? (v === "true" ? "Vrai" : "Faux") : v;
};

/** Passage d'un quiz : une question à la fois, correction immédiate, puis le bilan. */
export function QuizPlayer({ id }: { id: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [retrying, setRetrying] = useState(false);
  const { data, error, refetch } = useQuery({
    queryKey: ["quiz", "one", id],
    queryFn: () => api.get<QuizData>(`/api/quiz/${id}`),
    refetchInterval: (q) => (q.state.data?.status === "generating" ? 2000 : false),
  });

  return (
    <div className="mx-auto max-w-[760px] px-1 pt-1 pb-12 md:px-3 md:pt-2">
      <Link href="/quiz" className="focus-ring mb-4 inline-flex items-center gap-1.5 rounded-[7px] text-[13px] text-fg-2 hover:text-fg">
        <ArrowLeft className="size-3.5" />
        Tous les quiz
      </Link>
      {error ? (
        <Card>
          <ErrorState error={error} onRetry={() => refetch()} />
        </Card>
      ) : !data ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-64" />
        </div>
      ) : data.status === "generating" ? (
        <Generating data={data} />
      ) : data.status !== "ready" ? (
        <Card className="flex flex-col items-center px-6 py-12 text-center">
          <div className="mb-3 grid size-11 place-items-center rounded-[12px] bg-raised text-fg-3">
            <X className="size-5" />
          </div>
          <p className="t-section">{data.status === "error" ? "Le quiz n'a pas pu être préparé" : data.status === "empty" ? "Aucun cours à réviser" : "Ce quiz n'est plus disponible"}</p>
          <p className="t-sub mt-1 max-w-md">{data.status === "error" ? (data.error ?? "Une erreur est survenue.") : data.status === "empty" ? "Aucun cours exploitable n'a été trouvé dans ton Drive pour ce jour-là." : "Il a été supprimé."}</p>
          <div className="mt-4 flex gap-2">
            <Link href="/quiz">
              <Button>Retour</Button>
            </Link>
            {data.status !== "dismissed" && (
              <Button
                variant="primary"
                icon={<RefreshCw className="size-3.5" />}
                loading={retrying}
                onClick={async () => {
                  setRetrying(true);
                  try {
                    await api.post(`/api/quiz/${id}/regenerate`);
                    await qc.invalidateQueries({ queryKey: ["quiz"] });
                  } catch (e) {
                    toast({ kind: "error", title: "Impossible de réessayer", description: (e as Error).message });
                  } finally {
                    setRetrying(false);
                  }
                }}
              >
                Réessayer
              </Button>
            )}
          </div>
        </Card>
      ) : (
        <Play key={id} data={data} />
      )}
    </div>
  );
}

function Generating({ data }: { data: QuizData }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => Math.min(STEPS.length - 1, s + 1)), 9000);
    return () => clearInterval(t);
  }, []);
  return (
    <Card className="flex flex-col items-center px-6 py-14 text-center">
      <motion.div
        className="mb-4 grid size-14 place-items-center rounded-[16px] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-accent"
        animate={{ scale: [1, 1.07, 1] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
      >
        <Sparkles className="size-7" />
      </motion.div>
      <p className="text-[17px] font-semibold">Je prépare ton quiz…</p>
      <p className="t-sub mt-1 flex items-center gap-2">
        <Loader2 className="size-3.5 animate-spin" />
        {STEPS[step]}
      </p>
      {data.sources.length > 0 && <p className="t-meta mt-3 max-w-md">{data.sources.map((s) => s.name).join(" · ")}</p>}
      <p className="t-meta mt-4">Une à deux minutes selon la longueur des cours. Tu peux quitter la page : il t'attendra dans « Mes quiz ».</p>
    </Card>
  );
}

function Play({ data }: { data: QuizData }) {
  const qc = useQueryClient();
  const router = useRouter();
  const { toast } = useToast();
  const key = ["quiz", "one", data.id];
  const questions = data.questions;
  const [idx, setIdx] = useState<number | null>(null);
  const [started, setStarted] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState<string | null>(null);
  const [explains, setExplains] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const firstOpen = questions.findIndex((x) => !x.answered);
  const pos = idx ?? (firstOpen === -1 ? questions.length : firstOpen);
  const fresh = !data.attempt || data.attempt.answered === 0;
  const screen: "intro" | "question" | "results" = pos >= questions.length ? "results" : !started && fresh && idx === null ? "intro" : "question";
  const cur = questions[Math.min(pos, questions.length - 1)];
  const answeredCount = questions.filter((x) => x.answered).length;
  const fail = (title: string) => (e: unknown) => toast({ kind: "error", title, description: (e as Error).message });

  const patch = (qid: string, r: AnswerResult, value?: string) =>
    qc.setQueryData<QuizData>(key, (d) =>
      d
        ? {
            ...d,
            questions: d.questions.map((x) => (x.id === qid ? { ...x, answered: { value: value ?? x.answered?.value ?? "", correct: r.correct, feedback: r.feedback }, reveal: r.reveal } : x)),
            attempt: { score: r.score, total: r.total, answered: r.answered, completed: r.done },
            keyPoints: r.done ? r.keyPoints : d.keyPoints,
          }
        : d,
    );

  const submit = async (value: string) => {
    if (sending !== null || cur.answered) return;
    setIdx(pos);
    setSending(value);
    try {
      patch(cur.id, await api.post<AnswerResult>(`/api/quiz/${data.id}/answer`, { questionId: cur.id, value }), value.trim());
    } catch (e) {
      fail("Réponse non enregistrée")(e);
    } finally {
      setSending(null);
    }
  };
  const next = () => {
    setDraft("");
    setIdx(pos + 1);
    // Le bilan récupère l'historique des tentatives et met à jour la page des quiz.
    if (pos + 1 >= questions.length) qc.invalidateQueries({ queryKey: ["quiz"] });
  };
  const act = async (name: string, fn: () => Promise<void>, title: string) => {
    setBusy(name);
    try {
      await fn();
    } catch (e) {
      fail(title)(e);
    } finally {
      setBusy(null);
    }
  };
  const override = () =>
    act(
      "override",
      async () => {
        patch(cur.id, await api.post<AnswerResult>(`/api/quiz/${data.id}/answer`, { questionId: cur.id, override: true }));
      },
      "Impossible de recompter",
    );
  const explain = () =>
    act(
      "explain",
      async () => {
        const r = await api.post<{ text: string }>(`/api/quiz/${data.id}/explain`, { questionId: cur.id });
        setExplains((m) => ({ ...m, [cur.id]: r.text }));
      },
      "Explication indisponible",
    );
  const restart = () =>
    act(
      "restart",
      async () => {
        await api.post(`/api/quiz/${data.id}/restart`);
        await qc.invalidateQueries({ queryKey: key });
        setExplains({});
        setDraft("");
        setStarted(true);
        setIdx(0);
      },
      "Impossible de recommencer",
    );
  const more = () =>
    act(
      "more",
      async () => {
        const r = await api.post<{ id: string }>(`/api/quiz/${data.id}/more`);
        router.push(`/quiz/${r.id}`);
      },
      "Nouvelles questions indisponibles",
    );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA");
      if (screen === "intro") {
        if (e.key === "Enter" && !typing) {
          e.preventDefault();
          setStarted(true);
        }
        return;
      }
      if (screen !== "question") return;
      if (cur.answered) {
        if (e.key === "Enter") {
          e.preventDefault();
          next();
        }
        return;
      }
      if (typing || sending !== null) return;
      const k = e.key.toLowerCase();
      if (cur.type === "mcq") {
        const i = k.length !== 1 ? -1 : "1234".includes(k) ? Number(k) - 1 : "abcd".indexOf(k);
        if (i >= 0 && i < (cur.choices?.length ?? 0)) submit(String(i));
      } else if (cur.type === "tf") {
        if (k === "v" || k === "1") submit("true");
        if (k === "f" || k === "2") submit("false");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const header = (
    <header className="mb-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="accent">
          {KIND[data.kind] ?? "Quiz"}
          {data.stage ? ` · ${STAGE[data.stage] ?? data.stage}` : ""}
        </Badge>
        {data.subject && <Badge>{data.subject}</Badge>}
        {data.homework && <span className="t-meta">Évaluation le {new Date(`${data.homework.dueDate}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}</span>}
      </div>
      <h1 className="t-title mt-2 text-balance">{data.title || "Quiz"}</h1>
    </header>
  );

  if (screen === "intro")
    return (
      <>
        {header}
        <Card className="p-6">
          <p className="text-[15px] font-medium">{plural(questions.length, "question", "questions")} · environ {Math.max(2, Math.round(questions.length * 0.6))} minutes</p>
          <p className="t-sub mt-1">Une question à la fois, avec la correction et l'explication juste après ta réponse. Les questions ratées reviendront les jours suivants jusqu'à ce que tu les saches.</p>
          {data.sources.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {data.sources.map((s) => (
                <span key={s.id} className="inline-flex h-6 max-w-[260px] items-center gap-1 rounded-[7px] border border-line bg-raised px-2 text-[12px]">
                  <FileText className="size-3 shrink-0 text-fg-3" />
                  <span className="truncate">{s.name}</span>
                </span>
              ))}
            </div>
          )}
          <div className="mt-6 flex items-center gap-3">
            <Button variant="primary" icon={<ArrowRight className="size-3.5" />} onClick={() => setStarted(true)} data-autofocus>
              Commencer
            </Button>
            <span className="t-meta hidden items-center gap-1.5 sm:flex">
              ou <Kbd>↵</Kbd>
            </span>
          </div>
        </Card>
      </>
    );

  if (screen === "results") return <Results data={data} header={header} busy={busy} onRestart={restart} onMore={more} />;

  const a = cur.answered;
  const last = pos + 1 >= questions.length;
  return (
    <>
      {header}
      <div className="mb-3 flex items-center gap-3">
        <Progress value={(answeredCount / questions.length) * 100} />
        <span className="t-meta t-num shrink-0">
          {pos + 1} / {questions.length}
        </span>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={cur.id} initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -14 }} transition={{ duration: 0.18, ease: "easeOut" }}>
          <Card className="p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge>{cur.subject}</Badge>
              {cur.topic && <span className="t-meta">{cur.topic}</span>}
              {cur.review && (
                <Badge tone="warning">
                  <RotateCcw className="size-3" />À revoir
                </Badge>
              )}
            </div>
            <h2 className="mt-3 text-[17px] leading-snug font-semibold text-balance">{cur.prompt}</h2>

            {cur.type === "mcq" && (
              <div className="mt-4 flex flex-col gap-2">
                {(cur.choices ?? []).map((c, i) => {
                  const picked = a ? a.value === String(i) : sending === String(i);
                  const right = a && cur.reveal?.answerIndex === i;
                  return (
                    <button
                      key={i}
                      disabled={!!a || sending !== null}
                      onClick={() => submit(String(i))}
                      className={cn(
                        "focus-ring flex items-center gap-3 rounded-[12px] border px-3.5 py-3 text-left text-[14px] transition-[background-color,border-color,transform] duration-100 active:scale-[0.99]",
                        !a && "border-line hover:border-[color-mix(in_srgb,var(--accent)_45%,transparent)] hover:bg-[color-mix(in_srgb,var(--accent)_6%,transparent)]",
                        !a && picked && "border-accent bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]",
                        a && right && "border-success bg-[color-mix(in_srgb,var(--success)_10%,transparent)]",
                        a && picked && !right && "border-danger bg-[color-mix(in_srgb,var(--danger)_9%,transparent)]",
                        a && !right && !picked && "border-line-soft opacity-55",
                      )}
                    >
                      <span className={cn("grid size-6 shrink-0 place-items-center rounded-[7px] border text-[12px] font-semibold", a && right ? "border-success bg-success text-white" : a && picked ? "border-danger bg-danger text-white" : "border-line bg-raised text-fg-2")}>
                        {a && right ? <Check className="size-3.5" strokeWidth={3} /> : a && picked ? <X className="size-3.5" strokeWidth={3} /> : !a && picked ? <Loader2 className="size-3.5 animate-spin" /> : LETTERS[i]}
                      </span>
                      <span className="min-w-0 flex-1">{c}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {cur.type === "tf" && (
              <div className="mt-4 grid grid-cols-2 gap-2">
                {[
                  { v: "true", label: "Vrai", k: "V" },
                  { v: "false", label: "Faux", k: "F" },
                ].map((o) => {
                  const picked = a ? a.value === o.v : sending === o.v;
                  const right = a && String(cur.reveal?.answerBool) === o.v;
                  return (
                    <button
                      key={o.v}
                      disabled={!!a || sending !== null}
                      onClick={() => submit(o.v)}
                      className={cn(
                        "focus-ring flex h-12 items-center justify-center gap-2 rounded-[12px] border text-[14.5px] font-medium transition-[background-color,border-color,transform] duration-100 active:scale-[0.98]",
                        !a && "border-line hover:border-[color-mix(in_srgb,var(--accent)_45%,transparent)] hover:bg-[color-mix(in_srgb,var(--accent)_6%,transparent)]",
                        a && right && "border-success bg-[color-mix(in_srgb,var(--success)_10%,transparent)] text-success",
                        a && picked && !right && "border-danger bg-[color-mix(in_srgb,var(--danger)_9%,transparent)] text-danger",
                        a && !right && !picked && "border-line-soft opacity-55",
                      )}
                    >
                      {!a && picked ? <Loader2 className="size-4 animate-spin" /> : a && right ? <Check className="size-4" /> : a && picked ? <X className="size-4" /> : null}
                      {o.label}
                      {!a && <span className="hidden sm:inline"><Kbd>{o.k}</Kbd></span>}
                    </button>
                  );
                })}
              </div>
            )}

            {cur.type === "open" &&
              (a ? (
                <div className={cn("mt-4 flex items-center gap-2.5 rounded-[12px] border px-3.5 py-3 text-[14px]", a.correct ? "border-success bg-[color-mix(in_srgb,var(--success)_10%,transparent)]" : "border-danger bg-[color-mix(in_srgb,var(--danger)_9%,transparent)]")}>
                  {a.correct ? <Check className="size-4 shrink-0 text-success" /> : <X className="size-4 shrink-0 text-danger" />}
                  <span className="min-w-0 flex-1 break-words">{a.value || "Pas de réponse"}</span>
                </div>
              ) : (
                <form
                  className="mt-4 flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (draft.trim()) submit(draft);
                  }}
                >
                  <Input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ta réponse, en quelques mots" maxLength={300} disabled={sending !== null} className="h-11 text-[15px]" aria-label="Ta réponse" />
                  <Button type="submit" variant="primary" className="h-11" disabled={!draft.trim()} loading={sending !== null}>
                    Valider
                  </Button>
                </form>
              ))}

            {!a && (
              <div className="mt-4 flex items-center justify-between gap-3">
                <button disabled={sending !== null} onClick={() => submit("")} className="focus-ring rounded-[6px] text-[13px] text-fg-3 hover:text-fg-2 disabled:opacity-50">
                  Je ne sais pas
                </button>
                {cur.type === "mcq" && (
                  <span className="t-meta hidden items-center gap-1 sm:flex">
                    <Kbd>A</Kbd>
                    <Kbd>B</Kbd>
                    <Kbd>C</Kbd>
                    <Kbd>D</Kbd>
                  </span>
                )}
              </div>
            )}

            {a && (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="mt-5 border-t border-line-soft pt-4">
                <p className={cn("text-[14px] font-semibold", a.correct ? "text-success" : "text-danger")}>{a.correct ? "Bonne réponse !" : a.value ? "Pas tout à fait" : "À retenir"}</p>
                {a.feedback && <p className="mt-1 text-[13.5px] text-fg-2">{a.feedback}</p>}
                {!a.correct && cur.type !== "mcq" && (
                  <p className="mt-1.5 text-[14px]">
                    Réponse attendue : <span className="font-semibold">{rightText(cur)}</span>
                  </p>
                )}
                {cur.reveal?.explanation && <p className="mt-2 text-[14px] leading-relaxed text-fg-2">{cur.reveal.explanation}</p>}
                {cur.reveal?.source && (
                  <p className="t-meta mt-2 flex items-center gap-1">
                    <FileText className="size-3 shrink-0" />
                    <span className="truncate">{cur.reveal.source}</span>
                  </p>
                )}
                {explains[cur.id] && (
                  <div className="mt-3 rounded-[12px] border border-line-soft bg-bg px-3.5 py-3">
                    <p className="mb-1 flex items-center gap-1.5 text-[12.5px] font-medium text-fg-2">
                      <Lightbulb className="size-3.5" />
                      Explication
                    </p>
                    <p className="text-[14px] leading-relaxed whitespace-pre-wrap">{explains[cur.id]}</p>
                  </div>
                )}
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {!explains[cur.id] && (
                    <Button size="sm" variant="ghost" icon={<Lightbulb className="size-3.5" />} loading={busy === "explain"} onClick={explain}>
                      Je n'ai pas compris
                    </Button>
                  )}
                  {cur.type === "open" && !a.correct && !!a.value && (
                    <Button size="sm" variant="ghost" loading={busy === "override"} onClick={override}>
                      Compter comme juste
                    </Button>
                  )}
                  <Button variant="primary" className="ml-auto" onClick={next} data-autofocus>
                    {last ? "Voir mon résultat" : "Suivant"}
                    <span className="hidden opacity-70 sm:inline">↵</span>
                  </Button>
                </div>
              </motion.div>
            )}
          </Card>
        </motion.div>
      </AnimatePresence>
    </>
  );
}

/* ------------------------------------------------------------------ bilan */

function Results({ data, header, busy, onRestart, onMore }: { data: QuizData; header: React.ReactNode; busy: string | null; onRestart: () => void; onMore: () => void }) {
  const total = data.questions.length;
  const score = data.questions.filter((x) => x.answered?.correct).length;
  const pct = total ? Math.round((score / total) * 100) : 0;
  const wrong = data.questions.filter((x) => x.answered && !x.answered.correct);
  const color = pct >= 75 ? "var(--success)" : pct >= 50 ? "var(--warning)" : "var(--danger)";
  const verdict = pct === 100 ? "Sans faute !" : pct >= 85 ? "Excellent" : pct >= 70 ? "Bien joué" : pct >= 50 ? "En bonne voie" : "À retravailler";
  const R = 44;
  const C = 2 * Math.PI * R;
  return (
    <>
      {header}
      <Card className="flex flex-col items-center gap-5 p-6 sm:flex-row sm:items-center">
        <div className="relative size-[112px] shrink-0">
          <svg viewBox="0 0 104 104" className="size-full -rotate-90" aria-hidden>
            <circle cx="52" cy="52" r={R} fill="none" stroke="var(--line)" strokeWidth="8" />
            <motion.circle cx="52" cy="52" r={R} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" strokeDasharray={C} initial={{ strokeDashoffset: C }} animate={{ strokeDashoffset: C * (1 - pct / 100) }} transition={{ duration: 0.9, ease: [0.2, 0.8, 0.2, 1] }} />
          </svg>
          <div className="absolute inset-0 grid place-items-center">
            <span className="t-num text-[26px] font-semibold">
              {pct}
              <span className="text-[14px] text-fg-3"> %</span>
            </span>
          </div>
        </div>
        <div className="min-w-0 flex-1 text-center sm:text-left">
          <p className="text-[20px] font-semibold">{verdict}</p>
          <p className="t-sub mt-0.5">
            {score} bonne{score > 1 ? "s" : ""} réponse{score > 1 ? "s" : ""} sur {total}
          </p>
          <p className="t-meta mt-2">{wrong.length ? `${plural(wrong.length, "question ratée reviendra", "questions ratées reviendront")} dès demain dans « Mes erreurs à revoir ».` : "Rien à revoir : tout est su."}</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2 sm:justify-start">
            {data.kind !== "review" && data.sources.length > 0 && (
              <Button variant="primary" icon={<Sparkles className="size-3.5" />} loading={busy === "more"} onClick={onMore}>
                Nouvelles questions
              </Button>
            )}
            <Button icon={<RotateCcw className="size-3.5" />} loading={busy === "restart"} onClick={onRestart}>
              Recommencer
            </Button>
            <Link href="/quiz">
              <Button variant="ghost">Retour aux quiz</Button>
            </Link>
          </div>
        </div>
      </Card>

      {data.keyPoints.length > 0 && (
        <Card className="mt-4 p-5">
          <h2 className="t-section flex items-center gap-2">
            <Lightbulb className="size-4 text-fg-3" />
            L'essentiel à retenir
          </h2>
          <ul className="mt-3 flex flex-col gap-2">
            {data.keyPoints.map((k, i) => (
              <li key={i} className="flex gap-2.5 text-[14px] leading-relaxed">
                <span className="mt-[9px] size-1.5 shrink-0 rounded-full bg-accent" />
                {k}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {wrong.length > 0 && (
        <Card className="mt-4 p-5">
          <h2 className="t-section">À revoir</h2>
          <ul className="mt-2 divide-y divide-line-soft">
            {wrong.map((x) => (
              <li key={x.id} className="py-3">
                <p className="text-[14px] font-medium">{x.prompt}</p>
                <p className="mt-1.5 flex items-start gap-1.5 text-[13.5px] text-danger">
                  <X className="mt-0.5 size-3.5 shrink-0" />
                  <span className="min-w-0 break-words">{givenText(x)}</span>
                </p>
                <p className="mt-1 flex items-start gap-1.5 text-[13.5px] text-success">
                  <Check className="mt-0.5 size-3.5 shrink-0" />
                  <span className="min-w-0 break-words">{rightText(x)}</span>
                </p>
                {x.reveal?.explanation && <p className="t-sub mt-1.5">{x.reveal.explanation}</p>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {data.history.length > 1 && (
        <p className="t-meta mt-4 px-1">
          Tentatives : {data.history.map((h) => `${h.score}/${h.total} (${relativeTime(h.at)})`).join(" · ")}
        </p>
      )}
    </>
  );
}
