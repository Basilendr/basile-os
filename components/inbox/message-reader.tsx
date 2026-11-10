"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Reply, ReplyAll, Forward, Archive, Trash2, MailOpen, Mail, Star, Tag, Lightbulb, Paperclip, ImageOff, Download, CheckSquare, ListChecks, CalendarSearch, Languages, Info, FileText, BookmarkPlus } from "lucide-react";
import { api } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Menu } from "@/components/ui/menu";
import { Avatar, Badge, Skeleton, ErrorState } from "@/components/ui/misc";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/input";
import { Markdown } from "@/components/assistant/markdown";
import { useToast } from "@/components/ui/toast";
import { useUI } from "@/components/shell/ui-context";
import type { ComposeInit } from "./composer";

type Msg = {
  id: string;
  threadId: string;
  fromName: string | null;
  fromEmail: string | null;
  to: string;
  cc: string;
  subject: string;
  date: string;
  replyTo: string;
  messageIdHeader: string;
  references: string;
  textBody: string;
  htmlBody: string;
  labelIds: string[];
  isUnread: boolean;
  isStarred: boolean;
  attachments: { id: string; filename: string; mimeType: string; size: number }[];
  aiCategory: string | null;
  aiReason: string | null;
};
type Label = { id: string; name: string; type: string };
type AiResult = { action: string; text?: string; items?: { title: string; detail?: string; dueDate?: string | null; priority?: string }[] };

const AI_ACTIONS: { id: string; label: string; icon: React.ReactNode }[] = [
  { id: "summarize", label: "Résumer", icon: <FileText /> },
  { id: "explain", label: "Expliquer", icon: <Info /> },
  { id: "reply", label: "Préparer une réponse", icon: <Reply /> },
  { id: "translate", label: "Traduire", icon: <Languages /> },
  { id: "extract_actions", label: "Extraire les tâches", icon: <ListChecks /> },
  { id: "extract_dates", label: "Extraire les dates", icon: <CalendarSearch /> },
  { id: "key_info", label: "Informations importantes", icon: <Lightbulb /> },
];

function htmlToText(html: string) {
  return html.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|tr|h\d)>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\n{3,}/g, "\n\n").trim();
}

export function MessageReader({ id, onBack, onCompose }: { id: string; onBack: () => void; onCompose: (c: ComposeInit) => void }) {
  const { data: m, error, refetch } = useQuery({ queryKey: ["gmail-message", id], queryFn: () => api.get<Msg>(`/api/gmail/messages/${id}`) });
  const { data: labels } = useQuery({ queryKey: ["gmail-labels"], queryFn: () => api.get<{ labels: Label[] }>("/api/gmail/labels"), staleTime: 300_000 });
  const qc = useQueryClient();
  const { toast } = useToast();
  const { openCreate } = useUI();
  const [images, setImages] = useState(false);
  const [confirmTrash, setConfirmTrash] = useState(false);
  const [ai, setAi] = useState<AiResult | null>(null);
  const [aiLoading, setAiLoading] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const markedRead = useRef(false);

  const act = async (action: string, opts: { silent?: boolean } = {}) => {
    try {
      await api.post(`/api/gmail/messages/${id}`, { action });
      qc.invalidateQueries({ queryKey: ["gmail"] });
      qc.invalidateQueries({ queryKey: ["gmail-message", id] });
      if (!opts.silent) toast({ kind: "success", title: { archive: "Archivé", trash: "Placé dans la corbeille", read: "Marqué comme lu", unread: "Marqué comme non lu", star: "Étoile ajoutée", unstar: "Étoile retirée", important: "Marqué important", unimportant: "Importance retirée", spam: "Signalé comme spam", notspam: "Retiré du spam", unarchive: "Remis dans la boîte" }[action] ?? "OK" });
      if (action === "archive" || action === "trash" || action === "spam") onBack();
    } catch (e) {
      toast({ kind: "error", title: "Action Gmail impossible", description: (e as Error).message });
    }
  };

  useEffect(() => {
    if (m?.isUnread && !markedRead.current) {
      markedRead.current = true;
      act("read", { silent: true });
    }
  }, [m?.isUnread]); // eslint-disable-line react-hooks/exhaustive-deps

  const text = useMemo(() => (m ? m.textBody || htmlToText(m.htmlBody) : ""), [m]);

  const runAi = async (action: string) => {
    setAiLoading(action);
    try {
      const r = await api.post<AiResult>("/api/ai/transform", { action, text: `De : ${m?.fromName} <${m?.fromEmail}>\nObjet : ${m?.subject}\nDate : ${m?.date}\n\n${text}`.slice(0, 100_000), title: m?.subject });
      if (action === "reply" && r.text) {
        onCompose(replyInit(m!, false, r.text));
        return;
      }
      setAi(r);
      setPicked(new Set(r.items?.map((_, i) => i) ?? []));
    } catch (e) {
      toast({ kind: "error", title: "Assistant email indisponible", description: (e as Error).message });
    } finally {
      setAiLoading(null);
    }
  };

  if (error) return <ErrorState error={error} onRetry={() => refetch()} className="py-20" />;
  if (!m)
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-40" />
      </div>
    );

  const userLabels = (labels?.labels ?? []).filter((l) => l.type === "user");
  const srcDoc = buildSrcDoc(m.htmlBody, images);

  return (
    <div className="mx-auto max-w-[900px] px-4 py-4 md:px-6">
      <div className="glass sticky top-0 z-10 -mx-1 mb-3 flex flex-wrap items-center gap-1 rounded-[10px] px-1 py-1">
        <Button size="icon-sm" variant="ghost" className="md:hidden" onClick={onBack} aria-label="Retour">
          <ArrowLeft className="size-4" />
        </Button>
        <Button size="sm" variant="ghost" icon={<Reply className="size-3.5" />} onClick={() => onCompose(replyInit(m, false))}>
          Répondre
        </Button>
        <Button size="sm" variant="ghost" icon={<ReplyAll className="size-3.5" />} onClick={() => onCompose(replyInit(m, true))}>
          <span className="hidden sm:inline">Répondre à tous</span>
        </Button>
        <Button size="sm" variant="ghost" icon={<Forward className="size-3.5" />} onClick={() => onCompose({ subject: `Tr : ${m.subject}`, body: `\n\n---------- Message transféré ----------\nDe : ${m.fromName ?? ""} <${m.fromEmail}>\nDate : ${m.date}\nObjet : ${m.subject}\n\n${text}` })}>
          <span className="hidden sm:inline">Transférer</span>
        </Button>
        <span className="mx-1 h-4 w-px bg-line" />
        <Button size="icon-sm" variant="ghost" onClick={() => act(m.labelIds.includes("INBOX") ? "archive" : "unarchive")} aria-label={m.labelIds.includes("INBOX") ? "Archiver" : "Remettre dans la boîte"} title="Archiver">
          <Archive className="size-4" />
        </Button>
        <Button size="icon-sm" variant="ghost" onClick={() => setConfirmTrash(true)} aria-label="Supprimer" title="Supprimer">
          <Trash2 className="size-4" />
        </Button>
        <Button size="icon-sm" variant="ghost" onClick={() => act(m.isUnread ? "read" : "unread")} aria-label={m.isUnread ? "Marquer comme lu" : "Marquer comme non lu"} title={m.isUnread ? "Marquer comme lu" : "Marquer comme non lu"}>
          {m.isUnread ? <MailOpen className="size-4" /> : <Mail className="size-4" />}
        </Button>
        <Button size="icon-sm" variant="ghost" onClick={() => act(m.isStarred ? "unstar" : "star")} aria-label="Étoile">
          <Star className={m.isStarred ? "size-4 fill-warning text-warning" : "size-4"} />
        </Button>
        <Menu
          trigger={({ toggle }) => (
            <Button size="icon-sm" variant="ghost" onClick={toggle} aria-label="Libellés">
              <Tag className="size-4" />
            </Button>
          )}
          items={[
            { type: "label", label: "Libellés" },
            { label: m.labelIds.includes("IMPORTANT") ? "Retirer « Important »" : "Marquer important", onSelect: () => act(m.labelIds.includes("IMPORTANT") ? "unimportant" : "important") },
            { label: m.labelIds.includes("SPAM") ? "Pas un spam" : "Signaler comme spam", onSelect: () => act(m.labelIds.includes("SPAM") ? "notspam" : "spam") },
            ...(userLabels.length ? [{ type: "separator" as const }] : []),
            ...userLabels.map((l) => ({
              label: `${m.labelIds.includes(l.id) ? "✓ " : ""}${l.name}`,
              onSelect: async () => {
                const has = m.labelIds.includes(l.id);
                try {
                  await api.post(`/api/gmail/messages/${id}`, { addLabels: has ? [] : [l.id], removeLabels: has ? [l.id] : [] });
                  refetch();
                  qc.invalidateQueries({ queryKey: ["gmail"] });
                } catch (e) {
                  toast({ kind: "error", title: "Libellé non modifié", description: (e as Error).message });
                }
              },
            })),
          ]}
        />
        <span className="ml-auto" />
        <Button size="sm" variant="ghost" icon={<CheckSquare className="size-3.5" />} onClick={() => openCreate("task", { title: `Traiter : ${m.subject}`, description: `Email de ${m.fromName ?? m.fromEmail}`, sourceType: "email", sourceId: m.id })}>
          <span className="hidden sm:inline">Tâche</span>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<BookmarkPlus className="size-3.5" />}
          title="Ajouter au Second Brain"
          onClick={async () => {
            try {
              await api.post("/api/brain/items", { kind: "email", title: m.subject || "(sans objet)", content: text.slice(0, 20_000), sourceType: "email", sourceId: m.id });
              toast({ kind: "success", title: "Ajouté au Second Brain" });
            } catch (e) {
              toast({ kind: "error", title: "Impossible", description: (e as Error).message });
            }
          }}
        />
        <Menu
          trigger={({ toggle }) => (
            <Button size="sm" variant="secondary" loading={!!aiLoading} icon={<Lightbulb className="size-3.5 text-fg-3" />} onClick={toggle}>
              Outils
            </Button>
          )}
          items={AI_ACTIONS.map((a) => ({ label: a.label, icon: a.icon, onSelect: () => runAi(a.id) }))}
        />
      </div>

      <h1 className="t-title mb-3">{m.subject || "(sans objet)"}</h1>
      <div className="mb-4 flex items-start gap-3">
        <Avatar name={m.fromName || m.fromEmail || "?"} size={36} />
        <div className="min-w-0 flex-1 text-[13px]">
          <p>
            <span className="font-medium">{m.fromName}</span> <span className="text-fg-3">&lt;{m.fromEmail}&gt;</span>
          </p>
          <p className="t-meta truncate">À : {m.to}{m.cc && ` · Cc : ${m.cc}`}</p>
          <p className="t-meta">{m.date && new Date(m.date).toLocaleString("fr-FR", { dateStyle: "full", timeStyle: "short" })}</p>
        </div>
        {m.aiCategory && (
          <span title={m.aiReason ?? ""}>
            <Badge tone="accent">IA : {m.aiCategory}</Badge>
          </span>
        )}
      </div>
      {m.aiReason && <p className="t-meta -mt-2 mb-3">Classement IA : {m.aiReason}</p>}

      {m.htmlBody ? (
        <>
          {!images && /<img[^>]+src=["']?https?:/i.test(m.htmlBody) && (
            <div className="mb-2 flex items-center gap-2 rounded-[8px] border border-line-soft bg-bg-2 px-3 py-2 text-[12.5px] text-fg-2">
              <ImageOff className="size-3.5" /> Images distantes bloquées (protection du suivi).
              <button className="text-accent" onClick={() => setImages(true)}>
                Afficher les images
              </button>
            </div>
          )}
          <EmailFrame srcDoc={srcDoc} />
        </>
      ) : (
        <pre className="rounded-[10px] border border-line-soft bg-card p-4 font-sans text-[14px] leading-relaxed whitespace-pre-wrap text-fg">{m.textBody}</pre>
      )}

      {m.attachments.length > 0 && (
        <div className="mt-4">
          <p className="t-label mb-2 flex items-center gap-1.5">
            <Paperclip className="size-3" /> Pièces jointes
          </p>
          <div className="flex flex-wrap gap-2">
            {m.attachments.map((a) => (
              <a key={a.id} href={`/api/gmail/messages/${m.id}/attachments/${encodeURIComponent(a.id)}?name=${encodeURIComponent(a.filename)}&type=${encodeURIComponent(a.mimeType)}`} className="flex items-center gap-2 rounded-[8px] border border-line px-3 py-2 text-[12.5px] hover:bg-raised">
                <Download className="size-3.5 text-fg-3" />
                <span className="max-w-[200px] truncate">{a.filename}</span>
                <span className="t-meta">{Math.round(a.size / 1024)} Ko</span>
              </a>
            ))}
          </div>
        </div>
      )}

      <ConfirmDialog open={confirmTrash} onClose={() => setConfirmTrash(false)} danger title="Supprimer cet email ?" description="Il sera placé dans la corbeille Gmail (récupérable 30 jours)." confirmLabel="Supprimer" onConfirm={() => (setConfirmTrash(false), act("trash"))} />

      <Dialog
        open={!!ai}
        onClose={() => setAi(null)}
        title={AI_ACTIONS.find((a) => a.id === ai?.action)?.label ?? "Assistant email"}
        description="Analyse fondée uniquement sur le contenu de cet email."
        size="lg"
        footer={
          ai?.items &&
          ai.action !== "extract_dates" && (
            <Button
              variant="primary"
              disabled={!picked.size}
              onClick={async () => {
                const items = ai.items!.filter((_, i) => picked.has(i));
                try {
                  for (const it of items) await api.post("/api/tasks", { title: it.title, description: it.detail ?? "", dueDate: it.dueDate ?? null, priority: it.priority ?? "medium", sourceType: "email", sourceId: m.id });
                  qc.invalidateQueries({ queryKey: ["tasks"] });
                  toast({ kind: "success", title: `${items.length} tâche(s) créée(s)` });
                  setAi(null);
                } catch (e) {
                  toast({ kind: "error", title: "Création impossible", description: (e as Error).message });
                }
              }}
            >
              Créer {picked.size} tâche(s)
            </Button>
          )
        }
      >
        {ai?.text && <Markdown content={ai.text} />}
        {ai?.items?.length === 0 && <p className="t-sub">Rien trouvé dans cet email.</p>}
        {ai?.items?.map((it, i) => (
          <div key={i} className="flex items-start gap-2.5 rounded-[8px] px-2 py-2">
            {ai.action !== "extract_dates" && (
              <Checkbox
                className="mt-0.5"
                checked={picked.has(i)}
                onChange={(v) =>
                  setPicked((s) => {
                    const n = new Set(s);
                    if (v) n.add(i);
                    else n.delete(i);
                    return n;
                  })
                }
              />
            )}
            <div className="flex-1">
              <p className="text-[13.5px]">{it.title}</p>
              {it.detail && <p className="t-meta">{it.detail}</p>}
            </div>
            {ai.action === "extract_dates" && it.dueDate && (
              <Button size="sm" variant="ghost" onClick={() => (openCreate("event", { title: it.title, date: it.dueDate, endDate: it.dueDate }), setAi(null))}>
                Créer un événement
              </Button>
            )}
          </div>
        ))}
      </Dialog>
    </div>
  );
}

/**
 * Rendu HTML isolé : iframe sandbox sans scripts ni formulaires, CSP stricte,
 * images distantes bloquées par défaut, liens ouverts dans un nouvel onglet.
 */
export function buildSrcDoc(html: string, images: boolean) {
  const csp = `default-src 'none'; style-src 'unsafe-inline'; img-src data: cid: ${images ? "https: http:" : ""}; font-src data:;`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"><style>body{margin:0;padding:16px;font:14px/1.55 -apple-system,system-ui,sans-serif;color:#18181b;background:#fff;word-wrap:break-word}img{max-width:100%;height:auto}a{color:#3b5bdb}</style></head><body>${html}</body></html>`;
}

export function EmailFrame({ srcDoc }: { srcDoc: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [h, setH] = useState(400);
  return (
    <iframe
      ref={ref}
      title="Contenu de l'email"
      sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin"
      srcDoc={srcDoc}
      onLoad={() => {
        const doc = ref.current?.contentDocument;
        if (doc) setH(Math.min(4000, doc.documentElement.scrollHeight + 8));
      }}
      className="w-full rounded-[10px] border border-line-soft bg-white"
      style={{ height: h }}
    />
  );
}

function replyInit(m: Msg, all: boolean, body = ""): ComposeInit {
  const self = "basileandre1002@gmail.com";
  const to = [m.replyTo ? m.replyTo.match(/<([^>]+)>/)?.[1] ?? m.replyTo : m.fromEmail ?? ""].filter(Boolean);
  const cc = all ? [...m.to.split(","), ...m.cc.split(",")].map((x) => (x.match(/<([^>]+)>/)?.[1] ?? x).trim().toLowerCase()).filter((x) => x && x.includes("@") && x !== self && !to.includes(x)) : [];
  const quoted = (m.textBody || "").split("\n").slice(0, 40).map((l) => `> ${l}`).join("\n");
  return {
    to,
    cc,
    subject: /^re\s*:/i.test(m.subject) ? m.subject : `Re : ${m.subject}`,
    body: `${body}\n\nLe ${m.date}, ${m.fromName ?? m.fromEmail} a écrit :\n${quoted}`,
    threadId: m.threadId,
    inReplyTo: m.messageIdHeader,
    references: m.references,
  };
}
