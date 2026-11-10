"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { Coffee, Flame, Minus, Pause, Play, Plus, RotateCcw, SkipForward, Timer, Trash2, Volume2, VolumeX } from "lucide-react";
import { api } from "@/lib/client/api";
import { cn, formatDuration, formatTime, isoDate } from "@/lib/utils";
import { Badge, Card, CardHeader, EmptyState, Progress, Skeleton } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch } from "@/components/ui/input";
import { Segmented } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";

/* ------------------------------------------------------------------ état du minuteur (partagé par toute l'application) */

export type Phase = "focus" | "short" | "long";
type Settings = { focus: number; short: number; long: number; every: number; autoBreak: boolean; autoFocus: boolean; sound: boolean };
type State = {
  phase: Phase;
  running: boolean;
  /** Fin prévue (ms) quand le minuteur tourne. */
  endAt: number | null;
  /** Temps restant (ms) quand il est arrêté ou en pause. */
  remaining: number;
  /** Durée totale de la phase en cours (ms), ajustable avec ±5 min. */
  total: number;
  /** Début de la séance de travail en cours (pour l'enregistrer). */
  startedAt: number | null;
  /** Séances de travail terminées dans le cycle. */
  cycle: number;
  subject: string;
  homeworkId: string | null;
  settings: Settings;
};

const KEY = "bos.pomodoro.v1";
const DEFAULTS: Settings = { focus: 25, short: 5, long: 15, every: 4, autoBreak: true, autoFocus: false, sound: true };
export const PHASE_LABEL: Record<Phase, string> = { focus: "Travail", short: "Pause courte", long: "Pause longue" };
const minutesOf = (s: Settings, p: Phase) => (p === "focus" ? s.focus : p === "short" ? s.short : s.long);
const fresh = (settings: Settings, phase: Phase, keep?: Partial<State>): State => ({
  subject: "",
  homeworkId: null,
  cycle: 0,
  ...keep,
  settings,
  phase,
  running: false,
  endAt: null,
  remaining: minutesOf(settings, phase) * 60_000,
  total: minutesOf(settings, phase) * 60_000,
  startedAt: null,
});

function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as State;
      return { ...s, settings: { ...DEFAULTS, ...s.settings } };
    }
  } catch {}
  return fresh(DEFAULTS, "focus");
}
function save(s: State) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {}
}

export const left = (s: State, now = Date.now()) => Math.max(0, s.running && s.endAt ? s.endAt - now : s.remaining);
export const clock = (ms: number) => {
  const t = Math.ceil(ms / 1000);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};

/** Trois notes douces à la fin d'une phase. */
function chime() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [0, 0.22, 0.44].forEach((t, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = [880, 1046.5, 1318.5][i];
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.5);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.55);
    });
    setTimeout(() => ctx.close().catch(() => null), 1500);
  } catch {}
}

type Ctx = {
  state: State;
  now: number;
  ready: boolean;
  start: () => void;
  pause: () => void;
  reset: () => void;
  skip: () => void;
  adjust: (minutes: number) => void;
  setPhase: (p: Phase) => void;
  setSubject: (subject: string, homeworkId?: string | null) => void;
  setSettings: (s: Partial<Settings>) => void;
};
const PomodoroCtx = createContext<Ctx | null>(null);
export const usePomodoro = () => useContext(PomodoroCtx);

/**
 * Minuteur Pomodoro global : il continue de tourner quand on change de page (fin calculée à partir de l'heure),
 * est partagé entre les onglets, sonne et prévient à la fin de chaque phase et enregistre les séances de travail.
 */
export function PomodoroProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(() => fresh(DEFAULTS, "focus"));
  const [ready, setReady] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const ref = useRef(state);
  const qc = useQueryClient();
  const { toast } = useToast();
  const baseTitle = useRef<string | null>(null);

  const commit = useCallback((next: State) => {
    ref.current = next;
    setState(next);
    save(next);
  }, []);

  useEffect(() => {
    commit(load());
    setReady(true);
    const onStorage = (e: StorageEvent) => {
      if (e.key !== KEY) return;
      const s = load();
      ref.current = s;
      setState(s);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [commit]);

  const record = useCallback(
    (s: State, minutes: number, completed: boolean) => {
      if (!s.subject || minutes < 1) return;
      api
        .post("/api/school/focus", { subject: s.subject, homeworkId: s.homeworkId, minutes, completed, startedAt: new Date(s.startedAt ?? Date.now() - minutes * 60_000).toISOString(), endedAt: new Date().toISOString() })
        .then(() => qc.invalidateQueries({ queryKey: ["school", "focus"] }))
        .catch(() => null);
    },
    [qc],
  );

  /** Fin d'une phase : séance enregistrée, pause (longue après N séances) ou retour au travail. */
  const finish = useCallback(() => {
    const s = load();
    // Un autre onglet a déjà traité cette fin de phase.
    if (!s.running || !s.endAt || s.endAt > Date.now() || s.endAt !== ref.current.endAt) {
      ref.current = s;
      setState(s);
      return;
    }
    let next: State;
    let title: string;
    let body: string;
    if (s.phase === "focus") {
      const minutes = Math.round(s.total / 60_000);
      record(s, minutes, true);
      const cycle = s.cycle + 1;
      const phase: Phase = cycle % s.settings.every === 0 ? "long" : "short";
      next = fresh(s.settings, phase, { subject: s.subject, homeworkId: s.homeworkId, cycle });
      if (s.settings.autoBreak) next = { ...next, running: true, endAt: Date.now() + next.total, remaining: next.total };
      title = `Séance terminée${s.subject ? ` · ${s.subject}` : ""}`;
      body = `${minutes} min de travail. ${phase === "long" ? "Pause longue" : "Pause"} de ${minutesOf(s.settings, phase)} min${s.settings.autoBreak ? "" : " quand tu veux"}.`;
    } else {
      next = fresh(s.settings, "focus", { subject: s.subject, homeworkId: s.homeworkId, cycle: s.phase === "long" ? 0 : s.cycle });
      if (s.settings.autoFocus) next = { ...next, running: true, endAt: Date.now() + next.total, remaining: next.total, startedAt: Date.now() };
      title = "Fin de la pause";
      body = s.settings.autoFocus ? `C'est reparti pour ${s.settings.focus} min.` : "Lance la prochaine séance quand tu es prêt.";
    }
    commit(next);
    if (s.settings.sound) chime();
    toast({ kind: "success", title, description: body });
    try {
      if ("Notification" in window && Notification.permission === "granted" && document.visibilityState !== "visible") new Notification(title, { body, tag: "pomodoro" });
    } catch {}
  }, [commit, record, toast]);

  useEffect(() => {
    if (!state.running) return;
    const t = setInterval(() => {
      setNow(Date.now());
      if (ref.current.running && ref.current.endAt && Date.now() >= ref.current.endAt) finish();
    }, 250);
    return () => clearInterval(t);
  }, [state.running, finish]);

  // Temps restant dans le titre de l'onglet pendant une séance.
  useEffect(() => {
    if (!document.title.startsWith("⏱")) baseTitle.current = document.title;
    const active = state.running || state.remaining < state.total;
    if (active) document.title = `⏱ ${clock(left(state, now))} · ${state.phase === "focus" ? state.subject || "Travail" : PHASE_LABEL[state.phase]}${state.running ? "" : " (pause)"}`;
    else if (baseTitle.current && document.title.startsWith("⏱")) document.title = baseTitle.current;
  }, [state, now]);

  const value = useMemo<Ctx>(() => {
    const s = state;
    return {
      state: s,
      now,
      ready,
      start: () => {
        try {
          if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission();
        } catch {}
        const r = left(s);
        commit({ ...s, running: true, endAt: Date.now() + r, startedAt: s.phase === "focus" ? (s.startedAt ?? Date.now()) : s.startedAt });
        setNow(Date.now());
      },
      pause: () => commit({ ...s, running: false, endAt: null, remaining: left(s) }),
      reset: () => {
        // Une séance de travail interrompue compte quand même le temps passé.
        if (s.phase === "focus" && s.startedAt) record(s, Math.floor((s.total - left(s)) / 60_000), false);
        commit(fresh(s.settings, s.phase, { subject: s.subject, homeworkId: s.homeworkId, cycle: s.cycle }));
      },
      skip: () => {
        if (s.phase === "focus" && s.startedAt) record(s, Math.floor((s.total - left(s)) / 60_000), false);
        const phase: Phase = s.phase === "focus" ? ((s.cycle + 1) % s.settings.every === 0 ? "long" : "short") : "focus";
        commit(fresh(s.settings, phase, { subject: s.subject, homeworkId: s.homeworkId, cycle: s.phase === "focus" ? s.cycle + 1 : s.phase === "long" ? 0 : s.cycle }));
      },
      adjust: (minutes) => {
        const delta = minutes * 60_000;
        const r = left(s);
        if (r + delta < 60_000) return;
        commit({ ...s, total: Math.max(60_000, s.total + delta), remaining: r + delta, endAt: s.running && s.endAt ? s.endAt + delta : s.endAt });
      },
      setPhase: (phase) => {
        if (s.phase === "focus" && s.startedAt) record(s, Math.floor((s.total - left(s)) / 60_000), false);
        commit(fresh(s.settings, phase, { subject: s.subject, homeworkId: s.homeworkId, cycle: s.cycle }));
      },
      setSubject: (subject, homeworkId = null) => commit({ ...s, subject, homeworkId }),
      setSettings: (patch) => {
        const settings = { ...s.settings, ...patch };
        const idle = !s.running && s.remaining === s.total;
        commit(idle ? fresh(settings, s.phase, { subject: s.subject, homeworkId: s.homeworkId, cycle: s.cycle }) : { ...s, settings });
      },
    };
  }, [state, now, ready, commit, record]);

  return <PomodoroCtx.Provider value={value}>{children}</PomodoroCtx.Provider>;
}

/** Pastille de la barre supérieure : temps restant, visible sur toutes les pages tant qu'une séance est en cours. */
export function PomodoroPill() {
  const p = usePomodoro();
  if (!p?.ready) return null;
  const s = p.state;
  const active = s.running || s.remaining < s.total;
  if (!active) return null;
  const focus = s.phase === "focus";
  return (
    <Link
      href="/school?tab=focus"
      className={cn(
        "focus-ring inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold tabular-nums transition-colors",
        focus ? "border-[color-mix(in_srgb,var(--danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--danger)_9%,transparent)] text-danger" : "border-[color-mix(in_srgb,var(--success)_30%,transparent)] bg-[color-mix(in_srgb,var(--success)_10%,transparent)] text-success",
      )}
      title={`${PHASE_LABEL[s.phase]}${focus && s.subject ? ` · ${s.subject}` : ""}${s.running ? "" : " (en pause)"}`}
    >
      {focus ? <Timer className="size-3.5" /> : <Coffee className="size-3.5" />}
      {clock(left(s, p.now))}
      {!s.running && <Pause className="size-3" />}
    </Link>
  );
}

/* ------------------------------------------------------------------ page Pomodoro */

type Overview = {
  subjects: string[];
  tests: { id: string; subject: string; title: string; dueDate: string }[];
  today: { date: string; minutes: number; sessions: number };
  week: { minutes: number; days: { date: string; minutes: number; sessions: number }[] };
  bySubject: { subject: string; minutes: number }[];
  streak: number;
  recent: { id: string; subject: string; minutes: number; completed: boolean; endedAt: string }[];
};

const PRESETS = [
  { label: "25 / 5", focus: 25, short: 5, long: 15 },
  { label: "50 / 10", focus: 50, short: 10, long: 20 },
  { label: "90 / 20", focus: 90, short: 20, long: 30 },
];
const PALETTE = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "#ff375f", "#5ac8fa", "#a2845e", "#64d2ff"];
const colorOf = (s: string) => PALETTE[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length];

export function PomodoroView() {
  const p = usePomodoro();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data } = useQuery({ queryKey: ["school", "focus"], queryFn: () => api.get<Overview>("/api/school/focus"), refetchInterval: 60_000 });
  const [other, setOther] = useState(false);
  const [custom, setCustom] = useState("");
  if (!p || !p.ready) return <Skeleton className="h-[520px]" />;
  const s = p.state;
  const ms = left(s, p.now);
  const pct = s.total ? 1 - ms / s.total : 0;
  const focus = s.phase === "focus";
  const color = focus ? "var(--danger)" : "var(--success)";
  const idle = !s.running && s.remaining === s.total;
  const subjects = [...new Set([...(s.subject ? [s.subject] : []), ...(data?.subjects ?? [])])];
  const R = 112;
  const C = 2 * Math.PI * R;
  const maxDay = Math.max(30, ...(data?.week.days.map((d) => d.minutes) ?? [0]));

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="flex min-w-0 flex-col gap-4">
        <Card className="flex flex-col items-center px-4 py-6 sm:px-6">
          <Segmented value={s.phase} onChange={(v) => p.setPhase(v)} options={(["focus", "short", "long"] as Phase[]).map((v) => ({ value: v, label: PHASE_LABEL[v], icon: v === "focus" ? <Timer /> : <Coffee /> }))} />

          <div className="relative mt-6 size-[260px] sm:size-[280px]">
            <svg viewBox="0 0 256 256" className="size-full -rotate-90" aria-hidden>
              <circle cx="128" cy="128" r={R} fill="none" stroke="var(--line)" strokeWidth="10" />
              <motion.circle cx="128" cy="128" r={R} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round" strokeDasharray={C} animate={{ strokeDashoffset: C * (1 - pct) }} transition={{ duration: 0.3, ease: "linear" }} />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="t-meta font-medium tracking-wide uppercase">{PHASE_LABEL[s.phase]}</span>
              <span className="t-num mt-1 text-[56px] leading-none font-semibold tracking-[-0.03em] tabular-nums" aria-live="off">
                {clock(ms)}
              </span>
              <span className="mt-2 max-w-[200px] truncate text-[13.5px] text-fg-2">{focus ? s.subject || "Choisis une matière" : "Lève-toi, bois de l'eau"}</span>
              {!s.running && !idle && <Badge className="mt-2">En pause</Badge>}
            </div>
          </div>

          <div className="mt-5 flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => p.adjust(-5)} disabled={ms <= 5 * 60_000} aria-label="Retirer 5 minutes" title="−5 min">
              <Minus className="size-4" />
            </Button>
            {s.running ? (
              <Button variant="secondary" className="h-11 min-w-[150px] justify-center text-[15px]" icon={<Pause className="size-4" />} onClick={p.pause}>
                Pause
              </Button>
            ) : (
              <Button
                variant="primary"
                className="h-11 min-w-[150px] justify-center text-[15px]"
                icon={<Play className="size-4" />}
                disabled={focus && !s.subject}
                onClick={p.start}
                title={focus && !s.subject ? "Choisis d'abord une matière" : undefined}
              >
                {idle ? (focus ? "Démarrer" : "Démarrer la pause") : "Reprendre"}
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={() => p.adjust(5)} aria-label="Ajouter 5 minutes" title="+5 min">
              <Plus className="size-4" />
            </Button>
          </div>
          <div className="mt-2 flex items-center gap-1">
            <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={p.reset} disabled={idle}>
              Réinitialiser
            </Button>
            <Button size="sm" variant="ghost" icon={<SkipForward className="size-3.5" />} onClick={p.skip}>
              {focus ? "Passer à la pause" : "Passer la pause"}
            </Button>
          </div>

          <div className="mt-4 flex items-center gap-1.5" aria-label={`Séance ${(s.cycle % s.settings.every) + 1} sur ${s.settings.every}`}>
            {Array.from({ length: s.settings.every }, (_, i) => (
              <span key={i} className={cn("size-2.5 rounded-full", i < s.cycle % s.settings.every || (s.cycle > 0 && s.cycle % s.settings.every === 0 && s.phase === "long") ? "bg-danger" : "bg-line")} />
            ))}
            <span className="t-meta ml-1.5">pause longue toutes les {s.settings.every} séances</span>
          </div>

          <div className="mt-6 w-full max-w-[560px]">
            <p className="mb-2 text-[12.5px] font-medium text-fg-2">Matière</p>
            <div className="flex flex-wrap gap-1.5">
              {subjects.map((name) => (
                <button
                  key={name}
                  onClick={() => (setOther(false), p.setSubject(name, s.subject === name ? s.homeworkId : null))}
                  className={cn("focus-ring inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] transition-colors", s.subject === name ? "border-transparent bg-primary text-primary-fg" : "border-line hover:bg-raised")}
                >
                  <span className="size-2 rounded-full" style={{ background: colorOf(name) }} />
                  {name}
                </button>
              ))}
              <button onClick={() => setOther(true)} className={cn("focus-ring inline-flex h-8 items-center rounded-full border border-dashed px-3 text-[13px] text-fg-2 hover:bg-raised", other ? "border-accent" : "border-line")}>
                Autre…
              </button>
            </div>
            {other && (
              <form
                className="mt-2 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (custom.trim()) {
                    p.setSubject(custom.trim().slice(0, 80));
                    setCustom("");
                    setOther(false);
                  }
                }}
              >
                <Input autoFocus value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Nom de la matière ou du travail" maxLength={80} />
                <Button type="submit" variant="primary" disabled={!custom.trim()}>
                  OK
                </Button>
              </form>
            )}
            {data && data.tests.length > 0 && (
              <Field label="Je révise pour" className="mt-3">
                <Select
                  value={s.homeworkId ?? ""}
                  onChange={(e) => {
                    const t = data.tests.find((x) => x.id === e.target.value);
                    p.setSubject(t ? t.subject : s.subject, t?.id ?? null);
                  }}
                >
                  <option value="">Rien de particulier</option>
                  {data.tests.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.subject} · {t.title || "Évaluation"} · {new Date(`${t.dueDate}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Réglages du minuteur" subtitle="Modifiables à tout moment ; s'appliquent à la prochaine phase si une séance est en cours." />
          <div className="flex flex-col gap-4 px-4 pb-4">
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((pr) => (
                <Button key={pr.label} size="sm" variant={s.settings.focus === pr.focus && s.settings.short === pr.short ? "primary" : "secondary"} onClick={() => p.setSettings({ focus: pr.focus, short: pr.short, long: pr.long })}>
                  {pr.label}
                </Button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <NumberField label="Travail (min)" value={s.settings.focus} min={1} max={180} onChange={(v) => p.setSettings({ focus: v })} />
              <NumberField label="Pause courte" value={s.settings.short} min={1} max={60} onChange={(v) => p.setSettings({ short: v })} />
              <NumberField label="Pause longue" value={s.settings.long} min={1} max={90} onChange={(v) => p.setSettings({ long: v })} />
              <NumberField label="Séances par cycle" value={s.settings.every} min={2} max={8} onChange={(v) => p.setSettings({ every: v })} />
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <Toggle label="Lancer la pause automatiquement" checked={s.settings.autoBreak} onChange={(v) => p.setSettings({ autoBreak: v })} />
              <Toggle label="Reprendre le travail après la pause" checked={s.settings.autoFocus} onChange={(v) => p.setSettings({ autoFocus: v })} />
              <Toggle label={s.settings.sound ? "Son activé" : "Son coupé"} icon={s.settings.sound ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />} checked={s.settings.sound} onChange={(v) => p.setSettings({ sound: v })} />
            </div>
          </div>
        </Card>
      </div>

      <aside className="flex min-w-0 flex-col gap-4">
        <Card>
          <CardHeader title="Mon temps de travail" icon={<Timer className="size-4" />} />
          {!data ? (
            <Skeleton className="mx-4 mb-4 h-32" />
          ) : (
            <div className="px-4 pb-4">
              <div className="grid grid-cols-3 gap-2">
                <Stat value={formatDuration(data.today.minutes)} label="aujourd'hui" />
                <Stat value={String(data.today.sessions)} label={data.today.sessions > 1 ? "pomodoros" : "pomodoro"} />
                <Stat value={String(data.streak)} label={data.streak > 1 ? "jours de suite" : "jour de suite"} icon={<Flame className={cn("size-3.5", data.streak > 0 && "text-[var(--tone-orange)]")} />} />
              </div>
              <div className="mt-4 flex h-24 items-end gap-1.5" role="img" aria-label="Minutes de travail des 7 derniers jours">
                {data.week.days.map((d) => (
                  <div key={d.date} className="flex flex-1 flex-col items-center gap-1" title={`${new Date(`${d.date}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric" })} : ${formatDuration(d.minutes)}`}>
                    <div className={cn("w-full rounded-[4px]", d.minutes ? "bg-[color-mix(in_srgb,var(--danger)_75%,transparent)]" : "bg-raised")} style={{ height: Math.max(4, Math.round((d.minutes / maxDay) * 76)) }} />
                    <span className={cn("t-meta text-[10.5px]", d.date === data.today.date && "font-semibold text-fg")}>{new Date(`${d.date}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "narrow" })}</span>
                  </div>
                ))}
              </div>
              <p className="t-meta mt-2">{formatDuration(data.week.minutes)} sur 7 jours</p>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Par matière" subtitle="7 derniers jours" />
          <div className="px-4 pb-4">
            {!data ? (
              <Skeleton className="h-20" />
            ) : data.bySubject.length === 0 ? (
              <p className="t-meta py-2">Lance une séance pour suivre ton temps par matière.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {data.bySubject.map((b) => (
                  <li key={b.subject}>
                    <div className="mb-1 flex items-baseline justify-between gap-2 text-[13px]">
                      <span className="truncate font-medium">{b.subject}</span>
                      <span className="t-num shrink-0 text-fg-2">{formatDuration(b.minutes)}</span>
                    </div>
                    <Progress value={(b.minutes / Math.max(1, data.bySubject[0].minutes)) * 100} color={colorOf(b.subject)} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Dernières séances" />
          {!data ? (
            <Skeleton className="mx-4 mb-4 h-20" />
          ) : data.recent.length === 0 ? (
            <EmptyState className="py-6" icon={<Timer className="size-5" />} title="Aucune séance" description="Tes séances de travail apparaîtront ici." />
          ) : (
            <ul className="divide-y divide-line-soft px-2 pb-2">
              {data.recent.map((r) => (
                <li key={r.id} className="group flex items-center gap-2 px-2 py-2 text-[13px]">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: colorOf(r.subject) }} />
                  <span className="min-w-0 flex-1 truncate">{r.subject}</span>
                  {!r.completed && <Badge>interrompue</Badge>}
                  <span className="t-num shrink-0 text-fg-2">{r.minutes} min</span>
                  <span className="t-meta shrink-0 text-right">{when(r.endedAt)}</span>
                  <button
                    onClick={async () => {
                      try {
                        await api.del(`/api/school/focus/${r.id}`);
                        qc.invalidateQueries({ queryKey: ["school", "focus"] });
                      } catch (e) {
                        toast({ kind: "error", title: "Séance non supprimée", description: (e as Error).message });
                      }
                    }}
                    className="focus-ring shrink-0 rounded text-fg-3 opacity-100 hover:text-danger md:opacity-0 md:group-hover:opacity-100"
                    aria-label="Supprimer la séance"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </aside>
    </div>
  );
}

/** Heure de fin d'une séance : « 18:42 » aujourd'hui, « lun. 18:42 » avant. */
const when = (iso: string) => (isoDate(new Date(iso)) === isoDate() ? formatTime(iso) : `${new Date(iso).toLocaleDateString("fr-FR", { weekday: "short" })} ${formatTime(iso)}`);

function Stat({ value, label, icon }: { value: string; label: string; icon?: ReactNode }) {
  return (
    <div className="rounded-[11px] border border-line-soft bg-bg px-2.5 py-2">
      <p className="t-num flex items-center gap-1 text-[17px] leading-tight font-semibold">
        {icon}
        {value}
      </p>
      <p className="t-meta mt-0.5 leading-tight">{label}</p>
    </div>
  );
}

function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(String(value));
  }
  const apply = () => {
    const n = Math.round(Number(draft));
    if (Number.isFinite(n) && n >= min && n <= max) onChange(n);
    else setDraft(String(value));
  };
  return (
    <Field label={label}>
      <Input type="number" inputMode="numeric" min={min} max={max} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={apply} onKeyDown={(e) => e.key === "Enter" && apply()} />
    </Field>
  );
}

function Toggle({ label, checked, onChange, icon }: { label: string; checked: boolean; onChange: (v: boolean) => void; icon?: ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-[11px] border border-line-soft bg-bg px-3 py-2 text-[13px]">
      <span className="flex items-center gap-1.5">
        {icon}
        {label}
      </span>
      <Switch checked={checked} onChange={onChange} label={label} />
    </label>
  );
}
