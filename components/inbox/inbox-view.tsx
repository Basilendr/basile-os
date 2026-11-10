"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { Inbox, Star, Mail, Send, FileEdit, Archive, AlertOctagon, Search, PenSquare, Paperclip, RefreshCw, Lightbulb, SlidersHorizontal, Bookmark, CircleDot, Plug, GraduationCap, AtSign, ArrowLeft, Paperclip as Clip } from "lucide-react";
import { api, qs } from "@/lib/client/api";
import { cn, relativeTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, EmptyState, ErrorState, Skeleton, Badge } from "@/components/ui/misc";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useStatus } from "@/hooks/use-status";
import { Segmented } from "@/components/ui/tabs";
import type { SchoolMessage, SchoolSummary } from "@/types";
import { MessageReader, EmailFrame, buildSrcDoc } from "./message-reader";
import { MailBox, useMailAccount } from "./mail-box";
import { Composer, type ComposeInit } from "./composer";

export type EmailRow = {
  gmailId: string;
  threadId: string;
  fromName: string | null;
  fromEmail: string | null;
  to: string;
  subject: string;
  snippet: string;
  internalDate: string;
  labelIds: string[];
  isUnread: boolean;
  isStarred: boolean;
  isImportant: boolean;
  hasAttachments: boolean;
  aiCategory: string | null;
  aiReason: string | null;
};

const FOLDERS = [
  { id: "primary", label: "Principaux", icon: <Inbox /> },
  { id: "unread", label: "Non lus", icon: <CircleDot /> },
  { id: "starred", label: "Favoris", icon: <Star /> },
  { id: "important", label: "Importants", icon: <Bookmark /> },
  { id: "sent", label: "Envoyés", icon: <Send /> },
  { id: "drafts", label: "Brouillons", icon: <FileEdit /> },
  { id: "archived", label: "Archivés", icon: <Archive /> },
  { id: "spam", label: "Spam", icon: <AlertOctagon /> },
];

export const CATEGORY_LABELS: Record<string, { label: string; tone: "danger" | "warning" | "accent" | "violet" | "success" | "neutral" }> = {
  important: { label: "Important", tone: "danger" },
  reply: { label: "Nécessite une réponse", tone: "warning" },
  personal: { label: "Personnel", tone: "violet" },
  work: { label: "Professionnel", tone: "accent" },
  invoice: { label: "Facture", tone: "success" },
  confirmation: { label: "Confirmation", tone: "neutral" },
  newsletter: { label: "Newsletter", tone: "neutral" },
  info: { label: "Information", tone: "neutral" },
};

/** Messagerie : deux boîtes, Gmail et École Directe, avec la même mise en page. */
export function InboxView() {
  const sp = useSearchParams();
  const router = useRouter();
  const box = sp.get("box") === "school" ? "school" : sp.get("box") === "mail" ? "mail" : "gmail";
  const { data: summary } = useQuery({ queryKey: ["school", "summary"], queryFn: () => api.get<SchoolSummary>("/api/school/summary"), staleTime: 60_000 });
  const { data: mailAccount } = useMailAccount();
  const { data: mail } = useQuery({ queryKey: ["mail", "messages"], queryFn: () => api.get<{ unread: number }>("/api/mail/messages"), enabled: !!mailAccount && mailAccount.status !== "disconnected", staleTime: 60_000 });
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3 pt-1">
        <h1 className="t-title text-[20px]">Messagerie</h1>
        <Segmented
          value={box}
          onChange={(v) => router.replace(`/inbox?box=${v}`, { scroll: false })}
          options={[
            { value: "gmail", label: "Gmail", icon: <Mail /> },
            { value: "mail", label: "Autre adresse", icon: <AtSign />, count: mail?.unread || undefined },
            { value: "school", label: "École Directe", icon: <GraduationCap />, count: summary?.unreadMessages || undefined },
          ]}
        />
      </div>
      <div className="surface flex min-h-0 flex-1 overflow-hidden">{box === "school" ? <SchoolBox /> : box === "mail" ? <MailBox /> : <GmailBox />}</div>
    </div>
  );
}

function GmailBox() {
  const sp = useSearchParams();
  const router = useRouter();
  const { data: status } = useStatus();
  const folder = sp.get("folder") || "primary";
  const q = sp.get("q") || "";
  const messageId = sp.get("message");
  const [search, setSearch] = useState(q);
  const [category, setCategory] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [compose, setCompose] = useState<ComposeInit | null>(sp.get("compose") ? {} : null);
  const [classifying, setClassifying] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();
  const connected = status?.google.services.gmail.status === "connected";

  const list = useInfiniteQuery({
    queryKey: ["gmail", folder, q],
    queryFn: ({ pageParam }) => api.get<{ items: EmailRow[]; nextPageToken: string | null }>(`/api/gmail/messages${qs({ folder, q, pageToken: pageParam || undefined })}`),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextPageToken ?? undefined,
    enabled: connected,
  });
  const rows = useMemo(() => {
    const all = list.data?.pages.flatMap((p) => p.items) ?? [];
    return category ? all.filter((m) => m.aiCategory === category) : all;
  }, [list.data, category]);

  const set = (k: string, v: string | null) => {
    const p = new URLSearchParams(sp.toString());
    if (v) p.set(k, v);
    else p.delete(k);
    if (k !== "message") p.delete("message");
    p.set("box", "gmail");
    router.replace(`/inbox?${p}`, { scroll: false });
  };

  if (status && !connected)
    return (
      <EmptyState
        className="m-auto"
        icon={<Plug className="size-5" />}
        title="Gmail n'est pas connecté"
        description={status.google.configured ? "Connecte ton compte Google pour afficher ta boîte de réception. Aucun email n'est affiché ni simulé tant que la connexion n'a pas réussi." : "La connexion Google n'est pas encore configurée : colle l'ID client OAuth dans Paramètres → Configuration."}
        action={
          <Link href={status.google.configured ? "/api/integrations/google/connect?services=gmail" : "/settings?s=config"}>
            <Button variant="primary">{status.google.configured ? "Connecter Gmail" : "Ouvrir la configuration"}</Button>
          </Link>
        }
      />
    );

  return (
    <div className="flex min-h-0 w-full">
      <aside className="hidden w-[210px] shrink-0 flex-col gap-0.5 border-r border-line-soft p-3 lg:flex">
        <Button variant="primary" className="mb-3 justify-center" icon={<PenSquare className="size-4" />} onClick={() => setCompose({})}>
          Rédiger
        </Button>
        {FOLDERS.map((f) => (
          <button key={f.id} onClick={() => set("folder", f.id)} className={cn("flex h-8 items-center gap-2.5 rounded-[8px] px-2.5 text-[13px] [&>svg]:size-4", folder === f.id ? "bg-raised text-fg [&>svg]:text-accent" : "text-fg-2 hover:bg-raised/50 [&>svg]:text-fg-3")}>
            {f.icon}
            {f.label}
          </button>
        ))}
        <p className="t-label mt-4 mb-1 px-2.5">Boîte intelligente</p>
        {Object.entries(CATEGORY_LABELS).map(([k, c]) => (
          <button key={k} onClick={() => setCategory(category === k ? null : k)} className={cn("flex h-7 items-center gap-2 rounded-[7px] px-2.5 text-[12.5px]", category === k ? "bg-raised text-fg" : "text-fg-3 hover:text-fg-2")}>
            <span className="size-1.5 rounded-full bg-current" />
            {c.label}
          </button>
        ))}
      </aside>

      <section className={cn("flex w-full min-w-0 flex-col border-r border-line-soft md:w-[400px] md:shrink-0 xl:w-[440px]", messageId && "hidden md:flex")}>
        <div className="flex flex-col gap-2 border-b border-line-soft p-3">
          <div className="flex gap-2 lg:hidden">
            <select value={folder} onChange={(e) => set("folder", e.target.value)} className="h-8 flex-1 rounded-[8px] border border-line bg-bg-2 px-2 text-[13px]" aria-label="Dossier">
              {FOLDERS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
            <Button size="sm" variant="primary" icon={<PenSquare className="size-3.5" />} onClick={() => setCompose({})}>
              Rédiger
            </Button>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              set("q", search.trim() || null);
            }}
            className="relative flex gap-1.5"
          >
            <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-fg-3" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher (from:, subject:, has:attachment…)" className="pl-8" />
            <Button size="icon" variant="ghost" onClick={() => setFiltersOpen(true)} aria-label="Filtres avancés">
              <SlidersHorizontal className="size-4" />
            </Button>
          </form>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" icon={<RefreshCw className={list.isFetching ? "size-3.5 animate-spin" : "size-3.5"} />} onClick={() => list.refetch()}>
              Actualiser
            </Button>
            <Button
              size="sm"
              variant="ghost"
              loading={classifying}
              icon={<Lightbulb className="size-3.5 text-fg-3" />}
              disabled={!status?.ai.configured}
              title={status?.ai.configured ? "Classer les emails récents avec l'IA" : "IA non configurée"}
              onClick={async () => {
                setClassifying(true);
                try {
                  const r = await api.post<{ classified: number }>("/api/ai/classify-emails", { ids: rows.slice(0, 30).map((m) => m.gmailId) });
                  toast({ kind: "success", title: `${r.classified} emails classés`, description: "Aucun email n'a été déplacé ni archivé." });
                  qc.invalidateQueries({ queryKey: ["gmail"] });
                } catch (e) {
                  toast({ kind: "error", title: "Classement impossible", description: (e as Error).message });
                } finally {
                  setClassifying(false);
                }
              }}
            >
              Classer
            </Button>
            {q && (
              <Badge tone="accent" className="ml-auto max-w-[45%] truncate">
                {q}
              </Badge>
            )}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {list.error ? (
            <ErrorState error={list.error} onRetry={() => list.refetch()} />
          ) : list.isLoading ? (
            [0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="m-3 h-14" />)
          ) : rows.length === 0 ? (
            <EmptyState icon={<Mail className="size-5" />} title="Aucun message" description={category ? "Aucun email dans cette catégorie (lance « Classer »)." : "Rien ici."} />
          ) : (
            <>
              {rows.map((m) => (
                <Row key={m.gmailId} m={m} active={m.gmailId === messageId} onOpen={() => set("message", m.gmailId)} />
              ))}
              {list.hasNextPage && (
                <div className="p-3">
                  <Button className="w-full justify-center" variant="ghost" loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
                    Charger plus
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      <section className={cn("min-w-0 flex-1 overflow-y-auto", !messageId && "hidden md:block")}>
        {messageId ? (
          <MessageReader key={messageId} id={messageId} onBack={() => set("message", null)} onCompose={setCompose} />
        ) : (
          <EmptyState className="h-full" icon={<Mail className="size-5" />} title="Sélectionne un email" description="Résumé, réponse, extraction de tâches et de dates sont disponibles dans le lecteur." />
        )}
      </section>

      {compose && <Composer init={compose} onClose={() => setCompose(null)} />}
      <AdvancedFilters open={filtersOpen} onClose={() => setFiltersOpen(false)} onApply={(qq) => (setSearch(qq), set("q", qq || null), setFiltersOpen(false))} />
    </div>
  );
}

function Row({ m, active, onOpen }: { m: EmailRow; active: boolean; onOpen: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const star = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.post(`/api/gmail/messages/${m.gmailId}`, { action: m.isStarred ? "unstar" : "star" });
      qc.invalidateQueries({ queryKey: ["gmail"] });
    } catch (err) {
      toast({ kind: "error", title: "Action impossible", description: (err as Error).message });
    }
  };
  const userLabels = m.labelIds.filter((l) => l.startsWith("Label_"));
  const cat = m.aiCategory ? CATEGORY_LABELS[m.aiCategory] : null;
  return (
    <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => e.key === "Enter" && onOpen()} className={cn("focus-ring flex cursor-pointer gap-3 border-b border-line-soft px-3 py-3 transition-colors", active ? "bg-raised" : "hover:bg-raised/40")}>
      <Avatar name={m.fromName || m.fromEmail || "?"} size={32} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn("truncate text-[13.5px]", m.isUnread ? "font-semibold text-fg" : "text-fg-2")}>{m.fromName || m.fromEmail}</span>
          {m.isImportant && <Bookmark className="size-3 shrink-0 fill-warning text-warning" aria-label="Important" />}
          <span className="t-meta ml-auto shrink-0">{relativeTime(m.internalDate)}</span>
        </div>
        <div className={cn("truncate text-[13px]", m.isUnread ? "font-medium text-fg" : "text-fg-2")}>{m.subject || "(sans objet)"}</div>
        <div className="t-meta truncate">{m.snippet}</div>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {cat && (
            <span title={m.aiReason ?? ""}>
              <Badge tone={cat.tone}>{cat.label}</Badge>
            </span>
          )}
          {userLabels.length > 0 && <Badge>{userLabels.length} libellé{userLabels.length > 1 ? "s" : ""}</Badge>}
          {m.hasAttachments && <Paperclip className="size-3 text-fg-3" aria-label="Pièce jointe" />}
        </div>
      </div>
      <button onClick={star} className="self-start p-0.5" aria-label={m.isStarred ? "Retirer l'étoile" : "Ajouter une étoile"}>
        <Star className={cn("size-4", m.isStarred ? "fill-warning text-warning" : "text-fg-3 hover:text-fg-2")} />
      </button>
    </div>
  );
}

function AdvancedFilters({ open, onClose, onApply }: { open: boolean; onClose: () => void; onApply: (q: string) => void }) {
  const [f, setF] = useState({ from: "", to: "", subject: "", words: "", after: "", before: "", label: "", attachment: false, unread: false });
  const build = () =>
    [
      f.from && `from:${f.from}`,
      f.to && `to:${f.to}`,
      f.subject && `subject:(${f.subject})`,
      f.words,
      f.after && `after:${f.after.replace(/-/g, "/")}`,
      f.before && `before:${f.before.replace(/-/g, "/")}`,
      f.label && `label:${f.label.replace(/\s+/g, "-")}`,
      f.attachment && "has:attachment",
      f.unread && "is:unread",
    ]
      .filter(Boolean)
      .join(" ");
  return (
    <Dialog open={open} onClose={onClose} title="Recherche avancée" description="Construit une requête Gmail native." footer={<Button variant="primary" onClick={() => onApply(build())}>Rechercher</Button>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Expéditeur">
          <Input value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} placeholder="nom@exemple.com" />
        </Field>
        <Field label="Destinataire">
          <Input value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
        </Field>
        <Field label="Objet">
          <Input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} />
        </Field>
        <Field label="Mots-clés">
          <Input value={f.words} onChange={(e) => setF({ ...f, words: e.target.value })} />
        </Field>
        <Field label="Après le">
          <Input type="date" value={f.after} onChange={(e) => setF({ ...f, after: e.target.value })} />
        </Field>
        <Field label="Avant le">
          <Input type="date" value={f.before} onChange={(e) => setF({ ...f, before: e.target.value })} />
        </Field>
        <Field label="Libellé">
          <Input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} />
        </Field>
        <div className="flex flex-col justify-end gap-2 text-[13px]">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={f.attachment} onChange={(e) => setF({ ...f, attachment: e.target.checked })} /> Avec pièce jointe
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={f.unread} onChange={(e) => setF({ ...f, unread: e.target.checked })} /> Non lus uniquement
          </label>
        </div>
      </div>
      <p className="t-meta mt-3 font-mono">{build() || "—"}</p>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ boîte École Directe */

type SchoolRow = Pick<SchoolMessage, "id" | "subject" | "fromName" | "date" | "read">;

function SchoolBox() {
  const sp = useSearchParams();
  const router = useRouter();
  const id = sp.get("message");
  const [q, setQ] = useState("");
  const { data: summary } = useQuery({ queryKey: ["school", "summary"], queryFn: () => api.get<SchoolSummary>("/api/school/summary") });
  const list = useQuery({ queryKey: ["school", "messages"], queryFn: () => api.get<{ items: SchoolRow[] }>("/api/school/messages") });
  const open = (mid: string | null) => router.replace(`/inbox?box=school${mid ? `&message=${mid}` : ""}`, { scroll: false });
  const rows = (list.data?.items ?? []).filter((m) => !q || `${m.subject} ${m.fromName ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  const account = summary?.account;

  if (account?.status === "disconnected" && list.data && list.data.items.length === 0)
    return (
      <EmptyState
        className="m-auto"
        icon={<GraduationCap className="size-5" />}
        title="École Directe n'est pas connecté"
        description="Connecte ton compte pour recevoir ici les messages de l'établissement et des professeurs. Rien n'est affiché tant que la connexion n'a pas réussi."
        action={
          <Link href="/integrations#ecoledirecte">
            <Button variant="primary">Connecter École Directe</Button>
          </Link>
        }
      />
    );

  return (
    <div className="flex min-h-0 w-full">
      <section className={cn("flex w-full min-w-0 flex-col border-r border-line-soft md:w-[400px] md:shrink-0 xl:w-[440px]", id && "hidden md:flex")}>
        <div className="flex flex-col gap-2 border-b border-line-soft p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-fg-3" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrer par objet ou expéditeur" className="pl-8" aria-label="Filtrer les messages" />
          </div>
          <p className="t-meta px-1">
            {account && account.status !== "disconnected" && account.lastSyncAt ? `Synchronisé ${relativeTime(account.lastSyncAt)}` : "Messages reçus sur École Directe"}
            {account && account.status !== "disconnected" && account.status !== "connected" && " · connexion à vérifier"}
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {list.error ? (
            <ErrorState error={list.error} onRetry={() => list.refetch()} />
          ) : !list.data ? (
            [0, 1, 2, 3].map((i) => <Skeleton key={i} className="m-3 h-14" />)
          ) : rows.length === 0 ? (
            <EmptyState icon={<Mail className="size-5" />} title="Aucun message" description={q ? "Aucun message ne correspond." : "La prochaine synchronisation importera les nouveaux messages."} />
          ) : (
            rows.map((m) => (
              <button key={m.id} onClick={() => open(m.id)} className={cn("focus-ring flex w-full gap-3 border-b border-line-soft px-3 py-3 text-left transition-colors", m.id === id ? "bg-raised" : "hover:bg-raised/40")}>
                <Avatar name={m.fromName || "?"} size={32} className="mt-0.5" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className={cn("truncate text-[13.5px]", !m.read ? "font-semibold text-fg" : "text-fg-2")}>{m.fromName || "Établissement"}</span>
                    {!m.read && <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-label="Non lu" />}
                    <span className="t-meta ml-auto shrink-0">{relativeTime(m.date)}</span>
                  </span>
                  <span className={cn("block truncate text-[13px]", !m.read ? "font-medium text-fg" : "text-fg-2")}>{m.subject || "(sans objet)"}</span>
                </span>
              </button>
            ))
          )}
        </div>
      </section>
      <section className={cn("min-w-0 flex-1 overflow-y-auto", !id && "hidden md:block")}>
        {id ? <SchoolReader key={id} id={id} onBack={() => open(null)} /> : <EmptyState className="h-full" icon={<GraduationCap className="size-5" />} title="Sélectionne un message" description="Le contenu est chargé depuis École Directe et affiché dans un cadre isolé." />}
      </section>
    </div>
  );
}

function SchoolReader({ id, onBack }: { id: string; onBack: () => void }) {
  const qc = useQueryClient();
  const { data: m, error, refetch } = useQuery({
    queryKey: ["school", "message", id],
    queryFn: async () => {
      const r = await api.get<SchoolMessage>(`/api/school/messages/${id}`);
      qc.invalidateQueries({ queryKey: ["school", "messages"] });
      qc.invalidateQueries({ queryKey: ["school", "summary"] });
      return r;
    },
  });
  if (error) return <ErrorState error={error} onRetry={() => refetch()} className="py-20" />;
  if (!m)
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-40" />
      </div>
    );
  return (
    <div className="mx-auto max-w-[900px] px-4 py-4 md:px-6">
      <Button size="sm" variant="ghost" className="mb-2 md:hidden" icon={<ArrowLeft className="size-3.5" />} onClick={onBack}>
        Retour
      </Button>
      <h2 className="text-[20px] font-semibold tracking-[-0.02em]">{m.subject || "(sans objet)"}</h2>
      <div className="mt-3 mb-4 flex items-center gap-3">
        <Avatar name={m.fromName || "?"} size={36} />
        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-medium">{m.fromName || "Établissement"}</p>
          <p className="t-meta">{new Date(m.date).toLocaleString("fr-FR", { dateStyle: "full", timeStyle: "short" })} · École Directe</p>
        </div>
      </div>
      <EmailFrame srcDoc={buildSrcDoc(m.contentHtml || "<p style='color:#86868b'>Message vide.</p>", false)} />
      {m.files.length > 0 && (
        <div className="mt-3">
          <p className="t-meta mb-1.5">Pièces jointes (à ouvrir sur École Directe)</p>
          <div className="flex flex-wrap gap-1.5">
            {m.files.map((f) => (
              <Badge key={f.id}>
                <Clip className="size-3" />
                {f.name}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
