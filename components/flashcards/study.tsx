"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, Mic, PartyPopper, RotateCcw, Snail, X } from "lucide-react";
import { api } from "@/lib/client/api";
import { cn, plural } from "@/lib/utils";
import { listen, speak, sttSupported, ttsSupported } from "@/lib/client/speech";
import { checkAnswer, intervalLabel, schedule, type Grade } from "@/services/flashcards/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, ErrorState, Progress, Skeleton } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { Speak, langFlag, type FlashCard } from "./shared";

type StudyCard = FlashCard & { deckId: string; lang: string; deckTitle: string };
type StudyData = { date: string; cards: StudyCard[]; pool: { term: string; translation: string }[] };
type Mode = "cards" | "mcq" | "write" | "listen";
type Dir = "lf" | "fl" | "mix";

const TITLES: Record<Mode, string> = { cards: "Cartes", mcq: "QCM", write: "Écrire", listen: "Écoute" };
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

/** Séance de révision : une carte à la fois, les mots ratés reviennent en fin de séance. */
export function Study() {
  const sp = useSearchParams();
  const deck = sp.get("deck");
  const mode = ((sp.get("mode") as Mode) || "cards") as Mode;
  const all = sp.get("all") === "1";
  const dir = ((sp.get("dir") as Dir) || "lf") as Dir;
  const { data, error, refetch } = useQuery({
    queryKey: ["vocab", "study", deck, all],
    queryFn: () => api.get<StudyData>(`/api/flashcards/study?${new URLSearchParams({ ...(deck ? { deck } : {}), ...(all ? { all: "1" } : {}) })}`),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const back = deck ? `/vocabulaire/${deck}` : "/vocabulaire";

  return (
    <div className="mx-auto flex min-h-full max-w-[640px] flex-col px-1 pt-1 pb-10 md:px-3 md:pt-2">
      <div className="mb-3 flex items-center gap-2">
        <Link href={back} className="focus-ring inline-flex items-center gap-1.5 rounded-[7px] text-[13px] text-fg-2 hover:text-fg">
          <ArrowLeft className="size-3.5" />
          Terminer
        </Link>
        <span className="t-meta ml-auto">{TITLES[mode] ?? "Cartes"}</span>
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
        <Session data={data} mode={mode} dir={dir} back={back} />
      )}
    </div>
  );
}

type Item = { card: StudyCard; reverse: boolean; tries: number };
type Result = { id: string; ok: boolean };

function Session({ data, mode, dir, back }: { data: StudyData; mode: Mode; dir: Dir; back: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const initial = useMemo<Item[]>(() => {
    // Les cartes à revoir d'abord (mélangées), puis les nouvelles dans l'ordre du cours.
    const due = shuffle(data.cards.filter((c) => c.state !== "new"));
    const fresh = data.cards.filter((c) => c.state === "new");
    return [...due, ...fresh].map((card) => ({ card, reverse: dir === "fl" || (dir === "mix" && Math.random() < 0.5), tries: 0 }));
  }, [data, dir]);
  const [queue, setQueue] = useState<Item[]>(initial);
  const [pos, setPos] = useState(0);
  const [results, setResults] = useState<Result[]>([]);
  const total = initial.length;
  const cur = queue[pos];

  const grade = useCallback(
    (g: Grade) => {
      const item = queue[pos];
      if (!item) return;
      api.post(`/api/flashcards/cards/${item.card.id}/review`, { grade: g }).catch((e) => toast({ kind: "error", title: "Réponse non enregistrée", description: (e as Error).message }));
      if (item.tries === 0) setResults((r) => [...r, { id: item.card.id, ok: g > 1 }]);
      // Une carte ratée revient en fin de séance (deux fois au plus).
      setQueue((q) => (g === 1 && item.tries < 2 ? [...q, { ...item, tries: item.tries + 1, card: { ...item.card, state: "learning", reps: 0 } }] : q));
      setPos((p) => p + 1);
    },
    [queue, pos, toast],
  );

  useEffect(() => {
    if (pos >= queue.length) qc.invalidateQueries({ queryKey: ["vocab"] });
  }, [pos, queue.length, qc]);

  if (!cur) {
    const ok = results.filter((r) => r.ok).length;
    const missed = results.filter((r) => !r.ok).map((r) => r.id);
    return (
      <Card className="flex flex-col items-center px-6 py-10 text-center">
        <PartyPopper className="size-8 text-accent" />
        <p className="mt-3 text-[18px] font-semibold">Séance terminée</p>
        <p className="t-sub mt-1">
          {plural(results.length, "mot révisé", "mots révisés")} · {ok} su{ok > 1 ? "s" : ""} du premier coup
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
              Revoir les {missed.length} ratés
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
      ) : mode === "write" || mode === "listen" ? (
        <Write key={`${pos}-${cur.card.id}`} item={cur} listenMode={mode === "listen"} onGrade={grade} />
      ) : (
        <Flip key={`${pos}-${cur.card.id}`} item={cur} onGrade={grade} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ faces de carte */

function Face({ card, side }: { card: StudyCard; side: "lang" | "fr" }) {
  return side === "lang" ? (
    <div className="flex flex-col items-center gap-3">
      <p className="text-[26px] leading-tight font-semibold text-balance sm:text-[30px]" lang={card.lang}>
        {card.term}
      </p>
      <div className="flex gap-2">
        <Speak text={card.term} lang={card.lang} />
        <Speak text={card.term} lang={card.lang} slow />
      </div>
    </div>
  ) : (
    <p className="text-[24px] leading-tight font-semibold text-balance sm:text-[28px]">{card.translation}</p>
  );
}

function Details({ card }: { card: StudyCard }) {
  if (!card.example && !card.note) return null;
  return (
    <div className="mt-4 w-full border-t border-line-soft pt-3 text-left">
      {card.example && (
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-[14px] italic" lang={card.lang}>
              {card.example}
            </p>
            {card.exampleFr && <p className="t-meta mt-0.5">{card.exampleFr}</p>}
          </div>
          <Speak text={card.example} lang={card.lang} size="sm" />
        </div>
      )}
      {card.note && <p className="mt-2 rounded-[8px] bg-raised px-2.5 py-1.5 text-[12.5px] text-fg-2">💡 {card.note}</p>}
    </div>
  );
}

/** Cartes à retourner : « je savais » ou pas, avec le délai avant le prochain passage. */
function Flip({ item, onGrade }: { item: Item; onGrade: (g: Grade) => void }) {
  const [shown, setShown] = useState(false);
  const c = item.card;
  const front = item.reverse ? "fr" : "lang";
  useEffect(() => {
    if (!item.reverse) speakSoon(c.term, c.lang);
  }, [c.term, c.lang, item.reverse]);
  useEffect(() => {
    if (shown && item.reverse) speakSoon(c.term, c.lang);
  }, [shown, item.reverse, c.term, c.lang]);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
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
      <Card
        role="button"
        tabIndex={0}
        onClick={() => setShown(true)}
        className={cn("flex min-h-[320px] cursor-pointer flex-col items-center justify-center px-5 py-8 text-center select-none", shown && "cursor-default")}
      >
        <p className="t-meta mb-4">
          {langFlag(c.lang)} {c.state === "new" ? "Nouveau mot" : item.tries ? "À revoir" : c.deckTitle}
        </p>
        <Face card={c} side={front} />
        {shown ? (
          <>
            <div className="my-5 h-px w-16 bg-line" />
            <Face card={c} side={front === "lang" ? "fr" : "lang"} />
            <Details card={c} />
          </>
        ) : (
          <p className="t-meta mt-8">Touche la carte pour la retourner</p>
        )}
      </Card>
      {shown ? (
        <div className="grid grid-cols-4 gap-2">
          {GRADES.map((g) => (
            <button
              key={g.g}
              onClick={() => onGrade(g.g)}
              className="focus-ring surface flex h-[62px] flex-col items-center justify-center rounded-[14px] transition-transform active:scale-95"
            >
              <span className={cn("text-[14px] font-semibold", g.cls)}>{g.label}</span>
              <span className="t-meta">{intervalLabel(g.g === 1 ? 0 : schedule(c, g.g).interval)}</span>
            </button>
          ))}
        </div>
      ) : (
        <Button variant="primary" className="h-12 w-full justify-center text-[15px]" onClick={() => setShown(true)}>
          Voir la réponse
        </Button>
      )}
    </>
  );
}

function speakSoon(text: string, lang: string) {
  if (!ttsSupported()) return;
  const t = setTimeout(() => speak(text, lang), 250);
  return () => clearTimeout(t);
}

/** QCM : la bonne traduction parmi quatre, propositions tirées du même paquet. */
function Mcq({ item, pool, onGrade }: { item: Item; pool: StudyData["pool"]; onGrade: (g: Grade) => void }) {
  const c = item.card;
  const reverse = item.reverse;
  const right = reverse ? c.term : c.translation;
  const options = useMemo(() => {
    const others = shuffle(pool.map((p) => (reverse ? p.term : p.translation)).filter((t) => t.toLowerCase() !== right.toLowerCase()));
    return shuffle([right, ...[...new Set(others)].slice(0, 3)]);
  }, [pool, right, reverse]);
  const [picked, setPicked] = useState<string | null>(null);
  const ok = picked === right;
  useEffect(() => {
    if (!reverse) speakSoon(c.term, c.lang);
  }, [c.term, c.lang, reverse]);
  useEffect(() => {
    if (!picked) return;
    if (reverse || !ok) speakSoon(c.term, c.lang);
    if (ok) {
      const t = setTimeout(() => onGrade(3), 900);
      return () => clearTimeout(t);
    }
  }, [picked, ok, onGrade, reverse, c.term, c.lang]);
  return (
    <>
      <Card className="flex min-h-[200px] flex-col items-center justify-center px-5 py-8 text-center">
        <p className="t-meta mb-3">{reverse ? `Comment dit-on…` : "Que signifie…"}</p>
        <Face card={c} side={reverse ? "fr" : "lang"} />
      </Card>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {options.map((o) => {
          const isRight = picked && o === right;
          const isWrong = picked === o && !ok;
          return (
            <button
              key={o}
              disabled={!!picked}
              onClick={() => setPicked(o)}
              lang={reverse ? c.lang : undefined}
              className={cn(
                "focus-ring surface min-h-[54px] rounded-[14px] px-4 py-3 text-left text-[15px] transition-all active:scale-[0.98]",
                isRight && "border-success bg-[color-mix(in_srgb,var(--success)_12%,transparent)]",
                isWrong && "border-danger bg-[color-mix(in_srgb,var(--danger)_10%,transparent)]",
                picked && !isRight && !isWrong && "opacity-50",
              )}
            >
              {o}
            </button>
          );
        })}
      </div>
      {picked && !ok && (
        <Card className="p-4">
          <p className="text-[14px]">
            <span className="font-semibold" lang={c.lang}>
              {c.term}
            </span>{" "}
            = {c.translation}
          </p>
          <Details card={c} />
          <Button variant="primary" className="mt-3 w-full justify-center" icon={<ArrowRight className="size-4" />} onClick={() => onGrade(1)}>
            Suivant
          </Button>
        </Card>
      )}
    </>
  );
}

/** Écrire le mot dans la langue (français → langue), ou écrire ce qu'on entend (dictée). */
function Write({ item, listenMode, onGrade }: { item: Item; listenMode: boolean; onGrade: (g: Grade) => void }) {
  const c = item.card;
  const [value, setValue] = useState("");
  const [result, setResult] = useState<ReturnType<typeof checkAnswer> | null>(null);
  const [override, setOverride] = useState(false);
  const [mic, setMic] = useState<"idle" | "on">("idle");
  const [canMic, setCanMic] = useState(false);
  const [canTts, setCanTts] = useState(true);
  const input = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  useEffect(() => {
    setCanMic(sttSupported());
    setCanTts(ttsSupported());
  }, []);
  useEffect(() => {
    if (listenMode) speakSoon(c.term, c.lang);
    input.current?.focus();
  }, [listenMode, c.term, c.lang]);

  const ok = result === "exact" || result === "accents" || result === "typo" || override;
  const gradeOf = useCallback((): Grade => (override ? 3 : result === "exact" ? 3 : result === "wrong" ? 1 : 2), [override, result]);
  // Réponse affichée : Entrée passe au mot suivant.
  useEffect(() => {
    if (!result) return;
    const on = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
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
    const r = checkAnswer(value, c.term);
    setResult(r);
    if (!listenMode) speakSoon(c.term, c.lang);
  };
  const dictate = async () => {
    setMic("on");
    try {
      const said = await listen(c.lang).result;
      if (said.length) {
        // La transcription la plus proche du mot attendu.
        const best = said.find((s) => checkAnswer(s, c.term) !== "wrong") ?? said[0];
        setValue(best);
      }
    } catch (e) {
      toast({ kind: "error", title: "Dictée impossible", description: (e as Error).message });
    } finally {
      setMic("idle");
    }
  };

  return (
    <>
      <Card className="flex min-h-[220px] flex-col items-center justify-center px-5 py-8 text-center">
        {listenMode ? (
          <>
            <p className="t-meta mb-4">Écoute et écris le mot</p>
            {canTts ? (
              <div className="flex gap-3">
                <Speak text={c.term} lang={c.lang} size="lg" />
                <button onClick={() => speak(c.term, c.lang, { rate: 0.55 })} className="focus-ring grid size-12 place-items-center rounded-full border border-line bg-bg/60 text-fg-2 hover:bg-raised active:scale-90" aria-label="Écouter lentement" title="Lentement">
                  <Snail className="size-5" />
                </button>
              </div>
            ) : (
              <p className="t-sub">La lecture à voix haute n'est pas disponible sur ce navigateur.</p>
            )}
            {result && <p className="mt-4 text-[14px] text-fg-2">{c.translation}</p>}
          </>
        ) : (
          <>
            <p className="t-meta mb-3">Écris en {langFlag(c.lang)}</p>
            <Face card={c} side="fr" />
          </>
        )}
      </Card>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim() || result) submit();
        }}
      >
        <Input
          ref={input}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={!!result}
          placeholder={listenMode ? "Ce que tu entends" : "Ta réponse"}
          lang={c.lang}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className={cn("h-12 flex-1 text-[16px]", result && (ok ? "border-success" : "border-danger"))}
          aria-label="Ta réponse"
        />
        {canMic && !result && !listenMode && (
          <Button size="icon" variant={mic === "on" ? "primary" : "secondary"} className="size-12" onClick={dictate} aria-label="Dire le mot" title="Dire le mot (prononciation)">
            <Mic className={cn("size-4", mic === "on" && "animate-pulse")} />
          </Button>
        )}
        <Button type="submit" variant="primary" className="h-12 px-5" disabled={!value.trim() && !result}>
          {result ? <ArrowRight className="size-4" /> : "Valider"}
        </Button>
      </form>
      {!result && (
        <button type="button" className="t-meta self-center underline decoration-dotted" onClick={() => setResult("wrong")}>
          Je ne sais pas
        </button>
      )}
      {result && (
        <Card className="p-4">
          <div className="flex items-start gap-3">
            <span className={cn("grid size-8 shrink-0 place-items-center rounded-full", ok ? "bg-[color-mix(in_srgb,var(--success)_15%,transparent)] text-success" : "bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] text-danger")}>
              {ok ? <Check className="size-4" /> : <X className="size-4" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold">
                {override ? "Compté comme juste" : result === "exact" ? "Parfait !" : result === "accents" ? "Juste, attention aux accents" : result === "typo" ? "Presque : une petite faute" : value.trim() ? "Ce n'est pas ça" : "La réponse"}
              </p>
              <div className="mt-1 flex items-center gap-2">
                <p className="text-[18px] font-semibold" lang={c.lang}>
                  {c.term}
                </p>
                <Speak text={c.term} lang={c.lang} size="sm" />
              </div>
              {!listenMode ? null : <p className="t-meta">{c.translation}</p>}
              <Details card={c} />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {!ok && value.trim() && (
              <Button size="sm" variant="ghost" onClick={() => setOverride(true)}>
                J'avais juste
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
