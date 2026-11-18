"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  BookOpenText,
  CheckCircle2,
  Ear,
  Headphones,
  Layers,
  ListChecks,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { api } from "@/lib/client/api";
import { cn, plural } from "@/lib/utils";
import { speakAll } from "@/lib/client/speech";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Menu } from "@/components/ui/menu";
import { Segmented } from "@/components/ui/tabs";
import { Badge, Card, ErrorState, Progress, Skeleton } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import type { FlashGuide } from "@/database/schema";
import { LANG_OPTIONS, Speak, Toggle, cardState, langFlag, langLabel, useRun, type FlashCard } from "./shared";

type Deck = {
  id: string;
  title: string;
  subject: string | null;
  lang: string;
  source: string;
  sources: { id: string; name: string }[];
  focus: string | null;
  status: string;
  error: string | null;
  hasText: boolean;
  guide: FlashGuide | null;
  guideStatus: string;
  date: string;
  cards: FlashCard[];
};
type Tab = "learn" | "words" | "guide";

const STEPS = ["Lecture de ton cours…", "Repérage du vocabulaire à apprendre…", "Création des cartes…", "Préparation de la fiche du cours…"];

export function DeckView({ id }: { id: string }) {
  const sp = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { busy, run } = useRun();
  const [tab, setTab] = useState<Tab>((sp.get("tab") as Tab) || "learn");
  const [renaming, setRenaming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const { data: d, error, refetch } = useQuery({
    queryKey: ["vocab", "deck", id],
    queryFn: () => api.get<Deck>(`/api/flashcards/${id}`),
    refetchInterval: (q) => (q.state.data?.status === "generating" || q.state.data?.guideStatus === "generating" ? 2500 : false),
  });
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["vocab"] })]);

  const setLang = (lang: string) =>
    run("lang", async () => {
      await api.patch(`/api/flashcards/${id}`, { lang });
      await refresh();
    });

  return (
    <div className="mx-auto max-w-[900px] px-1 pt-1 pb-12 md:px-3 md:pt-2">
      <Link href="/vocabulaire" className="focus-ring mb-4 inline-flex items-center gap-1.5 rounded-[7px] text-[13px] text-fg-2 hover:text-fg">
        <ArrowLeft className="size-3.5" />
        Vocabulaire
      </Link>
      {error ? (
        <Card>
          <ErrorState error={error} onRetry={() => refetch()} />
        </Card>
      ) : !d ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-64" />
        </div>
      ) : (
        <>
          <header className="mb-4 flex items-start gap-3">
            <span className="grid size-12 shrink-0 place-items-center rounded-[14px] bg-raised text-[24px]" aria-hidden>
              {langFlag(d.lang)}
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="text-[20px] leading-tight font-semibold text-balance">{d.title || (d.status === "generating" ? "Lecture du cours…" : "Sans titre")}</h1>
              <p className="t-meta mt-1 truncate">
                {langLabel(d.lang)} · {plural(d.cards.length, "mot", "mots")}
                {d.sources.length ? ` · ${d.sources.map((s) => s.name).join(", ")}` : ""}
              </p>
            </div>
            <Menu
              trigger={({ toggle }) => (
                <Button size="icon" variant="ghost" onClick={toggle} aria-label="Plus d'actions">
                  <MoreHorizontal className="size-4" />
                </Button>
              )}
              items={[
                { label: "Renommer", icon: <Pencil />, onSelect: () => setRenaming(true) },
                { type: "label", label: "Langue" },
                ...LANG_OPTIONS.slice(0, 6).map((l) => ({ label: l.label, icon: l.value === d.lang ? <CheckCircle2 /> : <span />, onSelect: () => setLang(l.value) })),
                { type: "separator" },
                { label: "Tout réapprendre (remettre à zéro)", icon: <RotateCcw />, onSelect: () => setResetting(true) },
                { label: "Supprimer le paquet", icon: <Trash2 />, danger: true, onSelect: () => setRemoving(true) },
              ]}
            />
          </header>

          {d.status === "generating" ? (
            <Generating />
          ) : d.status === "error" ? (
            <Card className="flex flex-col items-center px-6 py-10 text-center">
              <p className="text-[15px] font-semibold">Les cartes n'ont pas pu être créées</p>
              <p className="t-sub mt-1 max-w-[460px]">{d.error}</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Button
                  variant="primary"
                  icon={<RefreshCw className="size-3.5" />}
                  loading={busy === "retry"}
                  onClick={() =>
                    run("retry", async () => {
                      await api.post(`/api/flashcards/${id}/retry`);
                      await refetch();
                    })
                  }
                >
                  Réessayer
                </Button>
                <Button onClick={() => setTab("words")} icon={<Plus className="size-3.5" />}>
                  Saisir les mots à la main
                </Button>
              </div>
            </Card>
          ) : null}

          {d.status !== "generating" && (
            <>
              <div className="-mx-1 mb-4 overflow-x-auto px-1">
                <Segmented
                  value={tab}
                  onChange={(t) => {
                    setTab(t);
                    router.replace(`/vocabulaire/${id}${t === "learn" ? "" : `?tab=${t}`}`, { scroll: false });
                  }}
                  options={[
                    { value: "learn", label: "Apprendre", icon: <Layers className="size-3.5" /> },
                    { value: "words", label: "Mots", count: d.cards.length, icon: <ListChecks className="size-3.5" /> },
                    { value: "guide", label: "Fiche du cours", icon: <BookOpenText className="size-3.5" /> },
                  ]}
                />
              </div>
              {tab === "learn" && <Learn d={d} onQuiz={() => run("quiz", async () => router.push(`/quiz/${(await api.post<{ id: string }>(`/api/flashcards/${id}/quiz`)).id}`), "Quiz non créé")} quizBusy={busy === "quiz"} />}
              {tab === "words" && <Words d={d} onChange={() => Promise.all([refetch(), refresh()])} />}
              {tab === "guide" && <Guide d={d} onBuild={() => run("guide", async () => { await api.post(`/api/flashcards/${id}/guide`); await refetch(); }, "Fiche non créée")} building={busy === "guide"} />}
            </>
          )}

          <RenameDialog
            open={renaming}
            initial={d.title}
            onClose={() => setRenaming(false)}
            onSave={(title) =>
              run("rename", async () => {
                await api.patch(`/api/flashcards/${id}`, { title });
                await Promise.all([refetch(), refresh()]);
                setRenaming(false);
              })
            }
          />
          <ConfirmDialog
            open={resetting}
            onClose={() => setResetting(false)}
            title="Tout réapprendre ?"
            description="Toutes les cartes de ce paquet redeviennent nouvelles : ta progression sur ces mots est effacée."
            confirmLabel="Remettre à zéro"
            loading={busy === "reset"}
            onConfirm={() =>
              run("reset", async () => {
                await api.post(`/api/flashcards/${id}/reset`);
                await Promise.all([refetch(), refresh()]);
                setResetting(false);
                toast({ kind: "success", title: "Paquet remis à zéro" });
              })
            }
          />
          <ConfirmDialog
            open={removing}
            onClose={() => setRemoving(false)}
            title="Supprimer ce paquet ?"
            description={`« ${d.title || "Sans titre"} » et ses ${d.cards.length} cartes seront supprimés.`}
            confirmLabel="Supprimer"
            danger
            loading={busy === "remove"}
            onConfirm={() =>
              run("remove", async () => {
                await api.del(`/api/flashcards/${id}`);
                await refresh();
                router.push("/vocabulaire");
              })
            }
          />
        </>
      )}
    </div>
  );
}

function Generating() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => Math.min(STEPS.length - 1, s + 1)), 6000);
    return () => clearInterval(t);
  }, []);
  return (
    <Card className="flex flex-col items-center px-6 py-12 text-center">
      <Loader2 className="size-6 animate-spin text-accent" />
      <p className="mt-3 text-[15px] font-semibold">{STEPS[step]}</p>
      <p className="t-sub mt-1">Ça prend en général moins d'une minute. Tu peux quitter cette page.</p>
    </Card>
  );
}

/* ------------------------------------------------------------------ apprendre */

const MODES = [
  { mode: "cards", icon: Layers, title: "Cartes", text: "Retourne la carte, dis si tu savais. Le plus rapide pour mémoriser." },
  { mode: "mcq", icon: ListChecks, title: "QCM", text: "Retrouve la bonne traduction parmi quatre. Idéal pour commencer." },
  { mode: "write", icon: Pencil, title: "Écrire", text: "Écris le mot dans la langue, accents compris. Ce qui fixe le mieux." },
  { mode: "listen", icon: Headphones, title: "Écoute", text: "Écoute le mot et écris-le : oreille et orthographe." },
] as const;

function Learn({ d, onQuiz, quizBusy }: { d: Deck; onQuiz: () => void; quizBusy: boolean }) {
  const [all, setAll] = useState(false);
  const [dir, setDir] = useState<"lf" | "fl" | "mix">("lf");
  useEffect(() => {
    try {
      const v = localStorage.getItem("bos.vocab.dir");
      if (v === "lf" || v === "fl" || v === "mix") setDir(v);
    } catch {}
  }, []);
  const pickDir = (v: "lf" | "fl" | "mix") => {
    setDir(v);
    try {
      localStorage.setItem("bos.vocab.dir", v);
    } catch {}
  };
  const due = d.cards.filter((c) => c.due).length;
  const fresh = d.cards.filter((c) => c.state === "new").length;
  const known = d.cards.filter((c) => c.interval >= 21).length;
  const today = due + Math.min(fresh, 20);
  const href = (mode: string) => `/vocabulaire/study?deck=${d.id}&mode=${mode}${all ? "&all=1" : ""}${mode === "cards" || mode === "mcq" ? `&dir=${dir}` : ""}`;
  if (!d.cards.length) return <Card className="px-6 py-10 text-center text-[13px] text-fg-2">Ajoute des mots dans l'onglet « Mots » pour commencer.</Card>;
  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <div className="grid grid-cols-3 gap-2 text-center">
          <Mini value={due} label="à revoir" tone={due ? "text-warning" : undefined} />
          <Mini value={fresh} label="nouveaux" tone={fresh ? "text-accent" : undefined} />
          <Mini value={known} label={`sus sur ${d.cards.length}`} tone={known ? "text-success" : undefined} />
        </div>
        <Progress className="mt-3" value={d.cards.length ? (known / d.cards.length) * 100 : 0} color="var(--success)" />
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex-1">
            <Toggle checked={all} onChange={setAll} label="Tout le paquet (avant un contrôle)" />
            <p className="t-meta mt-1">{all ? `Les ${d.cards.length} mots, même ceux déjà sus.` : today ? `Séance du jour : ${plural(today, "carte", "cartes")}.` : "Rien à revoir aujourd'hui : active « Tout le paquet » pour t'entraîner."}</p>
          </div>
          <div className="flex flex-col gap-1">
            <span className="t-meta">Sens des cartes</span>
            <Segmented size="sm" value={dir} onChange={pickDir} options={[{ value: "lf", label: `${langFlag(d.lang)} → FR` }, { value: "fl", label: `FR → ${langFlag(d.lang)}` }, { value: "mix", label: "Mélangé" }]} />
          </div>
        </div>
      </Card>
      <div className="grid grid-cols-2 gap-3">
        {MODES.map((m) => {
          const disabled = !all && !today;
          return (
            <Link
              key={m.mode}
              href={href(m.mode)}
              aria-disabled={disabled}
              className={cn("focus-ring surface flex min-w-0 flex-col gap-2 rounded-[18px] p-4 transition-colors hover:bg-bg-2 active:scale-[0.98]", disabled && "pointer-events-none opacity-50")}
            >
              <m.icon className="size-5 text-accent" />
              <p className="text-[14.5px] font-semibold">{m.title}</p>
              <p className="t-meta leading-snug">{m.text}</p>
            </Link>
          );
        })}
      </div>
      {d.source === "drive" && (
        <Card className="flex flex-wrap items-center gap-3 p-4">
          <ListChecks className="size-4 shrink-0 text-accent" />
          <p className="min-w-0 flex-1 text-[13px]">Quiz complet sur le cours : compréhension du texte, grammaire, phrases à trous, traduction.</p>
          <Button size="sm" variant="primary" loading={quizBusy} onClick={onQuiz}>
            Faire le quiz
          </Button>
        </Card>
      )}
    </div>
  );
}

function Mini({ value, label, tone }: { value: number; label: string; tone?: string }) {
  return (
    <div className="rounded-[12px] bg-raised px-2 py-2.5">
      <p className={cn("t-num text-[20px] font-semibold", tone)}>{value}</p>
      <p className="t-meta leading-tight">{label}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ mots */

function Words({ d, onChange }: { d: Deck; onChange: () => Promise<unknown> }) {
  const { busy, run } = useRun();
  const [term, setTerm] = useState("");
  const [translation, setTranslation] = useState("");
  const [example, setExample] = useState("");
  const [paste, setPaste] = useState(false);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<FlashCard | null>(null);
  const [filter, setFilter] = useState("");
  const shown = filter.trim() ? d.cards.filter((c) => `${c.term} ${c.translation}`.toLowerCase().includes(filter.trim().toLowerCase())) : d.cards;

  const add = () =>
    run(
      "add",
      async () => {
        await api.post(`/api/flashcards/${d.id}/cards`, { cards: [{ term, translation, example: example.trim() || null }] });
        setTerm("");
        setTranslation("");
        setExample("");
        await onChange();
        document.getElementById("vocab-term")?.focus();
      },
      "Mot non ajouté",
    );
  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <p className="t-section mr-auto">Ajouter des mots</p>
          <Button size="sm" variant="ghost" onClick={() => setPaste((p) => !p)}>
            {paste ? "Un par un" : "Coller une liste"}
          </Button>
        </div>
        {paste ? (
          <div className="flex flex-col gap-2">
            <Textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={"un mot par ligne :\nthe city = la ville\nto grow up = grandir"} className="min-h-[120px]" />
            <Button
              variant="primary"
              className="self-end"
              disabled={!text.trim()}
              loading={busy === "paste"}
              onClick={() =>
                run(
                  "paste",
                  async () => {
                    await api.post(`/api/flashcards/${d.id}/cards`, { text });
                    setText("");
                    setPaste(false);
                    await onChange();
                  },
                  "Liste non ajoutée",
                )
              }
            >
              Ajouter la liste
            </Button>
          </div>
        ) : (
          <form
            className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]"
            onSubmit={(e) => {
              e.preventDefault();
              if (term.trim() && translation.trim()) add();
            }}
          >
            <Input id="vocab-term" value={term} onChange={(e) => setTerm(e.target.value)} placeholder={`Mot en ${langLabel(d.lang).toLowerCase()}`} maxLength={200} autoCapitalize="off" lang={d.lang} />
            <Input value={translation} onChange={(e) => setTranslation(e.target.value)} placeholder="Traduction" maxLength={200} />
            <Button type="submit" variant="primary" icon={<Plus className="size-3.5" />} disabled={!term.trim() || !translation.trim()} loading={busy === "add"}>
              Ajouter
            </Button>
            <Input className="sm:col-span-2" value={example} onChange={(e) => setExample(e.target.value)} placeholder="Exemple (facultatif)" maxLength={300} lang={d.lang} />
          </form>
        )}
      </Card>

      {d.cards.length > 0 && (
        <Card className="overflow-hidden">
          <div className="flex items-center gap-2 border-b border-line-soft px-4 py-3">
            <p className="t-section mr-auto">{plural(d.cards.length, "mot", "mots")}</p>
            {d.cards.length > 8 && <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Chercher…" className="h-8 w-[150px]" />}
          </div>
          <ul className="divide-y divide-line-soft">
            {shown.map((c) => {
              const s = cardState(c);
              return (
                <li key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                  <Speak text={c.term} lang={d.lang} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px]">
                      <span className="font-medium" lang={d.lang}>
                        {c.term}
                      </span>
                      <span className="text-fg-3"> · </span>
                      <span className="text-fg-2">{c.translation}</span>
                    </p>
                    {(c.example || c.note) && (
                      <p className="t-meta truncate" lang={d.lang}>
                        {c.example}
                        {c.example && c.note ? " · " : ""}
                        {c.note}
                      </p>
                    )}
                  </div>
                  <Badge tone={s.tone} className="hidden sm:inline-flex">
                    {s.label}
                  </Badge>
                  <Button size="icon-sm" variant="ghost" onClick={() => setEditing(c)} aria-label={`Modifier ${c.term}`}>
                    <Pencil className="size-3.5" />
                  </Button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      <EditCard card={editing} lang={d.lang} onClose={() => setEditing(null)} onSaved={onChange} />
    </div>
  );
}

function EditCard({ card, lang, onClose, onSaved }: { card: FlashCard | null; lang: string; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const { busy, run } = useRun();
  const [v, setV] = useState({ term: "", translation: "", example: "", exampleFr: "", note: "" });
  useEffect(() => {
    if (card) setV({ term: card.term, translation: card.translation, example: card.example ?? "", exampleFr: card.exampleFr ?? "", note: card.note ?? "" });
  }, [card]);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  return (
    <Dialog
      open={!!card}
      onClose={onClose}
      title="Modifier la carte"
      footer={
        <>
          <Button
            variant="danger"
            className="mr-auto"
            icon={<Trash2 className="size-3.5" />}
            loading={busy === "del"}
            onClick={() =>
              run("del", async () => {
                await api.del(`/api/flashcards/cards/${card!.id}`);
                await onSaved();
                onClose();
              })
            }
          >
            Supprimer
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            variant="primary"
            disabled={!v.term.trim() || !v.translation.trim()}
            loading={busy === "save"}
            onClick={() =>
              run("save", async () => {
                await api.patch(`/api/flashcards/cards/${card!.id}`, { term: v.term, translation: v.translation, example: v.example || null, exampleFr: v.exampleFr || null, note: v.note || null });
                await onSaved();
                onClose();
              })
            }
          >
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`Mot (${langLabel(lang)})`}>
          <Input value={v.term} onChange={set("term")} maxLength={200} lang={lang} />
        </Field>
        <Field label="Traduction">
          <Input value={v.translation} onChange={set("translation")} maxLength={200} />
        </Field>
        <Field label="Exemple" className="sm:col-span-2">
          <Input value={v.example} onChange={set("example")} maxLength={300} lang={lang} />
        </Field>
        <Field label="Traduction de l'exemple" className="sm:col-span-2">
          <Input value={v.exampleFr} onChange={set("exampleFr")} maxLength={300} />
        </Field>
        <Field label="Remarque" hint="Genre, verbe irrégulier, faux ami…" className="sm:col-span-2">
          <Input value={v.note} onChange={set("note")} maxLength={200} />
        </Field>
      </div>
    </Dialog>
  );
}

function RenameDialog({ open, initial, onClose, onSave }: { open: boolean; initial: string; onClose: () => void; onSave: (t: string) => void }) {
  const [t, setT] = useState(initial);
  useEffect(() => {
    if (open) setT(initial);
  }, [open, initial]);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Renommer le paquet"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" disabled={!t.trim()} onClick={() => onSave(t.trim())}>
            Enregistrer
          </Button>
        </>
      }
    >
      <Input autoFocus value={t} onChange={(e) => setT(e.target.value)} maxLength={120} />
    </Dialog>
  );
}

/* ------------------------------------------------------------------ fiche du cours */

function Guide({ d, onBuild, building }: { d: Deck; onBuild: () => void; building: boolean }) {
  const [hideFr, setHideFr] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [idx, setIdx] = useState<number | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const [openOral, setOpenOral] = useState<Set<number>>(new Set());
  useEffect(() => () => stopRef.current?.(), []);
  const g = d.guide;

  if (d.guideStatus === "generating")
    return (
      <Card className="flex flex-col items-center px-6 py-12 text-center">
        <Loader2 className="size-6 animate-spin text-accent" />
        <p className="mt-3 text-[15px] font-semibold">L'IA prépare la fiche du cours…</p>
        <p className="t-sub mt-1">Résumé, phrases clés, grammaire et questions d'oral.</p>
      </Card>
    );
  if (!g)
    return (
      <Card className="flex flex-col items-center px-6 py-10 text-center">
        <BookOpenText className="size-6 text-fg-3" />
        <p className="mt-3 text-[15px] font-semibold">{d.guideStatus === "error" ? "La fiche n'a pas pu être créée" : "Fiche pour apprendre le cours"}</p>
        <p className="t-sub mt-1 max-w-[460px]">Le cours expliqué en français, les phrases clés à savoir par cœur, la grammaire et des questions d'oral avec une réponse modèle, tout se lit à voix haute.</p>
        <Button className="mt-4" variant="primary" icon={<BookOpenText className="size-3.5" />} loading={building} disabled={!d.hasText && d.cards.length < 3} onClick={onBuild}>
          {d.guideStatus === "error" ? "Réessayer" : "Créer la fiche"}
        </Button>
      </Card>
    );

  const playAll = () => {
    if (playing) {
      stopRef.current?.();
      setPlaying(false);
      return;
    }
    setPlaying(true);
    stopRef.current = speakAll(
      g.sentences.map((s) => s.text),
      d.lang,
      (i) => {
        setIdx(i);
        if (i === null) setPlaying(false);
      },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <p className="t-section mb-2 flex items-center gap-2">
          <span className="t-num grid size-6 place-items-center rounded-full bg-raised text-[11px]">1</span>Comprendre le cours
        </p>
        <p className="text-[14px] leading-relaxed whitespace-pre-line text-fg-2">{g.summary}</p>
      </Card>

      {g.sentences.length > 0 && (
        <Card className="p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <p className="t-section mr-auto flex items-center gap-2">
              <span className="t-num grid size-6 place-items-center rounded-full bg-raised text-[11px]">2</span>Phrases clés à retenir
            </p>
            <Toggle checked={hideFr} onChange={setHideFr} label="Cacher le français" />
            <Button size="sm" icon={playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />} onClick={playAll}>
              {playing ? "Arrêter" : "Tout écouter"}
            </Button>
          </div>
          <ol className="flex flex-col gap-2.5">
            {g.sentences.map((s, i) => (
              <Sentence key={i} text={s.text} fr={s.fr} lang={d.lang} hideFr={hideFr} active={playing && idx === i} />
            ))}
          </ol>
          <p className="t-meta mt-3">Astuce : écoute, répète à voix haute, puis cache le français et retraduis chaque phrase.</p>
        </Card>
      )}

      {g.grammar.length > 0 && (
        <Card className="p-4">
          <p className="t-section mb-3 flex items-center gap-2">
            <span className="t-num grid size-6 place-items-center rounded-full bg-raised text-[11px]">3</span>Grammaire du cours
          </p>
          <div className="flex flex-col gap-4">
            {g.grammar.map((x, i) => (
              <div key={i}>
                <p className="text-[14px] font-semibold">{x.title}</p>
                <p className="mt-1 text-[13.5px] leading-relaxed text-fg-2">{x.explanation}</p>
                <ul className="mt-2 flex flex-col gap-2">
                  {x.examples.map((e, k) => (
                    <Sentence key={k} text={e.text} fr={e.fr} lang={d.lang} hideFr={hideFr} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Card>
      )}

      {g.oral.length > 0 && (
        <Card className="p-4">
          <p className="t-section mb-1 flex items-center gap-2">
            <span className="t-num grid size-6 place-items-center rounded-full bg-raised text-[11px]">4</span>S'entraîner à l'oral
          </p>
          <p className="t-meta mb-3">Réponds d'abord à voix haute, puis compare avec la réponse modèle.</p>
          <ul className="flex flex-col gap-3">
            {g.oral.map((o, i) => {
              const open = openOral.has(i);
              return (
                <li key={i} className="rounded-[14px] border border-line-soft p-3">
                  <div className="flex items-start gap-2">
                    <MessageCircle className="mt-0.5 size-4 shrink-0 text-accent" />
                    <p className="min-w-0 flex-1 text-[14px] font-medium" lang={d.lang}>
                      {o.question}
                    </p>
                    <Speak text={o.question} lang={d.lang} size="sm" />
                  </div>
                  {open ? (
                    <div className="mt-2 border-t border-line-soft pt-2">
                      <div className="flex items-start gap-2">
                        <p className="min-w-0 flex-1 text-[13.5px] leading-relaxed" lang={d.lang}>
                          {o.answer}
                        </p>
                        <Speak text={o.answer} lang={d.lang} size="sm" />
                      </div>
                      {!hideFr && <p className="t-meta mt-1.5 leading-snug">{o.fr}</p>}
                    </div>
                  ) : (
                    <button className="focus-ring mt-2 inline-flex items-center gap-1.5 rounded-[7px] text-[12.5px] text-accent" onClick={() => setOpenOral(new Set(openOral).add(i))}>
                      <Ear className="size-3.5" />
                      Voir une réponse modèle
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Button variant="ghost" className="self-center" icon={<RefreshCw className="size-3.5" />} loading={building} onClick={onBuild}>
        Refaire la fiche
      </Button>
    </div>
  );
}

function Sentence({ text, fr, lang, hideFr, active }: { text: string; fr: string; lang: string; hideFr: boolean; active?: boolean }) {
  const [peek, setPeek] = useState(false);
  return (
    <li className={cn("flex items-start gap-2.5 rounded-[12px] px-2 py-1.5 transition-colors", active && "bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]")}>
      <Speak text={text} lang={lang} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="text-[14px] leading-snug" lang={lang}>
          {text}
        </p>
        {hideFr && !peek ? (
          <button className="t-meta mt-0.5 underline decoration-dotted" onClick={() => setPeek(true)}>
            Voir la traduction
          </button>
        ) : (
          <p className="t-meta mt-0.5 leading-snug">{fr}</p>
        )}
      </div>
      <Speak text={text} lang={lang} size="sm" slow className="hidden sm:grid" />
    </li>
  );
}

