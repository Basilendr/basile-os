"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { ArrowUp, Check, CircleStop, Loader2, X, AlertTriangle, Link2, ShieldCheck } from "lucide-react";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useStatus } from "@/hooks/use-status";
import { Markdown } from "./markdown";
import { Orb } from "./orb";
import { Avatar } from "@/components/ui/misc";
import { useUI } from "@/components/shell/ui-context";

export type Step = { id?: string; tool: string; status: string; summary: string };
export type Pending = { id: string; tool: string; summary: string; args: Record<string, unknown>; status: string };
export type SourceRef = { type: string; id: string; title: string; href: string };
export type ChatMsg = { id: string; role: "user" | "assistant"; content: string; steps: Step[]; sources: SourceRef[]; pending: Pending[]; error?: string; streaming?: boolean };

type ConvResponse = {
  id: string;
  title: string;
  messages: { id: string; role: "user" | "assistant"; content: string; steps: Step[]; sources: SourceRef[]; context: { pending?: string[] } }[];
  pending: Pending[];
};

/** Conversation IA diffusée en continu (NDJSON) : texte progressif, étapes d'exécution, actions à valider. */
export function useChat(kind: "assistant" | "command", initialId: string | null, onConversation?: (id: string) => void) {
  const [conversationId, setConversationId] = useState<string | null>(initialId);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const qc = useQueryClient();
  const pathname = usePathname();

  const { data: conv } = useQuery({ queryKey: ["conversation", initialId], queryFn: () => api.get<ConvResponse>(`/api/ai/conversations/${initialId}`), enabled: !!initialId });
  useEffect(() => {
    setConversationId(initialId);
    if (!initialId) setMessages([]);
  }, [initialId]);
  useEffect(() => {
    if (!conv || busy) return;
    const byId = new Map(conv.pending.map((p) => [p.id, p]));
    setMessages(conv.messages.map((m) => ({ id: m.id, role: m.role, content: m.content, steps: m.steps, sources: m.sources, pending: (m.context?.pending ?? []).map((id) => byId.get(id)).filter(Boolean) as Pending[] })));
  }, [conv]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = useCallback(
    async (text: string, page?: { entityType?: string; entityId?: string; title?: string }) => {
      if (!text.trim() || busy) return;
      setBusy(true);
      const uid = `u${Date.now()}`;
      const aid = `a${Date.now()}`;
      setMessages((m) => [...m, { id: uid, role: "user", content: text, steps: [], sources: [], pending: [] }, { id: aid, role: "assistant", content: "", steps: [], sources: [], pending: [], streaming: true }]);
      const patch = (fn: (m: ChatMsg) => ChatMsg) => setMessages((list) => list.map((m) => (m.id === aid ? fn(m) : m)));
      abort.current = new AbortController();
      try {
        const res = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ conversationId, kind, message: text, page: { path: pathname, ...page } }),
          signal: abort.current.signal,
        });
        if (!res.ok || !res.body) {
          const d = await res.json().catch(() => null);
          throw new Error(d?.error?.message ?? `Erreur ${res.status}`);
        }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            const e = JSON.parse(line);
            if (e.type === "conversation") {
              setConversationId(e.id);
              onConversation?.(e.id);
            } else if (e.type === "text") patch((m) => ({ ...m, content: m.content + e.delta }));
            else if (e.type === "step")
              patch((m) => {
                const i = m.steps.findIndex((s) => s.id === e.id);
                const steps = [...m.steps];
                if (i >= 0) steps[i] = e;
                else steps.push(e);
                return { ...m, steps };
              });
            else if (e.type === "pending") patch((m) => ({ ...m, pending: [...m.pending, e.action] }));
            else if (e.type === "sources") patch((m) => ({ ...m, sources: e.items }));
            else if (e.type === "error") patch((m) => ({ ...m, error: e.message }));
            else if (e.type === "done") patch((m) => ({ ...m, id: e.messageId }));
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") patch((m) => ({ ...m, error: (err as Error).message }));
      } finally {
        patch((m) => ({ ...m, streaming: false }));
        setBusy(false);
        ["conversations", "tasks", "projects", "notes", "events", "dashboard", "activity", "pending", "status"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      }
    },
    [busy, conversationId, kind, pathname, onConversation, qc],
  );

  return { conversationId, messages, setMessages, busy, send, stop: () => abort.current?.abort() };
}

export function MessageList({ messages, onApproved }: { messages: ChatMsg[]; onApproved?: () => void }) {
  const { me } = useUI();
  return (
    <div className="flex flex-col gap-5">
      {messages.map((m) =>
        m.role === "user" ? (
          <motion.div key={m.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="ml-auto flex max-w-[85%] items-start gap-2.5">
            <span className="rounded-[20px] border border-line bg-card px-4 py-2.5 text-[14px] whitespace-pre-wrap shadow-[var(--shadow-sm)]">{m.content}</span>
            <Avatar name={me.displayName} src={me.avatarUrl} size={30} className="mt-0.5" />
          </motion.div>
        ) : (
          <motion.div key={m.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-3">
            <Orb size={28} active={m.streaming} className="mt-1 shrink-0" />
            <div className="min-w-0 flex-1 rounded-[18px] border border-line bg-card px-4 py-3 shadow-[var(--shadow-sm)]">
              {m.steps.length > 0 && <Steps steps={m.steps} />}
              {m.content ? <Markdown content={m.content} /> : m.streaming && !m.steps.length ? <Thinking /> : null}
              {m.streaming && m.content && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-accent align-middle" />}
              {m.pending.map((p) => (
                <PendingCard key={p.id} p={p} onDone={onApproved} />
              ))}
              {m.error && (
                <div className="mt-2 flex items-start gap-2 rounded-[9px] border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <span>
                    {m.error}{" "}
                    {/configur/i.test(m.error) && (
                      <Link href="/settings?s=config" className="underline underline-offset-2">
                        Configurer l'IA
                      </Link>
                    )}
                  </span>
                </div>
              )}
              {m.sources.length > 0 && <Sources items={m.sources} />}
            </div>
          </motion.div>
        ),
      )}
    </div>
  );
}

function Thinking() {
  return (
    <span className="t-meta inline-flex items-center gap-2">
      <Loader2 className="size-3.5 animate-spin" /> Réflexion…
    </span>
  );
}

function Steps({ steps }: { steps: Step[] }) {
  return (
    <ol className="mb-2.5 flex flex-col gap-1 rounded-[10px] border border-line-soft bg-bg-2/60 p-2">
      {steps.map((s, i) => (
        <li key={s.id ?? i} className="flex items-center gap-2 text-[12.5px] text-fg-2">
          {s.status === "running" ? (
            <Loader2 className="size-3.5 animate-spin text-accent" />
          ) : s.status === "error" ? (
            <X className="size-3.5 text-danger" />
          ) : s.status === "awaiting_approval" ? (
            <ShieldCheck className="size-3.5 text-warning" />
          ) : (
            <Check className="size-3.5 text-success" />
          )}
          <span className="truncate">{s.summary}</span>
          {s.status === "awaiting_approval" && <span className="t-meta ml-auto shrink-0 text-warning">à valider</span>}
        </li>
      ))}
    </ol>
  );
}

function Sources({ items }: { items: SourceRef[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {items.slice(0, 12).map((s) => (
        <Link key={`${s.type}-${s.id}`} href={s.href} className="inline-flex max-w-[220px] items-center gap-1.5 rounded-[6px] border border-line px-2 py-1 text-[11.5px] text-fg-2 hover:border-fg-3/40 hover:text-fg">
          <Link2 className="size-3 shrink-0 text-fg-3" />
          <span className="truncate">{s.title}</span>
        </Link>
      ))}
    </div>
  );
}

const ARG_LABELS: Record<string, string> = { to: "À", cc: "Cc", subject: "Objet", body: "Message", title: "Titre", startAt: "Début", endAt: "Fin", location: "Lieu", attendees: "Participants", content: "Contenu", category: "Catégorie", description: "Description" };

/** Carte de validation : l'utilisateur voit exactement ce qui sera fait, peut modifier, valider ou refuser. */
export function PendingCard({ p, onDone }: { p: Pending; onDone?: () => void }) {
  const [state, setState] = useState(p.status);
  const [loading, setLoading] = useState<"approve" | "reject" | null>(null);
  const [edits, setEdits] = useState<Record<string, unknown>>({});
  const { toast } = useToast();
  const qc = useQueryClient();
  const decide = async (approve: boolean) => {
    setLoading(approve ? "approve" : "reject");
    try {
      const r = await api.post<{ status: string; error?: string }>(`/api/ai/pending/${p.id}`, { approve, edits: Object.keys(edits).length ? edits : undefined });
      setState(r.status);
      if (r.status === "failed") toast({ kind: "error", title: "Action échouée", description: r.error ?? "" });
      else toast({ kind: approve ? "success" : "info", title: approve ? "Action effectuée" : "Action refusée", description: p.summary });
      ["pending", "conversation", "events", "tasks", "dashboard", "notifications", "status"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onDone?.();
    } catch (e) {
      toast({ kind: "error", title: "Décision non enregistrée", description: (e as Error).message });
    } finally {
      setLoading(null);
    }
  };
  const editable = ["subject", "body", "title"];
  return (
    <div className="mt-3 overflow-hidden rounded-[11px] border border-warning/30 bg-warning/[0.06]">
      <div className="flex items-center gap-2 border-b border-warning/20 px-3 py-2">
        <ShieldCheck className="size-4 text-warning" />
        <span className="flex-1 text-[13px] font-medium">{p.summary}</span>
        {state !== "pending" && <span className={cn("t-meta", state === "executed" ? "text-success" : state === "failed" ? "text-danger" : "")}>{{ executed: "Effectuée", rejected: "Refusée", failed: "Échec", approved: "En cours" }[state] ?? state}</span>}
      </div>
      <dl className="grid gap-1.5 px-3 py-2.5 text-[12.5px]">
        {Object.entries(p.args)
          .filter(([, v]) => v !== undefined && v !== null && v !== "")
          .map(([k, v]) => (
            <div key={k} className="grid grid-cols-[90px_1fr] gap-2">
              <dt className="text-fg-3">{ARG_LABELS[k] ?? k}</dt>
              <dd className="min-w-0 text-fg-2">
                {state === "pending" && editable.includes(k) && typeof v === "string" ? (
                  k === "body" ? (
                    <textarea defaultValue={v} onChange={(e) => setEdits((x) => ({ ...x, [k]: e.target.value }))} rows={Math.min(8, v.split("\n").length + 1)} className="w-full rounded-[6px] border border-line bg-bg-2 px-2 py-1 text-[12.5px] focus:border-accent focus:outline-none" />
                  ) : (
                    <input defaultValue={v} onChange={(e) => setEdits((x) => ({ ...x, [k]: e.target.value }))} className="w-full rounded-[6px] border border-line bg-bg-2 px-2 py-1 text-[12.5px] focus:border-accent focus:outline-none" />
                  )
                ) : (
                  <span className="break-words whitespace-pre-wrap">{/At$/.test(k) && typeof v === "string" ? new Date(v).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" }) : Array.isArray(v) ? v.join(", ") : String(v)}</span>
                )}
              </dd>
            </div>
          ))}
      </dl>
      {state === "pending" && (
        <div className="flex justify-end gap-2 border-t border-warning/20 px-3 py-2">
          <Button size="sm" variant="ghost" loading={loading === "reject"} onClick={() => decide(false)}>
            Refuser
          </Button>
          <Button size="sm" variant="primary" loading={loading === "approve"} icon={<Check className="size-3.5" />} onClick={() => decide(true)}>
            Valider et exécuter
          </Button>
        </div>
      )}
    </div>
  );
}

export function Composer({ onSend, busy, onStop, placeholder = "Demande quelque chose à BASILE OS…", autoFocus, seed }: { onSend: (t: string) => void; busy: boolean; onStop: () => void; placeholder?: string; autoFocus?: boolean; seed?: string | null }) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const { data: status } = useStatus();
  useEffect(() => {
    if (seed) setText(seed);
  }, [seed]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(200, el.scrollHeight)}px`;
  }, [text]);
  const submit = () => {
    if (!text.trim() || busy) return;
    onSend(text.trim());
    setText("");
  };
  return (
    <div className="flex items-end gap-2 rounded-[22px] border border-line bg-card py-1.5 pr-1.5 pl-3 shadow-[var(--shadow-md)] transition-colors focus-within:border-fg-3/50">
      <textarea
        ref={ref}
        value={text}
        autoFocus={autoFocus}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        rows={1}
        placeholder={status && !status.ai.configured ? "IA non configurée — ajoute ta clé dans Paramètres → Configuration" : placeholder}
        className="block max-h-[200px] min-w-0 flex-1 resize-none bg-transparent py-1.5 text-[14px] placeholder:text-fg-3 focus:outline-none"
        aria-label="Message"
      />
      {busy ? (
        <button onClick={onStop} aria-label="Arrêter" className="focus-ring grid size-8 shrink-0 place-items-center rounded-full border border-line bg-raised text-fg-2 hover:text-fg">
          <CircleStop className="size-4" />
        </button>
      ) : (
        <button onClick={submit} disabled={!text.trim()} aria-label="Envoyer" title="Envoyer (Entrée)" className="focus-ring grid size-8 shrink-0 place-items-center rounded-full bg-primary text-primary-fg transition-opacity disabled:opacity-25">
          <ArrowUp className="size-4" />
        </button>
      )}
    </div>
  );
}

