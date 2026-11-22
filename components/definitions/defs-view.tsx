"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BookMarked, ClipboardPaste, FileText, FolderOpen, Keyboard, Layers, Loader2, Plus, X } from "lucide-react";
import { api } from "@/lib/client/api";
import { cn, plural } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/tabs";
import { Badge, Card, EmptyState, ErrorState, PageHeader, Progress, Skeleton } from "@/components/ui/misc";
import { DrivePicker, type PickedDoc } from "@/components/quiz/drive-picker";
import { useRun } from "@/components/flashcards/shared";
import type { DefDeckSummary, DefOverview } from "./shared";

export function useDefs() {
  return useQuery({
    queryKey: ["defs"],
    queryFn: () => api.get<DefOverview>("/api/definitions"),
    refetchInterval: (q) => (q.state.data?.decks.some((d) => d.status === "generating" || d.keywords === "generating") ? 3000 : 60_000),
  });
}

const SOURCE: Record<string, string> = { drive: "Drive", text: "Collé", manual: "Saisi à la main" };

/** Définitions à apprendre : paquets et révision du jour. */
export function DefsView() {
  const { data: o, error, refetch } = useDefs();
  const [creating, setCreating] = useState(false);

  return (
    <div className="mx-auto max-w-[1180px] px-1 pt-1 pb-10 md:px-3 md:pt-2">
      <PageHeader
        title="Définitions"
        description="Colle tes définitions : l'IA repère les mots importants, tu relis puis tu t'entraînes un peu chaque jour."
        actions={
          <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setCreating(true)}>
            Nouveau paquet
          </Button>
        }
      />
      {error ? (
        <Card>
          <ErrorState error={error} onRetry={() => refetch()} />
        </Card>
      ) : !o ? (
        <div className="grid gap-4">
          <Skeleton className="h-36" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-36" />
            <Skeleton className="h-36" />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {!o.ready.ai && (
            <Card className="flex flex-wrap items-center gap-3 px-4 py-3">
              <AlertTriangle className="size-4 shrink-0 text-warning" />
              <p className="min-w-0 flex-1 text-[13px]">Sans clé d'IA, les mots importants sont choisis automatiquement (moins finement) et seules les listes collées ou saisies marchent.</p>
              <Link href="/settings?s=config">
                <Button size="sm" variant="primary">
                  Ouvrir les paramètres
                </Button>
              </Link>
            </Card>
          )}

          {o.decks.length > 0 && <TodayCard o={o} />}

          {o.decks.length === 0 ? (
            <Card>
              <EmptyState
                icon={<BookMarked className="size-5" />}
                title="Aucun paquet de définitions"
                description="Colle les définitions de ton cours (une par ligne, « notion : définition ») ou choisis le chapitre dans Drive : l'IA les retrouve et surligne les mots importants."
                action={
                  <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setCreating(true)}>
                    Créer mon premier paquet
                  </Button>
                }
              />
            </Card>
          ) : (
            <section className="flex flex-col gap-3">
              <h2 className="t-section px-1">Mes paquets</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {o.decks.map((d) => (
                  <DeckTile key={d.id} d={d} />
                ))}
              </div>
            </section>
          )}

          <Method />
        </div>
      )}
      <CreateDeck open={creating} onClose={() => setCreating(false)} ready={o?.ready} />
    </div>
  );
}

function TodayCard({ o }: { o: DefOverview }) {
  const t = o.totals;
  const todo = t.due + Math.min(t.fresh, 15);
  return (
    <Card className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="t-meta">Aujourd'hui</p>
        <p className="mt-1 text-[15px] font-semibold">
          {t.due > 0 ? plural(t.due, "définition à revoir", "définitions à revoir") : "Aucune définition à revoir"}
          {t.fresh > 0 ? ` · ${plural(t.fresh, "nouvelle", "nouvelles")}` : ""}
        </p>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center sm:max-w-[420px]">
          <Stat value={t.studiedToday} label="révisées aujourd'hui" />
          <Stat value={t.mastered} label="sues" />
          <Stat value={t.total} label="en tout" />
        </div>
      </div>
      <Link href="/definitions/study?mode=cards" className={cn("sm:w-[220px]", !todo && "pointer-events-none")}>
        <Button variant={todo ? "primary" : "secondary"} disabled={!todo} className="h-11 w-full justify-center text-[14px]" icon={<Layers className="size-4" />}>
          {todo ? `Réviser (${todo})` : "Tout est révisé"}
        </Button>
      </Link>
    </Card>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-[12px] bg-raised px-2 py-2">
      <p className="t-num text-[18px] font-semibold">{value}</p>
      <p className="t-meta leading-tight">{label}</p>
    </div>
  );
}

function DeckTile({ d }: { d: DefDeckSummary }) {
  const pct = d.total ? Math.round((d.mastered / d.total) * 100) : 0;
  return (
    <Link href={`/definitions/${d.id}`} className="focus-ring surface flex min-w-0 flex-col gap-3 rounded-[18px] p-4 transition-colors hover:bg-bg-2 active:scale-[0.99]">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-raised text-accent" aria-hidden>
          <BookMarked className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold">{d.title || (d.status === "generating" ? "Lecture du cours…" : "Sans titre")}</p>
          <p className="t-meta truncate">
            {d.subject ? `${d.subject} · ` : ""}
            {SOURCE[d.source] ?? d.source}
          </p>
        </div>
      </div>
      {d.status === "generating" ? (
        <p className="flex items-center gap-2 text-[13px] text-fg-2">
          <Loader2 className="size-3.5 animate-spin" />
          L'IA cherche les définitions…
        </p>
      ) : d.status === "error" ? (
        <p className="line-clamp-2 text-[13px] text-danger">{d.error ?? "Erreur"}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge>{plural(d.total, "définition", "définitions")}</Badge>
            {d.due > 0 && <Badge tone="warning">{d.due} à revoir</Badge>}
            {d.fresh > 0 && <Badge tone="accent">{d.fresh} nouvelles</Badge>}
            {d.keywords === "generating" && (
              <span className="t-meta inline-flex items-center gap-1">
                <Loader2 className="size-3 animate-spin" />
                mots clés
              </span>
            )}
          </div>
          <div>
            <Progress value={pct} color="var(--success)" />
            <p className="t-meta mt-1">{pct} % sues</p>
          </div>
        </>
      )}
    </Link>
  );
}

function Method() {
  const steps = [
    { t: "Relire", d: "Lis tes définitions : les mots surlignés sont ceux qu'il faut absolument retrouver." },
    { t: "Cartes", d: "La notion d'un côté, la définition de l'autre. Retourne et dis honnêtement si tu savais." },
    { t: "QCM", d: "Retrouve la bonne définition parmi quatre : idéal pour commencer." },
    { t: "Écrire", d: "Écris la définition avec tes mots : elle est juste si les mots importants y sont." },
  ];
  return (
    <Card className="p-4">
      <p className="t-section mb-3">La méthode en 4 étapes</p>
      <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s, i) => (
          <li key={s.t} className="flex gap-3">
            <span className="t-num grid size-7 shrink-0 place-items-center rounded-full bg-raised text-[12px] font-semibold">{i + 1}</span>
            <div className="min-w-0">
              <p className="text-[13.5px] font-medium">{s.t}</p>
              <p className="t-meta mt-0.5 leading-snug">{s.d}</p>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

/* ------------------------------------------------------------------ création d'un paquet */

type Tab = "text" | "drive" | "manual";

function CreateDeck({ open, onClose, ready }: { open: boolean; onClose: () => void; ready?: DefOverview["ready"] }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { busy, run } = useRun();
  const [tab, setTab] = useState<Tab>("text");
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [focus, setFocus] = useState("");
  const [text, setText] = useState("");
  const [doc, setDoc] = useState<PickedDoc | null>(null);
  const [picker, setPicker] = useState(false);

  const done = async (id: string, query = "") => {
    await qc.invalidateQueries({ queryKey: ["defs"] });
    setText("");
    setDoc(null);
    setTitle("");
    setFocus("");
    onClose();
    router.push(`/definitions/${id}${query}`);
  };
  const canSubmit = tab === "text" ? text.trim().length >= 5 : tab === "drive" ? !!doc : !!title.trim();
  const extra = { title: title.trim() || undefined, subject: subject.trim() || undefined };
  const submit = () =>
    run(
      "create",
      async () => {
        if (tab === "text") {
          const r = await api.post<{ id: string; generating: boolean }>("/api/definitions", { source: "text", text, focus: focus.trim() || undefined, ...extra });
          await done(r.id, r.generating ? "" : "?tab=read");
        } else if (tab === "drive") {
          const r = await api.post<{ id: string }>("/api/definitions", { source: "drive", doc, focus: focus.trim() || undefined, ...extra });
          await done(r.id);
        } else {
          const r = await api.post<{ id: string }>("/api/definitions", { source: "manual", title: title.trim(), subject: subject.trim() || undefined });
          await done(r.id, "?tab=edit");
        }
      },
      "Paquet non créé",
    );
  const needAi = tab === "drive" && ready && !ready.ai;

  return (
    <>
      <Dialog
        open={open && !picker}
        onClose={onClose}
        title="Nouveau paquet de définitions"
        description="Colle tes définitions ou choisis ton cours : l'IA repère les mots importants de chacune."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              Annuler
            </Button>
            <Button variant="primary" icon={tab === "manual" ? <Plus className="size-3.5" /> : <Layers className="size-3.5" />} disabled={!canSubmit || !!needAi} loading={busy === "create"} onClick={submit}>
              {tab === "manual" ? "Créer le paquet" : "Créer les cartes"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="-mx-1 overflow-x-auto px-1">
            <Segmented
              value={tab}
              onChange={setTab}
              options={[
                { value: "text", label: "Coller", icon: <ClipboardPaste className="size-3.5" /> },
                { value: "drive", label: "Drive", icon: <FolderOpen className="size-3.5" /> },
                { value: "manual", label: "À la main", icon: <Keyboard className="size-3.5" /> },
              ]}
            />
          </div>

          {needAi && <p className="rounded-[10px] bg-raised px-3 py-2 text-[13px] text-fg-2">L'IA n'est pas configurée : colle plutôt tes définitions.</p>}

          {tab === "text" && (
            <Field label="Tes définitions" hint="Une par ligne : « notion : définition ». Tu peux aussi coller un passage de cours : l'IA y trouvera les définitions.">
              <Textarea
                rows={8}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={"Lien social : relation rattachant un individu à d'autres.\nCapital social : ensemble des ressources accessibles grâce aux relations.\n…"}
                maxLength={60_000}
                className="min-h-[170px]"
              />
            </Field>
          )}

          {tab === "drive" && (
            <div className="flex flex-col gap-2">
              {ready && !ready.drive ? (
                <p className="text-[13px] text-fg-2">
                  Connecte Google Drive dans{" "}
                  <Link href="/integrations" className="text-accent underline">
                    Intégrations
                  </Link>{" "}
                  pour choisir un cours.
                </p>
              ) : (
                <>
                  <p className="text-[13px] text-fg-2">L'IA reprend les encadrés « Définitions » du cours, mot pour mot.</p>
                  {doc && (
                    <span className="inline-flex h-7 max-w-full items-center gap-1.5 self-start rounded-[8px] border border-line bg-raised pr-1 pl-2 text-[12.5px]">
                      <FileText className="size-3.5 shrink-0 text-fg-3" />
                      <span className="truncate">{doc.name}</span>
                      <button onClick={() => setDoc(null)} className="shrink-0 text-fg-3 hover:text-fg" aria-label="Retirer">
                        <X className="size-3.5" />
                      </button>
                    </span>
                  )}
                  <Button size="sm" className="self-start" icon={<FolderOpen className="size-3.5" />} onClick={() => setPicker(true)}>
                    {doc ? "Choisir un autre cours" : "Choisir un cours dans Drive"}
                  </Button>
                </>
              )}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Titre" hint={tab === "manual" ? undefined : "Optionnel."}>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="ex. Ch. 7 · Liens sociaux" />
            </Field>
            <Field label="Matière" hint="Optionnel.">
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={60} placeholder="ex. SES" />
            </Field>
          </div>
          {tab !== "manual" && (
            <Field label="Partie à prendre" hint="Optionnel, pour un cours : « activités 1 à 4 », « partie II ».">
              <Input value={focus} onChange={(e) => setFocus(e.target.value)} maxLength={300} />
            </Field>
          )}
        </div>
      </Dialog>
      <DrivePicker open={open && picker} onClose={() => setPicker(false)} initial={doc ? [doc] : []} max={1} onConfirm={(d) => setDoc(d[0] ?? null)} title="Cours" confirmLabel="Choisir" />
    </>
  );
}
