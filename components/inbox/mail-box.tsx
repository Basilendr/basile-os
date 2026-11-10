"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, AtSign, Paperclip, PenSquare, RefreshCw, Reply, Search, Send, Unplug } from "lucide-react";
import { api } from "@/lib/client/api";
import { cn, relativeTime } from "@/lib/utils";
import { Avatar, Badge, EmptyState, ErrorState, Skeleton } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { EmailFrame, buildSrcDoc } from "./message-reader";

type Preset = { label: string; imap: [string, number, boolean]; smtp: [string, number, boolean]; note: string };
export type MailAccount =
  | { status: "disconnected"; presets: Record<string, Preset> }
  | { status: "connected" | "error"; email: string; displayName: string | null; imapHost: string; smtpHost: string; lastSyncAt: string | null; lastError: string | null; presets: Record<string, Preset> };
type Row = { id: string; subject: string; fromName: string | null; fromEmail: string | null; date: string; seen: boolean; hasAttachments: boolean };
type Full = Row & { to: string; messageId: string | null; html: string | null; text: string | null; attachments: { name: string; size: number; type: string }[] };

export function useMailAccount() {
  return useQuery({ queryKey: ["mail", "account"], queryFn: () => api.get<MailAccount>("/api/mail/account") });
}

/** Boîte « mail normal » : toute adresse IMAP/SMTP (Orange, Free, iCloud, Yahoo…). */
export function MailBox() {
  const sp = useSearchParams();
  const router = useRouter();
  const id = sp.get("message");
  const [q, setQ] = useState("");
  const [compose, setCompose] = useState<{ to?: string; subject?: string; body?: string; inReplyTo?: string } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: account } = useMailAccount();
  const list = useQuery({ queryKey: ["mail", "messages"], queryFn: () => api.get<{ items: Row[]; unread: number }>("/api/mail/messages"), enabled: account?.status === "connected" || account?.status === "error", refetchInterval: 120_000 });
  const open = (mid: string | null) => router.replace(`/inbox?box=mail${mid ? `&message=${mid}` : ""}`, { scroll: false });

  if (!account) return <Skeleton className="m-4 h-40 w-full" />;
  if (account.status === "disconnected")
    return (
      <div className="m-auto w-full max-w-[560px] overflow-y-auto p-5">
        <MailConnect account={account} />
      </div>
    );

  const rows = (list.data?.items ?? []).filter((m) => !q || `${m.subject} ${m.fromName ?? ""} ${m.fromEmail ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  const sync = async () => {
    setSyncing(true);
    try {
      const r = await api.post<{ added: number }>("/api/mail/sync");
      qc.invalidateQueries({ queryKey: ["mail"] });
      toast({ kind: "success", title: r.added ? `${r.added} nouveau${r.added > 1 ? "x" : ""} message${r.added > 1 ? "s" : ""}` : "Boîte à jour" });
    } catch (e) {
      toast({ kind: "error", title: "Synchronisation impossible", description: (e as Error).message });
      qc.invalidateQueries({ queryKey: ["mail", "account"] });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="flex min-h-0 w-full">
      <section className={cn("flex w-full min-w-0 flex-col border-r border-line-soft md:w-[400px] md:shrink-0 xl:w-[440px]", id && "hidden md:flex")}>
        <div className="flex flex-col gap-2 border-b border-line-soft p-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-fg-3" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrer par objet ou expéditeur" className="pl-8" aria-label="Filtrer les messages" />
            </div>
            <Button size="icon" variant="primary" onClick={() => setCompose({})} aria-label="Nouveau message">
              <PenSquare className="size-4" />
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <span className="t-meta flex min-w-0 items-center gap-1.5 truncate">
              <AtSign className="size-3.5 shrink-0" />
              {account.email}
              {account.lastSyncAt && ` · ${relativeTime(account.lastSyncAt)}`}
            </span>
            <Button size="sm" variant="ghost" className="ml-auto" icon={<RefreshCw className={cn("size-3.5", syncing && "animate-spin")} />} onClick={sync} disabled={syncing}>
              Actualiser
            </Button>
          </div>
          {account.lastError && <p className="rounded-[10px] bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] px-2.5 py-1.5 text-[12px] text-danger">{account.lastError}</p>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {list.error ? (
            <ErrorState error={list.error} onRetry={() => list.refetch()} />
          ) : !list.data ? (
            [0, 1, 2, 3].map((i) => <Skeleton key={i} className="m-3 h-14" />)
          ) : rows.length === 0 ? (
            <EmptyState icon={<AtSign className="size-5" />} title="Aucun message" description={q ? "Aucun message ne correspond." : "La synchronisation récupère les 60 derniers messages de la boîte de réception."} />
          ) : (
            rows.map((m) => (
              <button key={m.id} onClick={() => open(m.id)} className={cn("focus-ring flex w-full gap-3 border-b border-line-soft px-3 py-3 text-left transition-colors", m.id === id ? "bg-raised" : "hover:bg-raised/40")}>
                <Avatar name={m.fromName || m.fromEmail || "?"} size={32} className="mt-0.5" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className={cn("truncate text-[13.5px]", !m.seen ? "font-semibold text-fg" : "text-fg-2")}>{m.fromName || m.fromEmail}</span>
                    {!m.seen && <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-label="Non lu" />}
                    {m.hasAttachments && <Paperclip className="size-3 shrink-0 text-fg-3" aria-label="Pièce jointe" />}
                    <span className="t-meta ml-auto shrink-0">{relativeTime(m.date)}</span>
                  </span>
                  <span className={cn("block truncate text-[13px]", !m.seen ? "font-medium text-fg" : "text-fg-2")}>{m.subject || "(sans objet)"}</span>
                </span>
              </button>
            ))
          )}
        </div>
      </section>
      <section className={cn("min-w-0 flex-1 overflow-y-auto", !id && "hidden md:block")}>
        {id ? (
          <MailReader key={id} id={id} onBack={() => open(null)} onReply={(m) => setCompose({ to: m.fromEmail ?? "", subject: /^re\s*:/i.test(m.subject) ? m.subject : `Re : ${m.subject}`, body: `\n\n— ${m.fromName || m.fromEmail} a écrit :\n${(m.text ?? "").split("\n").slice(0, 30).map((l) => `> ${l}`).join("\n")}`, inReplyTo: m.messageId ?? undefined })} />
        ) : (
          <EmptyState className="h-full" icon={<AtSign className="size-5" />} title="Sélectionne un message" description="Le contenu est chargé depuis ton serveur de messagerie et affiché dans un cadre isolé." />
        )}
      </section>
      {compose && <MailComposer init={compose} from={account.email} onClose={() => setCompose(null)} />}
    </div>
  );
}

function MailReader({ id, onBack, onReply }: { id: string; onBack: () => void; onReply: (m: Full) => void }) {
  const qc = useQueryClient();
  const [images, setImages] = useState(false);
  const { data: m, error, refetch } = useQuery({
    queryKey: ["mail", "message", id],
    queryFn: async () => {
      const r = await api.get<Full>(`/api/mail/messages/${id}`);
      qc.invalidateQueries({ queryKey: ["mail", "messages"] });
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
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = m.html ?? `<pre style="white-space:pre-wrap;font:inherit">${esc(m.text ?? "")}</pre>`;
  return (
    <div className="mx-auto max-w-[900px] px-4 py-4 md:px-6">
      <div className="mb-3 flex flex-wrap items-center gap-1">
        <Button size="icon-sm" variant="ghost" className="md:hidden" onClick={onBack} aria-label="Retour">
          <ArrowLeft className="size-4" />
        </Button>
        <Button size="sm" variant="ghost" icon={<Reply className="size-3.5" />} onClick={() => onReply(m)} disabled={!m.fromEmail}>
          Répondre
        </Button>
        {m.html && !images && (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setImages(true)}>
            Afficher les images
          </Button>
        )}
      </div>
      <h2 className="text-[20px] font-semibold tracking-[-0.02em]">{m.subject || "(sans objet)"}</h2>
      <div className="mt-3 mb-4 flex items-center gap-3">
        <Avatar name={m.fromName || m.fromEmail || "?"} size={36} />
        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-medium">
            {m.fromName || m.fromEmail} {m.fromName && <span className="t-meta">&lt;{m.fromEmail}&gt;</span>}
          </p>
          <p className="t-meta">
            {new Date(m.date).toLocaleString("fr-FR", { dateStyle: "full", timeStyle: "short" })} · à {m.to}
          </p>
        </div>
      </div>
      <EmailFrame srcDoc={buildSrcDoc(html, images)} />
      {m.attachments.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {m.attachments.map((a, i) => (
            <Badge key={i}>
              <Paperclip className="size-3" />
              {a.name}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function MailComposer({ init, from, onClose }: { init: { to?: string; subject?: string; body?: string; inReplyTo?: string }; from: string; onClose: () => void }) {
  const [v, setV] = useState({ to: init.to ?? "", subject: init.subject ?? "", body: init.body ?? "" });
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const recipients = v.to.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
  const valid = recipients.length > 0 && recipients.every((r) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r));
  return (
    <Dialog
      open
      onClose={onClose}
      title="Nouveau message"
      description={`Envoyé depuis ${from}`}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" icon={<Send className="size-3.5" />} disabled={!valid} onClick={() => setConfirm(true)}>
            Envoyer…
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label="À" hint="Plusieurs adresses : sépare-les par une virgule">
          <Input autoFocus={!init.to} value={v.to} onChange={(e) => setV({ ...v, to: e.target.value })} placeholder="nom@exemple.fr" />
        </Field>
        <Field label="Objet">
          <Input value={v.subject} onChange={(e) => setV({ ...v, subject: e.target.value })} />
        </Field>
        <Field label="Message">
          <Textarea autoFocus={!!init.to} rows={10} value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} />
        </Field>
      </div>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Envoyer ce message ?"
        description={`À : ${recipients.join(", ")} — Objet : ${v.subject || "(sans objet)"}`}
        confirmLabel="Envoyer"
        loading={busy}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api.post("/api/mail/send", { to: recipients, subject: v.subject, body: v.body, inReplyTo: init.inReplyTo });
            toast({ kind: "success", title: "Message envoyé", description: recipients.join(", ") });
            onClose();
          } catch (e) {
            toast({ kind: "error", title: "Message non envoyé", description: (e as Error).message });
            setConfirm(false);
          } finally {
            setBusy(false);
          }
        }}
      />
    </Dialog>
  );
}

/** Formulaire de connexion : choix du fournisseur (serveurs préremplis) ou réglages manuels. */
export function MailConnect({ account, compact }: { account: MailAccount; compact?: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [preset, setPreset] = useState("orange");
  const p = account.presets[preset];
  const [v, setV] = useState({ email: "", displayName: "", username: "", password: "", imapHost: p.imap[0], imapPort: p.imap[1], imapSecure: p.imap[2], smtpHost: p.smtp[0], smtpPort: p.smtp[1], smtpSecure: p.smtp[2] });
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disc, setDisc] = useState(false);
  const choose = (k: string) => {
    const x = account.presets[k];
    setPreset(k);
    setV({ ...v, imapHost: x.imap[0], imapPort: x.imap[1], imapSecure: x.imap[2], smtpHost: x.smtp[0], smtpPort: x.smtp[1], smtpSecure: x.smtp[2] });
    setAdvanced(k === "other");
  };

  if (account.status !== "disconnected")
    return (
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[13px]">
          Connecté : <b className="font-medium">{account.email}</b> <span className="t-meta">({account.imapHost})</span>
        </span>
        <Button size="sm" variant="ghost" className="ml-auto" icon={<Unplug className="size-3.5" />} onClick={() => setDisc(true)}>
          Déconnecter
        </Button>
        <ConfirmDialog
          open={disc}
          onClose={() => setDisc(false)}
          danger
          title="Déconnecter cette adresse ?"
          description="Le mot de passe chiffré et les messages copiés dans BASILE OS sont supprimés. Rien n'est effacé sur ton serveur de messagerie."
          confirmLabel="Déconnecter"
          onConfirm={async () => {
            await api.del("/api/mail/account").catch((e) => toast({ kind: "error", title: "Impossible", description: (e as Error).message }));
            setDisc(false);
            qc.invalidateQueries({ queryKey: ["mail"] });
          }}
        />
      </div>
    );

  return (
    <form
      className="grid gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api.post("/api/mail/account", { ...v, username: v.username || v.email, displayName: v.displayName || undefined });
          setV({ ...v, password: "" });
          toast({ kind: "success", title: "Adresse connectée", description: "Récupération des messages en cours…" });
          qc.invalidateQueries({ queryKey: ["mail"] });
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {!compact && (
        <div className="mb-1 text-center">
          <span className="mx-auto mb-3 grid size-11 place-items-center rounded-[12px] bg-raised text-fg-3">
            <AtSign className="size-5" />
          </span>
          <p className="t-section">Connecter une adresse email</p>
          <p className="t-sub mt-1">Orange, Free, SFR, iCloud, Yahoo, La Poste… Les messages arrivent ici, et tu peux répondre depuis BASILE OS.</p>
        </div>
      )}
      <Field label="Fournisseur">
        <Select value={preset} onChange={(e) => choose(e.target.value)}>
          {Object.entries(account.presets).map(([k, x]) => (
            <option key={k} value={k}>
              {x.label}
            </option>
          ))}
        </Select>
      </Field>
      <p className="t-meta -mt-1">
        {p.note}
        {preset === "icloud" && (
          <>
            {" "}
            <a href="https://account.apple.com/account/manage" target="_blank" rel="noreferrer" className="text-accent hover:underline">
              Créer un mot de passe pour app
            </a>
          </>
        )}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Adresse email">
          <Input type="email" autoComplete="email" required value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />
        </Field>
        <Field label={preset === "icloud" ? "Mot de passe pour app (xxxx-xxxx-xxxx-xxxx)" : "Mot de passe (ou mot de passe d'application)"}>
          <Input type="password" name="mail-app-password" autoComplete="new-password" data-1p-ignore data-lpignore="true" required value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} />
        </Field>
      </div>
      <button type="button" className="t-meta w-fit hover:text-fg" onClick={() => setAdvanced((a) => !a)}>
        {advanced ? "Masquer les réglages des serveurs" : "Réglages des serveurs (IMAP / SMTP)"}
      </button>
      {advanced && (
        <div className="grid gap-3 rounded-[12px] border border-line-soft bg-bg p-3 sm:grid-cols-2">
          <Field label="Identifiant (si différent de l'adresse)">
            <Input value={v.username} onChange={(e) => setV({ ...v, username: e.target.value })} placeholder={v.email} />
          </Field>
          <Field label="Nom affiché à l'envoi">
            <Input value={v.displayName} onChange={(e) => setV({ ...v, displayName: e.target.value })} />
          </Field>
          <Field label="Serveur IMAP (réception)">
            <Input required value={v.imapHost} onChange={(e) => setV({ ...v, imapHost: e.target.value })} placeholder="imap.exemple.fr" />
          </Field>
          <Field label="Port IMAP · SSL">
            <div className="flex gap-2">
              <Input type="number" value={v.imapPort} onChange={(e) => setV({ ...v, imapPort: Number(e.target.value) })} />
              <Select value={v.imapSecure ? "1" : "0"} onChange={(e) => setV({ ...v, imapSecure: e.target.value === "1" })}>
                <option value="1">SSL/TLS</option>
                <option value="0">STARTTLS</option>
              </Select>
            </div>
          </Field>
          <Field label="Serveur SMTP (envoi)">
            <Input required value={v.smtpHost} onChange={(e) => setV({ ...v, smtpHost: e.target.value })} placeholder="smtp.exemple.fr" />
          </Field>
          <Field label="Port SMTP · SSL">
            <div className="flex gap-2">
              <Input type="number" value={v.smtpPort} onChange={(e) => setV({ ...v, smtpPort: Number(e.target.value) })} />
              <Select value={v.smtpSecure ? "1" : "0"} onChange={(e) => setV({ ...v, smtpSecure: e.target.value === "1" })}>
                <option value="1">SSL/TLS</option>
                <option value="0">STARTTLS</option>
              </Select>
            </div>
          </Field>
        </div>
      )}
      {error && <p className="rounded-[12px] border border-danger/25 bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] px-3 py-2 text-[12.5px] leading-relaxed text-danger">{error}</p>}
      <Button type="submit" variant="primary" loading={busy} disabled={!v.email || !v.password || !v.imapHost || !v.smtpHost} className="justify-center">
        Vérifier et connecter
      </Button>
      <p className="t-meta">Le mot de passe est testé auprès de tes serveurs, puis chiffré (AES-256-GCM). Il n'est jamais renvoyé au navigateur.</p>
    </form>
  );
}
