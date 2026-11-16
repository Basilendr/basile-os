"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Camera, ClipboardPaste, FileText, FolderOpen, Keyboard, Languages, Layers, Loader2, Plus, Sparkles, X } from "lucide-react";
import { api } from "@/lib/client/api";
import { cn, plural } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/tabs";
import { Badge, Card, EmptyState, ErrorState, PageHeader, Progress, Skeleton } from "@/components/ui/misc";
import { DrivePicker, type PickedDoc } from "@/components/quiz/drive-picker";
import { LANG_OPTIONS, langFlag, langLabel, shrinkImage, useRun, type DeckSummary, type VocabOverview } from "./shared";

export function useVocab() {
  return useQuery({
    queryKey: ["vocab"],
    queryFn: () => api.get<VocabOverview>("/api/flashcards"),
    refetchInterval: (q) => (q.state.data?.decks.some((d) => d.status === "generating" || d.guide === "generating") ? 3000 : 60_000),
  });
}

const SOURCE: Record<string, string> = { drive: "Drive", scan: "Photo", text: "Texte collé", manual: "Saisi à la main" };

/** Vocabulaire des langues vivantes : paquets de cartes et révision du jour. */
export function VocabView() {
  const { data: o, error, refetch } = useVocab();
  const [creating, setCreating] = useState(false);

  return (
    <div className="mx-auto max-w-[1180px] px-1 pt-1 pb-10 md:px-3 md:pt-2">
      <PageHeader
        title="Vocabulaire"
        description="Tes cours de langue en cartes : l'IA trouve le lexique à apprendre, tu révises un peu chaque jour."
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
              <p className="min-w-0 flex-1 text-[13px]">Ajoute une clé d'IA dans les paramètres pour que tes cours soient lus automatiquement. La saisie à la main fonctionne sans.</p>
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
                icon={<Languages className="size-5" />}
                title="Aucun paquet de vocabulaire"
                description="Prends en photo ta liste de vocabulaire, choisis un cours dans Drive, colle un texte ou tape tes mots : les cartes sont prêtes en quelques secondes."
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

function TodayCard({ o }: { o: VocabOverview }) {
  const t = o.totals;
  const todo = t.due + Math.min(t.fresh, 20);
  return (
    <Card className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="t-meta">Aujourd'hui</p>
        <p className="mt-1 text-[15px] font-semibold">
          {t.due > 0 ? `${plural(t.due, "mot à revoir", "mots à revoir")}` : "Aucun mot à revoir"}
          {t.fresh > 0 ? ` · ${plural(t.fresh, "nouveau mot", "nouveaux mots")}` : ""}
        </p>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center sm:max-w-[420px]">
          <Stat value={t.studiedToday} label="révisés aujourd'hui" />
          <Stat value={t.mastered} label="mots sus" />
          <Stat value={t.total} label="mots en tout" />
        </div>
      </div>
      <Link href="/vocabulaire/study?mode=cards" className={cn("sm:w-[220px]", !todo && "pointer-events-none")}>
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

function DeckTile({ d }: { d: DeckSummary }) {
  const pct = d.total ? Math.round((d.mastered / d.total) * 100) : 0;
  return (
    <Link href={`/vocabulaire/${d.id}`} className="focus-ring surface flex min-w-0 flex-col gap-3 rounded-[18px] p-4 transition-colors hover:bg-bg-2 active:scale-[0.99]">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-raised text-[20px]" aria-hidden>
          {langFlag(d.lang)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold">{d.title || (d.status === "generating" ? "Lecture du cours…" : "Sans titre")}</p>
          <p className="t-meta truncate">
            {langLabel(d.lang)} · {SOURCE[d.source] ?? d.source}
          </p>
        </div>
      </div>
      {d.status === "generating" ? (
        <p className="flex items-center gap-2 text-[13px] text-fg-2">
          <Loader2 className="size-3.5 animate-spin" />
          L'IA prépare les cartes…
        </p>
      ) : d.status === "error" ? (
        <p className="line-clamp-2 text-[13px] text-danger">{d.error ?? "Erreur"}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge>{plural(d.total, "mot", "mots")}</Badge>
            {d.due > 0 && <Badge tone="warning">{d.due} à revoir</Badge>}
            {d.fresh > 0 && <Badge tone="accent">{d.fresh} nouveaux</Badge>}
          </div>
          <div>
            <Progress value={pct} color="var(--success)" />
            <p className="t-meta mt-1">{pct} % sus</p>
          </div>
        </>
      )}
    </Link>
  );
}

/** Méthode pour apprendre un cours de langue, affichée en bas de page. */
function Method() {
  const steps = [
    { t: "Comprendre", d: "Lis la fiche du cours : le résumé en français, puis les phrases clés traduites." },
    { t: "Écouter et répéter", d: "Écoute chaque phrase et chaque mot, répète à voix haute (bouton haut-parleur, version lente)." },
    { t: "Mémoriser", d: "Quelques minutes de cartes par jour : les mots oubliés reviennent vite, les mots sus de plus en plus tard." },
    { t: "Produire", d: "Mode « Écrire » (français → langue) et questions d'oral : c'est ce qui fixe vraiment le vocabulaire." },
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

type Tab = "scan" | "drive" | "text" | "manual";

function CreateDeck({ open, onClose, ready }: { open: boolean; onClose: () => void; ready?: VocabOverview["ready"] }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { busy, run } = useRun();
  const [tab, setTab] = useState<Tab>("scan");
  const [lang, setLang] = useState("");
  const [focus, setFocus] = useState("");
  const [title, setTitle] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [doc, setDoc] = useState<PickedDoc | null>(null);
  const [picker, setPicker] = useState(false);
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const reset = () => {
    setPhotos([]);
    setDoc(null);
    setText("");
    setFocus("");
    setTitle("");
  };
  const done = async (id: string, query = "") => {
    await qc.invalidateQueries({ queryKey: ["vocab"] });
    reset();
    onClose();
    router.push(`/vocabulaire/${id}${query}`);
  };

  const canSubmit = tab === "scan" ? photos.length > 0 : tab === "drive" ? !!doc : tab === "text" ? text.trim().length >= 10 : !!title.trim() && !!lang;
  const submit = () =>
    run(
      "create",
      async () => {
        if (tab === "scan") {
          const form = new FormData();
          let size = 0;
          for (const p of photos) {
            const f = await shrinkImage(p);
            size += f.size;
            form.append("file", f, f.name);
          }
          if (size > 4.2 * 1024 * 1024) throw new Error("Les fichiers sont trop lourds pour un seul envoi (4 Mo) : envoie moins de pages à la fois.");
          if (lang) form.append("lang", lang);
          if (focus.trim()) form.append("focus", focus.trim());
          if (title.trim()) form.append("title", title.trim());
          const res = await fetch("/api/flashcards/scan", { method: "POST", body: form, credentials: "same-origin" });
          const data = await res.json().catch(() => null);
          if (!res.ok) throw new Error(data?.error?.message ?? `Erreur ${res.status}`);
          await done(data.id);
        } else if (tab === "drive") {
          const r = await api.post<{ id: string }>("/api/flashcards", { source: "drive", doc, focus: focus.trim() || undefined, lang: lang || undefined });
          await done(r.id);
        } else if (tab === "text") {
          const r = await api.post<{ id: string }>("/api/flashcards", { source: "text", text, title: title.trim() || undefined, focus: focus.trim() || undefined, lang: lang || undefined });
          await done(r.id);
        } else {
          const r = await api.post<{ id: string }>("/api/flashcards", { source: "manual", title: title.trim(), lang });
          await done(r.id, "?tab=words");
        }
      },
      "Paquet non créé",
    );

  const needAi = tab !== "manual" && ready && !ready.ai;
  return (
    <>
      <Dialog
        open={open && !picker}
        onClose={onClose}
        title="Nouveau paquet de vocabulaire"
        description="L'IA lit ton cours, repère le lexique à apprendre et prépare les cartes et la fiche du cours."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              Annuler
            </Button>
            <Button variant="primary" icon={tab === "manual" ? <Plus className="size-3.5" /> : <Sparkles className="size-3.5" />} disabled={!canSubmit || !!needAi} loading={busy === "create"} onClick={submit}>
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
                { value: "scan", label: "Photo", icon: <Camera className="size-3.5" /> },
                { value: "drive", label: "Drive", icon: <FolderOpen className="size-3.5" /> },
                { value: "text", label: "Coller", icon: <ClipboardPaste className="size-3.5" /> },
                { value: "manual", label: "À la main", icon: <Keyboard className="size-3.5" /> },
              ]}
            />
          </div>

          {needAi && <p className="rounded-[10px] bg-raised px-3 py-2 text-[13px] text-fg-2">L'IA n'est pas configurée : seule la saisie à la main est possible.</p>}

          {tab === "scan" && (
            <div className="flex flex-col gap-2">
              <p className="text-[13px] text-fg-2">Prends en photo ta liste de vocabulaire, une page de cahier ou de manuel (jusqu'à 8 pages, ou un PDF).</p>
              <input
                ref={input}
                type="file"
                accept="image/*,application/pdf"
                multiple
                className="hidden"
                onChange={(e) => {
                  const list = [...(e.target.files ?? [])];
                  setPhotos((p) => [...p, ...list].slice(0, 8));
                  e.target.value = "";
                }}
              />
              <div className="flex flex-wrap gap-2">
                {photos.map((p, i) => (
                  <Thumb key={`${p.name}-${i}`} file={p} onRemove={() => setPhotos(photos.filter((_, k) => k !== i))} />
                ))}
                {photos.length < 8 && (
                  <button
                    type="button"
                    onClick={() => input.current?.click()}
                    className="focus-ring grid size-24 place-items-center rounded-[14px] border border-dashed border-line text-fg-3 transition-colors hover:border-fg-3 hover:text-fg active:scale-95"
                  >
                    <span className="flex flex-col items-center gap-1 px-1 text-center text-[12px] leading-tight">
                      <Camera className="size-5" />
                      {photos.length ? "Ajouter" : "Photo ou fichier"}
                    </span>
                  </button>
                )}
              </div>
            </div>
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

          {tab === "text" && (
            <Field label="Texte ou liste de mots" hint="Une liste « mot = traduction » (une paire par ligne) devient directement des cartes ; un texte est analysé par l'IA.">
              <Textarea rows={7} value={text} onChange={(e) => setText(e.target.value)} placeholder={"la ciudad = la ville\nel ayuntamiento = la mairie\n…\n\nou colle le texte de ton cours"} maxLength={60_000} className="min-h-[150px]" />
            </Field>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Langue" hint={tab === "manual" ? undefined : "Laisse « Détecter » si tu n'es pas sûr."}>
              <Select value={lang} onChange={(e) => setLang(e.target.value)}>
                <option value="">{tab === "manual" ? "Choisir…" : "Détecter automatiquement"}</option>
                {LANG_OPTIONS.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Titre" hint={tab === "manual" ? undefined : "Optionnel — sinon l'IA en propose un."}>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder={tab === "manual" ? "ex. Unité 3 — la ville" : ""} />
            </Field>
          </div>
          {(tab === "drive" || tab === "scan" || tab === "text") && (
            <Field label="Partie à prendre" hint="Optionnel — ex. « seulement le lexique de la page 2 », « le texte sur Madrid ».">
              <Input value={focus} onChange={(e) => setFocus(e.target.value)} maxLength={300} />
            </Field>
          )}
        </div>
      </Dialog>
      <DrivePicker open={open && picker} onClose={() => setPicker(false)} initial={doc ? [doc] : []} max={1} onConfirm={(d) => setDoc(d[0] ?? null)} title="Cours de langue" confirmLabel="Choisir" />
    </>
  );
}

function Thumb({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [url] = useState(() => (file.type.startsWith("image/") ? URL.createObjectURL(file) : null));
  return (
    <div className="relative size-24 overflow-hidden rounded-[14px] border border-line bg-raised">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={file.name} className="size-full object-cover" />
      ) : (
        <div className="grid size-full place-items-center p-2 text-center">
          <FileText className="size-5 text-fg-3" />
          <span className="t-meta line-clamp-2 break-all">{file.name}</span>
        </div>
      )}
      <button type="button" onClick={onRemove} className="absolute top-1 right-1 grid size-6 place-items-center rounded-full bg-black/60 text-white" aria-label={`Retirer ${file.name}`}>
        <X className="size-3.5" />
      </button>
    </div>
  );
}
