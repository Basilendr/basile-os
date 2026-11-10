"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Pencil, Trash2, MoreHorizontal, Paperclip, Sparkles, ChevronDown, Check, History } from "lucide-react";
import { api } from "@/lib/client/api";
import { cn, relativeTime } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Menu } from "@/components/ui/menu";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { AttachPicker } from "@/components/tasks/task-detail";
import { Composer, MessageList, useChat } from "./chat";
import { suggestionsFor } from "./suggestions";
import { Orb } from "./orb";
import { AssistantTabs } from "./assistant-tabs";
import { Sheet } from "@/components/ui/sheet";
import { useUI } from "@/components/shell/ui-context";
import { useStatus } from "@/hooks/use-status";
import { AI_MODELS } from "@/lib/catalog";

type Conv = { id: string; title: string; kind: string; updatedAt: string };

export function AssistantView() {
  const sp = useSearchParams();
  const router = useRouter();
  const id = sp.get("c");
  const [q, setQ] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const { data } = useQuery({ queryKey: ["conversations", "assistant", q], queryFn: () => api.get<{ items: Conv[] }>(`/api/ai/conversations?kind=assistant${q ? `&q=${encodeURIComponent(q)}` : ""}`) });
  const select = (cid: string | null) => router.replace(cid ? `/assistant?c=${cid}` : "/assistant", { scroll: false });
  const chat = useChat("assistant", id, (cid) => router.replace(`/assistant?c=${cid}`, { scroll: false }));
  const scroller = useRef<HTMLDivElement>(null);
  const [attach, setAttach] = useState(false);
  const [seed, setSeed] = useState<string | null>(null);
  const { me } = useUI();
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [chat.messages]);
  const empty = chat.messages.length === 0;
  const circle = "focus-ring grid size-9 place-items-center rounded-full border border-line bg-card text-fg-2 shadow-[var(--shadow-sm)] transition-colors hover:text-fg";

  const composer = (
    <div className="w-full">
      <Composer onSend={(t) => (chat.send(t), setSeed(null))} busy={chat.busy} onStop={chat.stop} seed={seed} autoFocus placeholder="Demande-moi n'importe quoi…" />
      <div className="mt-2 flex items-center justify-between gap-3 px-2">
        <button onClick={() => setAttach(true)} className="t-meta inline-flex items-center gap-1.5 hover:text-fg">
          <Paperclip className="size-3.5" />
          Joindre un document
        </button>
        <span className="t-meta hidden sm:inline">Les envois et modifications demandent ta validation.</span>
      </div>
    </div>
  );

  return (
    <div className="relative isolate flex h-full min-h-0 flex-col">
      <div aria-hidden className="grid-bg pointer-events-none absolute inset-0 -z-10 opacity-80" />
      <div className="flex flex-wrap items-center gap-2 px-1 pt-1 md:px-3 md:pt-2">
        <ModelPicker />
        <AssistantTabs className="order-last w-full sm:order-none sm:mx-auto sm:w-auto" />
        <div className="ml-auto flex items-center gap-2 sm:ml-0">
          <button className={circle} onClick={() => setHistoryOpen(true)} aria-label="Historique des conversations" title="Historique">
            <History className="size-4" />
          </button>
          <button className={circle} onClick={() => select(null)} aria-label="Nouvelle conversation" title="Nouvelle conversation">
            <Plus className="size-4" />
          </button>
        </div>
      </div>

      {empty ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-4 pb-10">
          <div className="rise-in flex w-full max-w-[640px] flex-col items-center text-center">
            <Orb size={92} active={chat.busy} />
            <h1 className="mt-7 text-[28px] font-semibold tracking-[-0.025em]">Ravi de te revoir, {me.displayName.split(" ")[0]}.</h1>
            <p className="t-sub mt-2 max-w-md">Je consulte tes tâches, ton agenda, tes emails, ta scolarité et tes documents — et je cite mes sources.</p>
            <div className="mt-7 w-full">{composer}</div>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {suggestionsFor("/").slice(0, 4).map((s) => (
                <button key={s} onClick={() => chat.send(s)} className="focus-ring inline-flex items-center gap-2 rounded-full border border-line bg-card/80 px-3.5 py-2 text-[12.5px] text-fg-2 shadow-[var(--shadow-sm)] backdrop-blur-sm transition-colors hover:border-fg-3/40 hover:text-fg">
                  <Sparkles className="size-3.5 text-fg-3" />
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <>
          <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto max-w-[780px] px-4 py-6">
              <MessageList messages={chat.messages} />
            </div>
          </div>
          <div className="mx-auto w-full max-w-[780px] px-4 pt-1 pb-3">{composer}</div>
        </>
      )}

      <Sheet open={historyOpen} onClose={() => setHistoryOpen(false)} title="Historique des conversations" width={380}>
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-fg-3" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher…" className="pl-8" />
        </div>
        {data?.items.length === 0 && <p className="t-meta py-6 text-center">Aucune conversation pour l'instant.</p>}
        <div className="-mx-2">
          {data?.items.map((c) => (
            <ConvItem
              key={c.id}
              c={c}
              active={c.id === id}
              onSelect={() => {
                select(c.id);
                setHistoryOpen(false);
              }}
              onDeleted={() => c.id === id && select(null)}
            />
          ))}
        </div>
      </Sheet>
      <AttachPicker open={attach} onClose={() => setAttach(false)} onPick={(f) => (setSeed(`Document joint : « ${f.name} » (fileId ${f.id}). `), setAttach(false))} />
    </div>
  );
}

/** Choix du modèle (préférence enregistrée, utilisée par l'assistant, les agents et le briefing). */
function ModelPicker() {
  const { data: prefs } = useQuery({ queryKey: ["preferences"], queryFn: () => api.get<{ aiProvider: string; aiModel: string }>("/api/preferences") });
  const { data: status } = useStatus();
  const qc = useQueryClient();
  const { toast } = useToast();
  if (!prefs) return null;
  const models = AI_MODELS[prefs.aiProvider] ?? [];
  const current = models.find((m) => m.id === prefs.aiModel)?.label ?? prefs.aiModel;
  if (status && !status.ai.configured)
    return (
      <a href="/settings?s=config" className="focus-ring inline-flex h-9 items-center gap-2 rounded-full border border-dashed border-line bg-card/70 px-3.5 text-[12.5px] text-fg-2 hover:text-fg">
        <span className="size-1.5 rounded-full bg-warning" />
        IA non configurée · ajouter une clé
      </a>
    );
  return (
    <Menu
      trigger={({ toggle }) => (
        <button onClick={toggle} className="focus-ring inline-flex h-9 items-center gap-2 rounded-full border border-line bg-card px-3.5 text-[13px] font-medium text-fg-2 shadow-[var(--shadow-sm)] hover:text-fg">
          <span className="size-1.5 rounded-full bg-success" />
          {current}
          <ChevronDown className="size-3 text-fg-3" />
        </button>
      )}
      items={[
        { type: "label", label: "Modèle" },
        ...models.map((m) => ({
          label: m.label,
          hint: m.hint,
          icon: m.id === prefs.aiModel ? <Check /> : <span />,
          onSelect: async () => {
            try {
              await api.patch("/api/preferences", { aiModel: m.id });
              qc.invalidateQueries({ queryKey: ["preferences"] });
              qc.invalidateQueries({ queryKey: ["me"] });
            } catch (e) {
              toast({ kind: "error", title: "Modèle non changé", description: (e as Error).message });
            }
          },
        })),
      ]}
    />
  );
}

function ConvItem({ c, active, onSelect, onDeleted }: { c: Conv; active: boolean; onSelect: () => void; onDeleted: () => void }) {
  const [rename, setRename] = useState<string | null>(null);
  const [del, setDel] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();
  if (rename !== null)
    return (
      <form
        className="px-1 py-1"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            if (rename.trim()) await api.patch(`/api/ai/conversations/${c.id}`, { title: rename.trim() });
            qc.invalidateQueries({ queryKey: ["conversations"] });
          } catch (err) {
            toast({ kind: "error", title: "Renommage impossible", description: (err as Error).message });
          }
          setRename(null);
        }}
      >
        <Input autoFocus value={rename} onChange={(e) => setRename(e.target.value)} onBlur={() => setRename(null)} className="h-8" />
      </form>
    );
  return (
    <div className={cn("group relative rounded-[9px]", active ? "bg-raised" : "hover:bg-raised/50")}>
      <button onClick={onSelect} className="block w-full px-3 py-2.5 text-left">
        <span className="block truncate pr-6 text-[13px]">{c.title}</span>
        <span className="t-meta">{relativeTime(c.updatedAt)}</span>
      </button>
      <div className="absolute top-2 right-1.5 opacity-0 group-hover:opacity-100">
        <Menu
          trigger={({ toggle }) => (
            <button onClick={toggle} className="grid size-6 place-items-center rounded-[6px] text-fg-3 hover:text-fg" aria-label="Options">
              <MoreHorizontal className="size-3.5" />
            </button>
          )}
          items={[
            { label: "Renommer", icon: <Pencil />, onSelect: () => setRename(c.title) },
            { label: "Supprimer", icon: <Trash2 />, danger: true, onSelect: () => setDel(true) },
          ]}
        />
      </div>
      <ConfirmDialog
        open={del}
        onClose={() => setDel(false)}
        title="Supprimer cette conversation ?"
        description="Les messages seront définitivement supprimés."
        danger
        confirmLabel="Supprimer"
        onConfirm={async () => {
          await api.del(`/api/ai/conversations/${c.id}`).catch((e) => toast({ kind: "error", title: "Suppression impossible", description: e.message }));
          qc.invalidateQueries({ queryKey: ["conversations"] });
          setDel(false);
          onDeleted();
        }}
      />
    </div>
  );
}
