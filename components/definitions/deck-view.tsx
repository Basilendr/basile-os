"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, BookOpenText, Eye, EyeOff, Highlighter, Layers, ListChecks, Loader2, MoreHorizontal, Pencil, Plus, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { api } from "@/lib/client/api";
import { cn, plural } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Menu } from "@/components/ui/menu";
import { Segmented } from "@/components/ui/tabs";
import { Badge, Card, ErrorState, Progress, Skeleton } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { Toggle, useRun } from "@/components/flashcards/shared";
import { KeyChips, Marked, defState, type DefCard } from "./shared";

type Deck = {
  id: string;
  title: string;
  subject: string | null;
  source: string;
  sources: { id: string; name: string }[];
  focus: string | null;
  status: string;
  error: string | null;
  keywordsStatus: string;
  date: string;
  cards: DefCard[];
};
type Tab = "learn" | "read" | "edit";

export function DefDeckView({ id }: { id: string }) {
  const sp = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { busy, run } = useRun();
  const [tab, setTabState] = useState<Tab>((sp.get("tab") as Tab) || "learn");
  const [renaming, setRenaming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const { data: d, error, refetch } = useQuery({
    queryKey: ["defs", "deck", id],
    queryFn: () => api.get<Deck>(`/api/definitions/${id}`),
    refetchInterval: (q) => (q.state.data?.status === "generating" || q.state.data?.keywordsStatus === "generating" ? 2500 : false),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["defs"] });
  const setTab = (t: Tab) => {
    setTabState(t);
    router.replace(`/definitions/${id}${t === "learn" ? "" : `?tab=${t}`}`, { scroll: false });
  };
  const analyze = () =>
    run(
      "kw",
      async () => {
        await api.post(`/api/definitions/${id}/keywords`);
        await refetch();
      },
      "Analyse non lancée",
    );

  return (
    <div className="mx-auto max-w-[900px] px-1 pt-1 pb-12 md:px-3 md:pt-2">
      <Link href="/definitions" className="focus-ring mb-4 inline-flex items-center gap-1.5 rounded-[7px] text-[13px] text-fg-2 hover:text-fg">
        <ArrowLeft className="size-3.5" />
        Définitions
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
            <div className="min-w-0 flex-1">
              <h1 className="text-[20px] leading-tight font-semibold text-balance">{d.title || (d.status === "generating" ? "Lecture du cours…" : "Sans titre")}</h1>
              <p className="t-meta mt-1 truncate">
                {d.subject ? `${d.subject} · ` : ""}
                {plural(d.cards.length, "définition", "définitions")}
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
                { label: "Refaire l'analyse des mots clés", icon: <Highlighter />, onSelect: analyze },
                { type: "separator" },
                { label: "Tout réapprendre (remettre à zéro)", icon: <RotateCcw />, onSelect: () => setResetting(true) },
                { label: "Supprimer le paquet", icon: <Trash2 />, danger: true, onSelect: () => setRemoving(true) },
              ]}
            />
          </header>

          {d.status === "generating" ? (
            <Card className="flex flex-col items-center px-6 py-12 text-center">
              <Loader2 className="size-6 animate-spin text-accent" />
              <p className="mt-3 text-[15px] font-semibold">L'IA lit ton cours et repère les définitions…</p>
              <p className="t-sub mt-1">Ça prend en général moins d'une minute. Tu peux quitter cette page.</p>
            </Card>
          ) : d.status === "error" ? (
            <Card className="mb-4 flex flex-col items-center px-6 py-10 text-center">
              <p className="text-[15px] font-semibold">Les définitions n'ont pas pu être créées</p>
              <p className="t-sub mt-1 max-w-[460px]">{d.error}</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Button
                  variant="primary"
                  icon={<RefreshCw className="size-3.5" />}
                  loading={busy === "retry"}
                  onClick={() =>
                    run("retry", async () => {
                      await api.post(`/api/definitions/${id}/retry`);
                      await refetch();
                    })
                  }
                >
                  Réessayer
                </Button>
                <Button onClick={() => setTab("edit")} icon={<Plus className="size-3.5" />}>
                  Les saisir à la main
                </Button>
              </div>
            </Card>
          ) : null}

          {d.status !== "generating" && (
            <>
              {d.keywordsStatus === "generating" && (
                <p className="mb-3 flex items-center gap-2 rounded-[12px] bg-raised px-3 py-2 text-[13px] text-fg-2">
                  <Loader2 className="size-3.5 animate-spin" />
                  L'IA analyse tes définitions pour trouver les mots importants…
                </p>
              )}
              {d.keywordsStatus === "error" && (
                <div className="mb-3 flex flex-wrap items-center gap-2 rounded-[12px] bg-raised px-3 py-2 text-[13px] text-fg-2">
                  <span className="min-w-0 flex-1">L'IA n'a pas pu analyser les définitions : les mots clés ont été choisis automatiquement.</span>
                  <Button size="sm" loading={busy === "kw"} onClick={analyze}>
                    Réessayer
                  </Button>
                </div>
              )}
              <div className="-mx-1 mb-4 overflow-x-auto px-1">
                <Segmented
                  value={tab}
                  onChange={setTab}
                  options={[
                    { value: "learn", label: "Apprendre", icon: <Layers className="size-3.5" /> },
                    { value: "read", label: "Relire", icon: <BookOpenText className="size-3.5" /> },
                    { value: "edit", label: "Définitions", count: d.cards.length, icon: <ListChecks className="size-3.5" /> },
                  ]}
                />
              </div>
              {tab === "learn" && <Learn d={d} onRead={() => setTab("read")} />}
              {tab === "read" && <Read d={d} />}
              {tab === "edit" && <Edit d={d} onChange={() => Promise.all([refetch(), refresh()])} />}
            </>
          )}

          <RenameDialog
            open={renaming}
            initial={{ title: d.title, subject: d.subject ?? "" }}
            onClose={() => setRenaming(false)}
            onSave={(v) =>
              run("rename", async () => {
                await api.patch(`/api/definitions/${id}`, { title: v.title, subject: v.subject || null });
                await Promise.all([refetch(), refresh()]);
                setRenaming(false);
              })
            }
          />
          <ConfirmDialog
            open={resetting}
            onClose={() => setResetting(false)}
            title="Tout réapprendre ?"
            description="Toutes les définitions redeviennent nouvelles : ta progression est effacée."
            confirmLabel="Remettre à zéro"
            loading={busy === "reset"}
            onConfirm={() =>
              run("reset", async () => {
                await api.post(`/api/definitions/${id}/reset`);
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
            description={`« ${d.title || "Sans titre"} » et ses ${d.cards.length} définitions seront supprimés.`}
            confirmLabel="Supprimer"
            danger
            loading={busy === "remove"}
            onConfirm={() =>
              run("remove", async () => {
                await api.del(`/api/definitions/${id}`);
                await refresh();
                router.push("/definitions");
              })
            }
          />
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ apprendre */

const MODES = [
  { mode: "cards", icon: Layers, title: "Cartes", text: "La notion d'un côté, la définition de l'autre. Retourne, dis si tu savais." },
  { mode: "mcq", icon: ListChecks, title: "QCM", text: "Retrouve la bonne définition (ou la bonne notion) parmi quatre." },
  { mode: "write", icon: Pencil, title: "Écrire", text: "Écris la définition : elle est juste si les mots importants y sont." },
] as const;

function Learn({ d, onRead }: { d: Deck; onRead: () => void }) {
  const [all, setAll] = useState(false);
  const due = d.cards.filter((c) => c.due).length;
  const fresh = d.cards.filter((c) => c.state === "new").length;
  const known = d.cards.filter((c) => c.interval >= 21).length;
  const today = due + Math.min(fresh, 15);
  const href = (mode: string) => `/definitions/study?deck=${d.id}&mode=${mode}${all ? "&all=1" : ""}`;
  if (!d.cards.length) return <Card className="px-6 py-10 text-center text-[13px] text-fg-2">Ajoute des définitions dans l'onglet « Définitions » pour commencer.</Card>;
  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <div className="grid grid-cols-3 gap-2 text-center">
          <Mini value={due} label="à revoir" tone={due ? "text-warning" : undefined} />
          <Mini value={fresh} label="nouvelles" tone={fresh ? "text-accent" : undefined} />
          <Mini value={known} label={`sues sur ${d.cards.length}`} tone={known ? "text-success" : undefined} />
        </div>
        <Progress className="mt-3" value={d.cards.length ? (known / d.cards.length) * 100 : 0} color="var(--success)" />
        <div className="mt-4">
          <Toggle checked={all} onChange={setAll} label="Tout le paquet (avant un contrôle)" />
          <p className="t-meta mt-1">{all ? `Les ${d.cards.length} définitions, même celles déjà sues.` : today ? `Séance du jour : ${plural(today, "définition", "définitions")}.` : "Rien à revoir aujourd'hui : active « Tout le paquet » pour t'entraîner."}</p>
        </div>
      </Card>
      <button onClick={onRead} className="focus-ring surface flex items-center gap-3 rounded-[18px] p-4 text-left transition-colors hover:bg-bg-2 active:scale-[0.99]">
        <span className="t-num grid size-8 shrink-0 place-items-center rounded-full bg-accent text-[13px] font-semibold text-white">1</span>
        <div className="min-w-0 flex-1">
          <p className="text-[14.5px] font-semibold">Relire avant de commencer</p>
          <p className="t-meta leading-snug">Toutes tes définitions, mots importants surlignés. Deux minutes suffisent.</p>
        </div>
        <BookOpenText className="size-5 text-accent" />
      </button>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {MODES.map((m, i) => {
          const disabled = !all && !today;
          return (
            <Link
              key={m.mode}
              href={href(m.mode)}
              aria-disabled={disabled}
              className={cn("focus-ring surface flex min-w-0 flex-col gap-2 rounded-[18px] p-4 transition-colors hover:bg-bg-2 active:scale-[0.98]", disabled && "pointer-events-none opacity-50")}
            >
              <span className="flex items-center gap-2">
                <span className="t-num grid size-6 place-items-center rounded-full bg-raised text-[11px] font-semibold">{i + 2}</span>
                <m.icon className="size-5 text-accent" />
              </span>
              <p className="text-[14.5px] font-semibold">{m.title}</p>
              <p className="t-meta leading-snug">{m.text}</p>
            </Link>
          );
        })}
      </div>
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

/* ------------------------------------------------------------------ relire */

function Read({ d }: { d: Deck }) {
  const [hide, setHide] = useState(false);
  const [shown, setShown] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setShown((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  if (!d.cards.length) return <Card className="px-6 py-10 text-center text-[13px] text-fg-2">Aucune définition pour l'instant.</Card>;
  return (
    <div className="flex flex-col gap-3">
      <Card className="flex flex-wrap items-center gap-3 px-4 py-3">
        <Highlighter className="size-4 shrink-0 text-warning" />
        <p className="min-w-0 flex-1 text-[13px] text-fg-2">Les mots surlignés sont ceux à retrouver absolument. Lis chaque définition à voix haute.</p>
        <Button
          size="sm"
          variant={hide ? "primary" : "secondary"}
          icon={hide ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
          onClick={() => {
            setHide((h) => !h);
            setShown(new Set());
          }}
        >
          {hide ? "Tout montrer" : "Me tester"}
        </Button>
      </Card>
      <ol className="flex flex-col gap-2">
        {d.cards.map((c, i) => {
          const hidden = hide && !shown.has(c.id);
          return (
            <li key={c.id}>
              <Card className={cn("p-4", hide && "cursor-pointer")} onClick={hide ? () => toggle(c.id) : undefined}>
                <p className="flex items-baseline gap-2">
                  <span className="t-num t-meta w-5 shrink-0">{i + 1}</span>
                  <span className="text-[15.5px] font-semibold">{c.term}</span>
                </p>
                {hidden ? (
                  <p className="t-meta mt-1.5 pl-7">Dis-la dans ta tête, puis touche pour vérifier.</p>
                ) : (
                  <div className="mt-1.5 pl-7">
                    <p className="text-[14.5px] leading-relaxed">
                      <Marked definition={c.definition} keywords={c.keywords} />
                    </p>
                    {c.keywords.length > 0 && <KeyChips keywords={c.keywords} className="mt-2" />}
                  </div>
                )}
              </Card>
            </li>
          );
        })}
      </ol>
      <Link href={`/definitions/study?deck=${d.id}&mode=cards&all=1`} className="self-center">
        <Button variant="primary" className="h-11 px-6" icon={<Layers className="size-4" />}>
          J'ai relu : aux cartes
        </Button>
      </Link>
    </div>
  );
}

/* ------------------------------------------------------------------ définitions (saisie) */

function Edit({ d, onChange }: { d: Deck; onChange: () => Promise<unknown> }) {
  const { busy, run } = useRun();
  const [term, setTerm] = useState("");
  const [definition, setDefinition] = useState("");
  const [paste, setPaste] = useState(false);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<DefCard | null>(null);
  const [filter, setFilter] = useState("");
  const q = filter.trim().toLowerCase();
  const shown = q ? d.cards.filter((c) => `${c.term} ${c.definition}`.toLowerCase().includes(q)) : d.cards;

  const add = () =>
    run(
      "add",
      async () => {
        await api.post(`/api/definitions/${d.id}/cards`, { cards: [{ term, definition }] });
        setTerm("");
        setDefinition("");
        await onChange();
        document.getElementById("def-term")?.focus();
      },
      "Définition non ajoutée",
    );
  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <p className="t-section mr-auto">Ajouter des définitions</p>
          <Button size="sm" variant="ghost" onClick={() => setPaste((p) => !p)}>
            {paste ? "Une par une" : "Coller une liste"}
          </Button>
        </div>
        {paste ? (
          <div className="flex flex-col gap-2">
            <Textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={"une par ligne :\nNomenclature : classement organisé en catégories.\nSalarié : personne travaillant pour un employeur en échange d'un salaire."} className="min-h-[130px]" />
            <Button
              variant="primary"
              className="self-end"
              disabled={!text.trim()}
              loading={busy === "paste"}
              onClick={() =>
                run(
                  "paste",
                  async () => {
                    await api.post(`/api/definitions/${d.id}/cards`, { text });
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
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (term.trim() && definition.trim()) add();
            }}
          >
            <Input id="def-term" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Notion (ex. Capital social)" maxLength={200} />
            <Textarea rows={2} value={definition} onChange={(e) => setDefinition(e.target.value)} placeholder="Définition" maxLength={1500} />
            <Button type="submit" variant="primary" className="self-end" icon={<Plus className="size-3.5" />} disabled={!term.trim() || !definition.trim()} loading={busy === "add"}>
              Ajouter
            </Button>
          </form>
        )}
      </Card>

      {d.cards.length > 0 && (
        <Card className="overflow-hidden">
          <div className="flex items-center gap-2 border-b border-line-soft px-4 py-3">
            <p className="t-section mr-auto">{plural(d.cards.length, "définition", "définitions")}</p>
            {d.cards.length > 8 && <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Chercher…" className="h-8 w-[150px]" />}
          </div>
          <ul className="divide-y divide-line-soft">
            {shown.map((c) => {
              const s = defState(c);
              return (
                <li key={c.id} className="flex items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-medium">{c.term}</p>
                    <p className="mt-0.5 text-[13.5px] leading-snug text-fg-2">
                      <Marked definition={c.definition} keywords={c.keywords} />
                    </p>
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
      <EditCard card={editing} onClose={() => setEditing(null)} onSaved={onChange} />
    </div>
  );
}

const splitKeys = (s: string) =>
  s
    .split(/[,;\n]/)
    .map((k) => k.trim())
    .filter(Boolean);

function EditCard({ card, onClose, onSaved }: { card: DefCard | null; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const { busy, run } = useRun();
  const [v, setV] = useState({ term: "", definition: "", keywords: "" });
  useEffect(() => {
    if (card) setV({ term: card.term, definition: card.definition, keywords: card.keywords.join(", ") });
  }, [card]);
  const keysChanged = !!card && splitKeys(v.keywords).join("|") !== card.keywords.join("|");
  return (
    <Dialog
      open={!!card}
      onClose={onClose}
      title="Modifier la définition"
      size="lg"
      footer={
        <>
          <Button
            variant="danger"
            className="mr-auto"
            icon={<Trash2 className="size-3.5" />}
            loading={busy === "del"}
            onClick={() =>
              run("del", async () => {
                await api.del(`/api/definitions/cards/${card!.id}`);
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
            disabled={!v.term.trim() || !v.definition.trim()}
            loading={busy === "save"}
            onClick={() =>
              run("save", async () => {
                await api.patch(`/api/definitions/cards/${card!.id}`, { term: v.term, definition: v.definition, ...(keysChanged ? { keywords: splitKeys(v.keywords) } : {}) });
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
      <div className="flex flex-col gap-3">
        <Field label="Notion">
          <Input value={v.term} onChange={(e) => setV({ ...v, term: e.target.value })} maxLength={200} />
        </Field>
        <Field label="Définition">
          <Textarea rows={3} value={v.definition} onChange={(e) => setV({ ...v, definition: e.target.value })} maxLength={1500} />
        </Field>
        <Field label="Mots importants" hint="Séparés par des virgules, recopiés de la définition. Laisse tel quel pour que l'IA les choisisse.">
          <Input value={v.keywords} onChange={(e) => setV({ ...v, keywords: e.target.value })} maxLength={400} />
        </Field>
        {v.definition.trim() && (
          <p className="rounded-[10px] bg-raised px-3 py-2 text-[13.5px] leading-relaxed">
            <Marked definition={v.definition} keywords={splitKeys(v.keywords)} />
          </p>
        )}
      </div>
    </Dialog>
  );
}

function RenameDialog({ open, initial, onClose, onSave }: { open: boolean; initial: { title: string; subject: string }; onClose: () => void; onSave: (v: { title: string; subject: string }) => void }) {
  const [v, setV] = useState(initial);
  useEffect(() => {
    if (open) setV(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Renommer le paquet"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" disabled={!v.title.trim()} onClick={() => onSave({ title: v.title.trim(), subject: v.subject.trim() })}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Titre">
          <Input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} maxLength={120} autoFocus />
        </Field>
        <Field label="Matière">
          <Input value={v.subject} onChange={(e) => setV({ ...v, subject: e.target.value })} maxLength={60} />
        </Field>
      </div>
    </Dialog>
  );
}
