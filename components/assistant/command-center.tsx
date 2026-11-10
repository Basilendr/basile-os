"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Command, ShieldCheck, History, CalendarClock, Lightbulb, RefreshCw, Check, X, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/client/api";
import { cn, isoDate, addDays, relativeTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, EmptyState, Badge } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { useStatus } from "@/hooks/use-status";
import { AssistantTabs } from "./assistant-tabs";
import { Composer, MessageList, PendingCard, useChat, type Pending } from "./chat";
import { COMMAND_SUGGESTIONS } from "./suggestions";

export function CommandCenter() {
  const sp = useSearchParams();
  const router = useRouter();
  const id = sp.get("c");
  const chat = useChat("command", id, (cid) => router.replace(`/command?c=${cid}`, { scroll: false }));
  const [seed, setSeed] = useState<string | null>(null);
  const { data: history } = useQuery({ queryKey: ["conversations", "command"], queryFn: () => api.get<{ items: { id: string; title: string; updatedAt: string }[] }>("/api/ai/conversations?kind=command") });
  const { data: pending } = useQuery({ queryKey: ["pending"], queryFn: () => api.get<{ items: (Pending & { createdAt: string; agentKey: string | null })[] }>("/api/ai/pending"), refetchInterval: 30_000 });
  const { data: status } = useStatus();
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chat.messages]);

  return (
    <div className="mx-auto max-w-[1600px] px-1 pt-1 pb-10 md:px-3 md:pt-2">
      <AssistantTabs className="mb-5" />
      <div className="mb-6 flex items-end justify-between gap-3">
        <div>
          <h1 className="t-title flex items-center gap-2">
            <Command className="size-5 text-accent" /> Centre de commande
          </h1>
          <p className="t-sub mt-1">Pilote BASILE OS en langage naturel. Chaque étape est affichée ; rien d'externe n'est fait sans ta validation.</p>
        </div>
        {chat.messages.length > 0 && (
          <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => router.replace("/command")}>
            Nouvelle commande
          </Button>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0">
          <Composer onSend={(t) => (chat.send(t), setSeed(null))} busy={chat.busy} onStop={chat.stop} seed={seed} placeholder="Ex. « Prépare ma journée de demain » ou « Trouve un créneau de 2 h demain après-midi »" autoFocus />
          {!status?.ai.configured && status && (
            <p className="mt-2 rounded-[9px] border border-warning/30 bg-warning/10 px-3 py-2 text-[12.5px] text-warning">
              IA non configurée : colle ta clé Anthropic dans <a className="underline" href="/settings?s=config">Paramètres → Configuration</a>. Le planificateur ci-dessous fonctionne déjà sans IA.
            </p>
          )}
          {chat.messages.length === 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {COMMAND_SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => (s.endsWith(": ") ? setSeed(s) : chat.send(s))} className="rounded-[9px] border border-line-soft bg-bg-2/60 px-3 py-2 text-[12.5px] text-fg-2 transition-colors hover:border-line hover:text-fg">
                  {s}
                </button>
              ))}
            </div>
          ) : (
            <div className="mt-6">
              <MessageList messages={chat.messages} />
              <div ref={end} />
            </div>
          )}
          <div className="mt-8">
            <DayPlanner />
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="À valider" subtitle="Actions préparées par l'IA, les agents ou les automatisations" icon={<ShieldCheck className="size-4 text-warning" />} action={pending?.items.length ? <Badge tone="warning">{pending.items.length}</Badge> : null} />
            <div className="px-3 pb-3">
              {!pending?.items.length ? (
                <p className="t-meta px-1 pb-2">Aucune action en attente.</p>
              ) : (
                pending.items.map((p) => (
                  <div key={p.id} id={`pending-${p.id}`} className={cn(sp.get("pending") === p.id && "rounded-[12px] ring-2 ring-accent/40")}>
                    <PendingCard p={p} />
                    <p className="t-meta mt-1 px-1">
                      {p.agentKey === "automation" ? "Automatisation" : p.agentKey ? `Agent ${p.agentKey}` : "Assistant"} · {relativeTime(p.createdAt)}
                    </p>
                  </div>
                ))
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title="Historique" icon={<History className="size-4" />} />
            <div className="px-2 pb-2">
              {!history?.items.length ? (
                <p className="t-meta px-2 pb-2">Aucune commande pour l'instant.</p>
              ) : (
                history.items.slice(0, 15).map((h) => (
                  <button key={h.id} onClick={() => router.replace(`/command?c=${h.id}`)} className={cn("block w-full rounded-[8px] px-2.5 py-2 text-left", h.id === id ? "bg-raised" : "hover:bg-raised/50")}>
                    <span className="block truncate text-[13px]">{h.title}</span>
                    <span className="t-meta">{relativeTime(h.updatedAt)}</span>
                  </button>
                ))
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

type Block = { id: string; start: string; end: string; title: string; kind: string; taskId?: string; accepted?: boolean; eventId?: string };
type Plan = { id: string; date: string; status: string; blocks: Block[]; rationale: string; aiUsed?: boolean; freeWindows?: { start: string; end: string }[] };

const KIND_COLOR: Record<string, string> = { task: "var(--accent)", email: "var(--accent-2)", project: "var(--success)", break: "var(--fg-3)", focus: "var(--warning)" };

/** Planificateur quotidien : propose des blocs dans les créneaux libres réels ; chaque écriture au calendrier est confirmée. */
function DayPlanner() {
  const [day, setDay] = useState<"today" | "tomorrow">(new Date().getHours() >= 18 ? "tomorrow" : "today");
  const date = isoDate(day === "today" ? new Date() : addDays(new Date(), 1));
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery({ queryKey: ["plan", date], queryFn: () => api.get<{ plan: Plan | null }>(`/api/ai/plan?date=${date}`) });
  const [gen, setGen] = useState(false);
  const [confirm, setConfirm] = useState<Block | "all" | null>(null);
  const [committing, setCommitting] = useState(false);
  const plan = data?.plan;

  const generate = async () => {
    setGen(true);
    try {
      const p = await api.post<Plan>("/api/ai/plan", { date });
      qc.setQueryData(["plan", date], { plan: p });
      if (!p.blocks.length) toast({ kind: "info", title: "Aucun créneau libre", description: "Ton agenda est complet sur la plage 8 h – 19 h." });
    } catch (e) {
      toast({ kind: "error", title: "Planification impossible", description: (e as Error).message });
    } finally {
      setGen(false);
    }
  };
  const save = async (blocks: Block[], status?: string) => {
    qc.setQueryData(["plan", date], { plan: { ...plan!, blocks, status: status ?? plan!.status } });
    await api.patch("/api/ai/plan", { date, blocks, status }).catch((e) => toast({ kind: "error", title: "Planning non enregistré", description: e.message }));
  };
  const commit = async (blocks: Block[]) => {
    setCommitting(true);
    let ok = 0;
    for (const b of blocks.filter((x) => !x.eventId && x.kind !== "break")) {
      try {
        await api.post("/api/ai/plan/commit", { date, blockId: b.id, confirm: true });
        ok++;
      } catch (e) {
        toast({ kind: "error", title: `« ${b.title} » non ajouté`, description: (e as Error).message });
      }
    }
    setCommitting(false);
    setConfirm(null);
    qc.invalidateQueries({ queryKey: ["plan", date] });
    qc.invalidateQueries({ queryKey: ["events"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    if (ok) toast({ kind: "success", title: `${ok} bloc${ok > 1 ? "s" : ""} ajouté${ok > 1 ? "s" : ""} au calendrier` });
  };

  return (
    <Card>
      <CardHeader
        title="Planificateur quotidien"
        subtitle={plan ? plan.rationale : "Blocs de travail proposés dans tes disponibilités réelles"}
        icon={<CalendarClock className="size-4" />}
        action={
          <div className="flex items-center gap-2">
            <Segmented size="sm" value={day} onChange={setDay} options={[{ value: "today", label: "Aujourd'hui" }, { value: "tomorrow", label: "Demain" }]} />
            <Button size="sm" variant={plan ? "ghost" : "primary"} loading={gen} icon={plan ? <RefreshCw className="size-3.5" /> : <Lightbulb className="size-3.5" />} onClick={generate}>
              {plan ? "Régénérer" : "Proposer un planning"}
            </Button>
          </div>
        }
      />
      <div className="px-4 pb-4">
        {isLoading ? null : !plan ? (
          <EmptyState className="py-8" icon={<CalendarClock className="size-5" />} title="Pas encore de planning" description="Le planning respecte tes événements existants et priorise tes tâches urgentes et échéances." />
        ) : plan.blocks.length === 0 ? (
          <p className="t-meta py-4">Aucun bloc proposé.</p>
        ) : (
          <>
            <ol className="flex flex-col gap-1.5">
              {plan.blocks.map((b) => (
                <BlockRow
                  key={b.id}
                  b={b}
                  onChange={(nb) => save(plan.blocks.map((x) => (x.id === b.id ? nb : x)))}
                  onRemove={() => save(plan.blocks.filter((x) => x.id !== b.id))}
                  onCommit={() => setConfirm(b)}
                />
              ))}
            </ol>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => save(plan.blocks, "rejected")} icon={<X className="size-3.5" />}>
                Refuser
              </Button>
              <Button size="sm" onClick={() => save(plan.blocks, "accepted").then(() => toast({ kind: "success", title: "Planning enregistré" }))} icon={<Check className="size-3.5" />}>
                Enregistrer
              </Button>
              <Button size="sm" variant="primary" onClick={() => setConfirm("all")} disabled={plan.blocks.every((b) => b.eventId || b.kind === "break")}>
                Ajouter au calendrier…
              </Button>
            </div>
            {plan.status !== "draft" && <p className="t-meta mt-2 text-right">Statut : {plan.status === "accepted" ? "accepté" : "refusé"}</p>}
          </>
        )}
      </div>
      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        loading={committing}
        title="Modifier ton calendrier ?"
        description={
          confirm === "all"
            ? `${plan?.blocks.filter((b) => !b.eventId && b.kind !== "break").length} événement(s) seront créés dans ton calendrier${"" /* Google si connecté */}.`
            : confirm
              ? `L'événement « ${confirm.title} » (${confirm.start} – ${confirm.end}) sera créé dans ton calendrier.`
              : ""
        }
        confirmLabel="Créer"
        onConfirm={() => commit(confirm === "all" ? (plan?.blocks ?? []) : confirm ? [confirm] : [])}
      />
    </Card>
  );
}

function BlockRow({ b, onChange, onRemove, onCommit }: { b: Block; onChange: (b: Block) => void; onRemove: () => void; onCommit: () => void }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(b);
  if (editing)
    return (
      <li className="flex flex-wrap items-center gap-2 rounded-[9px] border border-line bg-bg-2 p-2">
        <Input type="time" value={v.start} onChange={(e) => setV({ ...v, start: e.target.value })} className="h-8 w-28" />
        <Input type="time" value={v.end} onChange={(e) => setV({ ...v, end: e.target.value })} className="h-8 w-28" />
        <Input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} className="h-8 min-w-0 flex-1" />
        <Button size="sm" variant="primary" onClick={() => (onChange(v), setEditing(false))} disabled={v.end <= v.start || !v.title.trim()}>
          OK
        </Button>
      </li>
    );
  return (
    <li className="group flex items-center gap-3 rounded-[9px] px-2 py-2 hover:bg-raised/50">
      <span className="t-num w-24 shrink-0 text-[12.5px] text-fg-2">
        {b.start} – {b.end}
      </span>
      <span className="h-6 w-[3px] shrink-0 rounded-full" style={{ background: KIND_COLOR[b.kind] ?? "var(--accent)" }} />
      <button className="min-w-0 flex-1 truncate text-left text-[13.5px]" onClick={() => setEditing(true)} title="Modifier">
        {b.title}
      </button>
      {b.eventId ? (
        <Badge tone="success">Dans le calendrier</Badge>
      ) : (
        <>
          <button className="text-fg-3 opacity-0 group-hover:opacity-100 hover:text-danger" onClick={onRemove} aria-label="Retirer">
            <Trash2 className="size-3.5" />
          </button>
          {b.kind !== "break" && (
            <Button size="sm" variant="ghost" onClick={onCommit}>
              Créer l'événement
            </Button>
          )}
        </>
      )}
    </li>
  );
}
