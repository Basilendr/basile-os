"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, PartyPopper, RotateCcw, X } from "lucide-react";
import { api } from "@/lib/client/api";
import { cn, plural } from "@/lib/utils";
import { intervalLabel, schedule, type Grade } from "@/services/flashcards/core";
import { checkDefinition, type DefCheck } from "@/services/definitions/core";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Card, ErrorState, Progress, Skeleton } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { KeyChips, Marked, type DefCard } from "./shared";

type StudyCard = DefCard & { deckId: string; deckTitle: string };
type StudyData = { date: string; cards: StudyCard[]; pool: { term: string; definition: string }[] };
type Mode = "cards" | "mcq" | "write";

const TITLES: Record<Mode, string> = { cards: "Cartes", mcq: "QCM", write: "Écrire" };
const GRADES: { g: Grade; label: string; cls: string }[] = [
  { g: 1, label: "Raté", cls: "text-danger" },
  { g: 2, label: "Difficile", cls: "text-warning" },
  { g: 3, label: "Bien", cls: "text-success" },
  { g: 4, label: "Facile", cls: "text-accent" },
];

function shuffle<T>(a: T[]) {
  const out = [...a];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Séance de révision des définitions : une à la fois, les ratées reviennent en fin de séance. */
export function DefStudy() {
  const sp = useSearchParams();
  const deck = sp.get("deck");
  const raw = sp.get("mode");
  const mode: Mode = raw === "mcq" || raw === "write" ? raw : "cards";
  const all = sp.get("all") === "1";
  const { data, error, refetch } = useQuery({
    queryKey: ["defs", "study", deck, all],
    queryFn: () => api.get<StudyData>(`/api/definitions/study?${new URLSearchParams({ ...(deck ? { deck } : {}), ...(all ? { all: "1" } : {}) })}`),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const back = deck ? `/definitions/${deck}` : "/definitions";

  return (
    <div className="mx-auto flex min-h-full max-w-[680px] flex-col px-1 pt-1 pb-10 md:px-3 md:pt-2">
      <div className="mb-3 flex items-center gap-2">
        <Link href={back} className="focus-ring inline-flex items-center gap-1.5 rounded-[7px] text-[13px] text-fg-2 hover:text-fg">
          <ArrowLeft className="size-3.5" />
          Terminer
        </Link>
        <span className="t-meta ml-auto">{TITLES[mode]}</span>
      </div>
      {error ? (
        <Card>
          <ErrorState error={error} onRetry={() => refetch()} />
        </Card>
      ) : !data ? (
        <Skeleton className="h-[360px]" />
      ) : data.cards.length === 0 ? (
        <Card className="flex flex-col items-center px-6 py-12 text-center">
          <PartyPopper className="size-7 text-accent" />
          <p className="mt-3 text-[16px] font-semibold">Rien à revoir pour l'instant</p>
          <p className="t-sub mt-1">Reviens demain, ou entraîne-toi sur tout le paquet.</p>
          <Link href={back} className="mt-4">
            <Button variant="primary">Retour</Button>
          </Link>
        </Card>
      ) : (
        <Session data={data} mode={mode} back={back} />
      )}
    </div>
  );
}

type Item = { card: StudyCard; reverse: boolean; tries: number };
type Result = { id: string; ok: boolean };

function Session({ data, mode, back }: { data: StudyData; mode: Mode; back: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const initial = useMemo<Item[]>(() => {
    const due = shuffle(data.cards.filter((c) => c.state !== "new"));
    const fresh = data.cards.filter((c) => c.state === "new");
    // En QCM, une fois sur trois : retrouver la notion à partir de la définition.
    return [...due, ...fresh].map((card) => ({ card, reverse: mode === "mcq" && data.pool.length >= 3 && Math.random() < 0.33, tries: 0 }));
  }, [data, mode]);
  const [queue, setQueue] = useState<Item[]>(initial);
  const [pos, setPos] = useState(0);
  const [results, setResults] = useState<Result[]>([]);
  const total = initial.length;
  const cur = queue[pos];

  const grade = useCallback(
    (g: Grade) => {
      const item = queue[pos];
      if (!item) return;
      api.post(`/api/definitions/cards/${item.card.id}/review`, { grade: g }).catch((e) => toast({ kind: "error", title: "Réponse non enregistrée", description: (e as Error).message }));
      if (item.tries === 0) setResults((r) => [...r, { id: item.card.id, ok: g > 1 }]);
      setQueue((q) => (g === 1 && item.tries < 2 ? [...q, { ...item, tries: item.tries + 1, card: { ...item.card, state: "learning", reps: 0 } }] : q));
      setPos((p) => p + 1);
    },
    [queue, pos, toast],
  );

  useEffect(() => {
    if (pos >= queue.length) qc.invalidateQueries({ queryKey: ["defs"] });
  }, [pos, queue.length, qc]);

  if (!cur) {
    const ok = results.filter((r) => r.ok).length;
    const missed = results.filter((r) => !r.ok).map((r) => r.id);
    return (
      <Card className="flex flex-col items-center px-6 py-10 text-center">
        <PartyPopper className="size-8 text-accent" />
        <p className="mt-3 text-[18px] font-semibold">Séance terminée</p>
        <p className="t-sub mt-1">
          {plural(results.length, "définition révisée", "définitions révisées")} · {ok} sue{ok > 1 ? "s" : ""} du premier coup
        </p>
        <Progress className="mt-4 max-w-[280px]" value={results.length ? (ok / results.length) * 100 : 0} color="var(--success)" />
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {missed.length > 0 && (
            <Button
              icon={<RotateCcw className="size-3.5" />}
              onClick={() => {
                setQueue(initial.filter((i) => missed.includes(i.card.id)).map((i) => ({ ...i, tries: 1 })));
                setPos(0);
                setResults([]);
              }}
            >
              Revoir les {missed.length} ratées
            </Button>
          )}
          <Link href={back}>
            <Button variant="primary">Terminer</Button>
          </Link>
        </div>
      </Card>
    );
  }

  const done = Math.min(pos, total);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Progress value={(done / Math.max(1, total)) * 100} />
        <span className="t-num t-meta shrink-0">
          {done}/{total}
        </span>
      </div>
      {mode === "mcq" ? (
        <Mcq key={`${pos}-${cur.card.id}`} item={cur} pool={data.pool} onGrade={grade} />
      ) : mode === "write" ? (
        <Write key={`${pos}-${cur.card.id}`} item={cur} onGrade={grade} />
      ) : (
        <Flip key={`${pos}-${cur.card.id}`} item={cur} onGrade={grade} />
      )}
    </div>
  );
}

function label(item: Item) {
  return item.card.state === "new" ? "Nouvelle définition" : item.tries ? "À revoir" : item.card.deckTitle;
}

/* ------------------------------------------------------------------ cartes qui se retournent */

function Flip({ item, onGrade }: { item: Item; onGrade: (g: Grade) => void }) {
  const [shown, setShown] = useState(false);
  const c = item.card;
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        if (!shown) setShown(true);
        else onGrade(3);
      } else if (shown && ["1", "2", "3", "4"].includes(e.key)) onGrade(Number(e.key) as Grade);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [shown, onGrade]);
  return (
    <>
      <div className="[perspective:1400px]">
        <div
          role="button"
          tabIndex={0}
          aria-label={shown ? "Définition" : "Retourner la carte"}
          onClick={() => setShown(true)}
          className={cn("relative grid min-h-[340px] cursor-pointer transition-transform duration-500 [transform-style:preserve-3d] motion-reduce:transition-none", shown && "cursor-default [transform:rotateY(180deg)]")}
        >
          {/* Recto : la notion. */}
          <Card className="col-start-1 row-start-1 flex flex-col items-center justify-center px-5 py-8 text-center [backface-visibility:hidden]">
            <p className="t-meta mb-4">{label(item)}</p>
            <p className="text-[26px] leading-tight font-semibold text-balance sm:text-[30px]">{c.term}</p>
            <p className="t-meta mt-8">Récite la définition, puis touche la carte pour la retourner</p>
          </Card>
          {/* Verso : la définition, mots importants surlignés. */}
          <Card className="col-start-1 row-start-1 flex flex-col items-center justify-center px-5 py-8 text-center [backface-visibility:hidden] [transform:rotateY(180deg)]">
            <p className="t-meta mb-2">{c.term}</p>
            <p className="text-[18px] leading-relaxed text-balance sm:text-[20px]">
              <Marked definition={c.definition} keywords={c.keywords} />
            </p>
            {c.keywords.length > 0 && (
              <div className="mt-5 flex flex-col items-center gap-1.5">
                <span className="t-meta">Mots à retrouver</span>
                <KeyChips keywords={c.keywords} className="justify-center" />
              </div>
            )}
          </Card>
        </div>
      </div>
      {shown ? (
        <div className="grid grid-cols-4 gap-2">
          {GRADES.map((g) => (
            <button key={g.g} onClick={() => onGrade(g.g)} className="focus-ring surface flex h-[62px] flex-col items-center justify-center rounded-[14px] transition-transform active:scale-95">
              <span className={cn("text-[14px] font-semibold", g.cls)}>{g.label}</span>
              <span className="t-meta">{intervalLabel(g.g === 1 ? 0 : schedule(c, g.g).interval)}</span>
            </button>
          ))}
        </div>
      ) : (
        <Button variant="primary" className="h-12 w-full justify-center text-[15px]" onClick={() => setShown(true)}>
          Retourner la carte
        </Button>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ QCM */

/** Version courte d'une définition pour les propositions du QCM. */
const short = (s: string) => (s.length > 220 ? `${s.slice(0, 210).replace(/\s+\S*$/, "")}…` : s);

function Mcq({ item, pool, onGrade }: { item: Item; pool: StudyData["pool"]; onGrade: (g: Grade) => void }) {
  const c = item.card;
  const reverse = item.reverse;
  const right = reverse ? c.term : c.definition;
  const options = useMemo(() => {
    const others = shuffle(pool.map((p) => (reverse ? p.term : p.definition)).filter((t) => t.trim().toLowerCase() !== right.trim().toLowerCase()));
    return shuffle([right, ...[...new Set(others)].slice(0, 3)]);
  }, [pool, right, reverse]);
  const [picked, setPicked] = useState<string | null>(null);
  const ok = picked === right;
  useEffect(() => {
    if (!picked || !ok) return;
    const t = setTimeout(() => onGrade(3), 1100);
    return () => clearTimeout(t);
  }, [picked, ok, onGrade]);
  return (
    <>
      <Card className="flex min-h-[170px] flex-col items-center justify-center px-5 py-7 text-center">
        <p className="t-meta mb-3">{reverse ? "Quelle notion correspond à cette définition ?" : "Quelle est la bonne définition ?"}</p>
        {reverse ? <p className="text-[17px] leading-relaxed text-balance">{c.definition}</p> : <p className="text-[24px] leading-tight font-semibold text-balance sm:text-[28px]">{c.term}</p>}
      </Card>
      {options.length < 2 && <p className="t-meta text-center">Ajoute au moins deux définitions au paquet pour un vrai QCM.</p>}
      <div className="flex flex-col gap-2">
        {options.map((o) => {
          const isRight = picked && o === right;
          const isWrong = picked === o && !ok;
          return (
            <button
              key={o}
              disabled={!!picked}
              onClick={() => setPicked(o)}
              className={cn(
                "focus-ring surface min-h-[54px] rounded-[14px] px-4 py-3 text-left text-[14.5px] leading-snug transition-all active:scale-[0.99]",
                reverse && "font-medium",
                isRight && "border-success bg-[color-mix(in_srgb,var(--success)_12%,transparent)]",
                isWrong && "border-danger bg-[color-mix(in_srgb,var(--danger)_10%,transparent)]",
                picked && !isRight && !isWrong && "opacity-50",
              )}
            >
              {reverse ? o : short(o)}
            </button>
          );
        })}
      </div>
      {picked && !ok && (
        <Card className="p-4">
          <p className="text-[14px] font-semibold">{c.term}</p>
          <p className="mt-1 text-[14px] leading-relaxed">
            <Marked definition={c.definition} keywords={c.keywords} />
          </p>
          <Button variant="primary" className="mt-3 w-full justify-center" icon={<ArrowRight className="size-4" />} onClick={() => onGrade(1)}>
            Suivant
          </Button>
        </Card>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ écrire la définition */

function Write({ item, onGrade }: { item: Item; onGrade: (g: Grade) => void }) {
  const c = item.card;
  const [value, setValue] = useState("");
  const [result, setResult] = useState<DefCheck | null>(null);
  const [override, setOverride] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    input.current?.focus();
  }, []);
  const gradeOf = useCallback((): Grade => (override ? 3 : (result?.grade ?? 1)), [override, result]);
  useEffect(() => {
    if (!result) return;
    const on = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        onGrade(gradeOf());
      }
    };
    const t = setTimeout(() => window.addEventListener("keydown", on), 50);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", on);
    };
  }, [result, onGrade, gradeOf]);
  const submit = () => {
    if (result) return onGrade(gradeOf());
    setResult(checkDefinition(value, c.keywords, c.definition));
  };
  const ok = override || (result ? result.grade >= 3 : false);
  const pct = result ? Math.round(result.score * 100) : 0;

  return (
    <>
      <Card className="flex min-h-[150px] flex-col items-center justify-center px-5 py-7 text-center">
        <p className="t-meta mb-3">{label(item)} · écris la définition</p>
        <p className="text-[24px] leading-tight font-semibold text-balance sm:text-[28px]">{c.term}</p>
        {!result && c.keywords.length > 0 && <p className="t-meta mt-3">{plural(c.keywords.length, "mot important à placer", "mots importants à placer")}</p>}
      </Card>
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim() || result) submit();
        }}
      >
        <Textarea
          ref={input}
          rows={3}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !result) {
              e.preventDefault();
              if (value.trim()) submit();
            }
          }}
          disabled={!!result}
          placeholder="Ta définition, avec tes mots"
          className={cn("min-h-[96px] text-[16px]", result && (ok ? "border-success" : "border-danger"))}
          aria-label="Ta définition"
        />
        {!result && (
          <div className="flex items-center gap-3">
            <button type="button" className="t-meta underline decoration-dotted" onClick={() => setResult(checkDefinition("", c.keywords, c.definition))}>
              Je ne sais pas
            </button>
            <Button type="submit" variant="primary" className="ml-auto h-11 px-5" disabled={!value.trim()}>
              Valider
            </Button>
          </div>
        )}
      </form>
      {result && (
        <Card className="p-4">
          <div className="flex items-start gap-3">
            <span className={cn("grid size-8 shrink-0 place-items-center rounded-full", ok ? "bg-[color-mix(in_srgb,var(--success)_15%,transparent)] text-success" : "bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] text-danger")}>
              {ok ? <Check className="size-4" /> : <X className="size-4" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold">
                {override
                  ? "Compté comme juste"
                  : !value.trim()
                    ? "La définition"
                    : result.grade === 3
                      ? result.missing.length
                        ? "Bien ! Il manque peu de chose"
                        : "Parfait : tous les mots importants y sont"
                      : result.grade === 2
                        ? "Presque : des mots importants manquent"
                        : "Pas encore : il manque l'essentiel"}
              </p>
              {value.trim() && (
                <p className="t-meta mt-0.5">
                  {result.found.length}/{result.found.length + result.missing.length} mots importants · {pct} %
                </p>
              )}
              <p className="mt-2 text-[14.5px] leading-relaxed">
                <Marked definition={c.definition} keywords={c.keywords} found={result.found} missing={result.missing} />
              </p>
              {c.keywords.length > 0 && value.trim() && <KeyChips keywords={c.keywords} found={result.found} className="mt-2" />}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {!ok && value.trim() && (
              <Button size="sm" variant="ghost" onClick={() => setOverride(true)}>
                J'avais juste (synonymes)
              </Button>
            )}
            <Button variant="primary" className="ml-auto" icon={<ArrowRight className="size-4" />} onClick={() => onGrade(gradeOf())}>
              Suivant
            </Button>
          </div>
        </Card>
      )}
    </>
  );
}
