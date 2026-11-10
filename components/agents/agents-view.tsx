"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Lightbulb, Mail, CalendarDays, CheckCircle2, FolderKanban, Search, Play, Settings2, History, Check, X, Loader2, ShieldCheck } from "lucide-react";
import { api } from "@/lib/client/api";
import { TOOLS, type ToolName } from "@/lib/catalog";
import { relativeTime } from "@/lib/utils";
import { PageHeader, Card, Badge, EmptyState, Skeleton } from "@/components/ui/misc";
import { AssistantTabs } from "@/components/assistant/assistant-tabs";
import { Switch, Textarea, Checkbox } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { useStatus } from "@/hooks/use-status";
import { Markdown } from "@/components/assistant/markdown";
import { PendingCard } from "@/components/assistant/chat";

type Run = { id: string; input: string; output: string; status: string; steps: { tool: string; status: string; summary: string }[]; error: string | null; startedAt: string; finishedAt: string | null };
type Agent = { key: string; name: string; description: string; icon: string; enabled: boolean; permissions: string[]; instructions: string; defaultPermissions: string[]; lastRun: Run | null; runCount: number; history: Run[] };

const ICONS: Record<string, React.ReactNode> = { sparkles: <Lightbulb />, mail: <Mail />, calendar: <CalendarDays />, "check-circle": <CheckCircle2 />, "folder-kanban": <FolderKanban />, search: <Search /> };
const PRESETS: Record<string, string> = {
  personal: "Prépare mon rendez-vous de demain.",
  email: "Repère les emails importants des 3 derniers jours auxquels je n'ai pas répondu et propose des réponses.",
  calendar: "Analyse mon agenda de la semaine : conflits, journées surchargées et créneaux libres.",
  productivity: "Propose-moi un plan pour aujourd'hui à partir de mes tâches et de mon agenda.",
  projects: "Fais le point sur mes projets actifs : avancement, blocages, prochaines actions.",
  research: "Retrouve tout ce que j'ai sur les tarifs du site, avec les sources.",
};

export function AgentsView() {
  const { data, isLoading } = useQuery({ queryKey: ["agents"], queryFn: () => api.get<{ items: Agent[] }>("/api/agents") });
  const [config, setConfig] = useState<Agent | null>(null);
  const [run, setRun] = useState<Agent | null>(null);
  const [hist, setHist] = useState<Agent | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();
  const order = ["personal", "email", "calendar", "productivity", "projects", "research"];
  const agents = [...(data?.items ?? [])].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));

  const toggle = async (a: Agent, enabled: boolean) => {
    try {
      await api.patch(`/api/agents/${a.key}`, { enabled });
      qc.invalidateQueries({ queryKey: ["agents"] });
    } catch (e) {
      toast({ kind: "error", title: "Modification impossible", description: (e as Error).message });
    }
  };

  return (
    <div className="mx-auto max-w-[1600px] px-1 pt-1 pb-10 md:px-3 md:pt-2">
      <AssistantTabs className="mb-5" />
      <PageHeader title="Agents IA" description="Chaque agent a une mission précise et des permissions limitées. Aucun n'a d'accès illimité ; les actions externes passent toujours par ta validation." />
      {isLoading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-48 rounded-[12px]" />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {agents.map((a) => (
            <Card key={a.key} className="flex flex-col p-4">
              <div className="flex items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-[11px] border border-line bg-raised text-accent [&>svg]:size-4.5">{ICONS[a.icon] ?? <Bot />}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="t-section truncate">{a.name}</h3>
                    <Badge tone={a.enabled ? "success" : "neutral"}>{a.enabled ? "Actif" : "Désactivé"}</Badge>
                  </div>
                  <p className="t-sub mt-1 text-[13px]">{a.description}</p>
                </div>
                <Switch checked={a.enabled} onChange={(v) => toggle(a, v)} label={`Activer ${a.name}`} />
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                {a.permissions.map((p) => (
                  <Badge key={p} tone={TOOLS[p as ToolName]?.sensitivity === "external" ? "warning" : TOOLS[p as ToolName]?.sensitivity === "write" ? "accent" : "neutral"}>
                    {TOOLS[p as ToolName]?.label ?? p}
                  </Badge>
                ))}
              </div>
              <p className="t-meta mt-3">{a.lastRun ? `Dernière exécution ${relativeTime(a.lastRun.startedAt)} · ${a.runCount} au total` : "Jamais exécuté"}</p>
              <div className="mt-auto flex gap-2 pt-3">
                <Button size="sm" variant="primary" icon={<Play className="size-3.5" />} disabled={!a.enabled} onClick={() => setRun(a)}>
                  Lancer
                </Button>
                <Button size="sm" icon={<Settings2 className="size-3.5" />} onClick={() => setConfig(a)}>
                  Configurer
                </Button>
                <Button size="sm" variant="ghost" icon={<History className="size-3.5" />} onClick={() => setHist(a)}>
                  Historique
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      {config && <ConfigDialog a={config} onClose={() => setConfig(null)} />}
      {run && <RunDialog a={run} onClose={() => setRun(null)} />}
      <Dialog open={!!hist} onClose={() => setHist(null)} title={hist ? `Historique — ${hist.name}` : ""} size="lg">
        {!hist?.history.length ? (
          <EmptyState icon={<History className="size-5" />} title="Aucune exécution" />
        ) : (
          <div className="flex flex-col gap-3">
            {hist.history.map((r) => (
              <details key={r.id} className="rounded-[10px] border border-line-soft bg-bg-2/50 p-3">
                <summary className="flex cursor-pointer items-center gap-2 text-[13px]">
                  {r.status === "success" ? <Check className="size-3.5 text-success" /> : r.status === "failed" ? <X className="size-3.5 text-danger" /> : <Loader2 className="size-3.5 animate-spin" />}
                  <span className="flex-1 truncate">{r.input}</span>
                  <span className="t-meta">{relativeTime(r.startedAt)}</span>
                </summary>
                <div className="mt-2 border-t border-line-soft pt-2">
                  {r.steps.length > 0 && <p className="t-meta mb-2">Outils : {r.steps.map((s) => s.summary).join(" · ")}</p>}
                  {r.error ? <p className="text-[13px] text-danger">{r.error}</p> : <Markdown content={r.output} />}
                </div>
              </details>
            ))}
          </div>
        )}
      </Dialog>
    </div>
  );
}

function ConfigDialog({ a, onClose }: { a: Agent; onClose: () => void }) {
  const [perms, setPerms] = useState<Set<string>>(new Set(a.permissions));
  const [instructions, setInstructions] = useState(a.instructions);
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();
  const candidates = (Object.keys(TOOLS) as ToolName[]).filter((t) => t !== "deleguer_agent" || a.key === "personal");
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Configurer — ${a.name}`}
      description="Accorde uniquement les outils nécessaires à la mission. Les actions externes restent soumises à validation."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={() => setPerms(new Set(a.defaultPermissions))}>
            Permissions par défaut
          </Button>
          <Button
            variant="primary"
            loading={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await api.patch(`/api/agents/${a.key}`, { permissions: [...perms], instructions });
                qc.invalidateQueries({ queryKey: ["agents"] });
                toast({ kind: "success", title: "Agent mis à jour" });
                onClose();
              } catch (e) {
                toast({ kind: "error", title: "Enregistrement impossible", description: (e as Error).message });
              } finally {
                setSaving(false);
              }
            }}
          >
            Enregistrer
          </Button>
        </>
      }
    >
      <p className="t-label mb-2">Permissions</p>
      <div className="grid gap-1 sm:grid-cols-2">
        {candidates.map((t) => (
          <label key={t} className="flex items-center gap-2.5 rounded-[8px] px-2 py-1.5 hover:bg-raised/50">
            <Checkbox
              checked={perms.has(t)}
              onChange={(v) =>
                setPerms((s) => {
                  const n = new Set(s);
                  if (v) n.add(t);
                  else n.delete(t);
                  return n;
                })
              }
            />
            <span className="flex-1 text-[13px]">{TOOLS[t].label}</span>
            {TOOLS[t].sensitivity === "external" && <ShieldCheck className="size-3.5 text-warning" aria-label="Validation requise" />}
          </label>
        ))}
      </div>
      <p className="t-label mt-4 mb-2">Consignes personnalisées</p>
      <Textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Ex. Tutoie mes contacts proches, signe « Basile »." rows={3} />
    </Dialog>
  );
}

function RunDialog({ a, onClose }: { a: Agent; onClose: () => void }) {
  const [input, setInput] = useState(PRESETS[a.key] ?? "");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ output: string; steps: Run["steps"]; pending: { id: string; summary: string }[] } | null>(null);
  const [pending, setPending] = useState<{ id: string; tool: string; summary: string; args: Record<string, unknown>; status: string }[]>([]);
  const { data: status } = useStatus();
  const qc = useQueryClient();
  const { toast } = useToast();
  const go = async () => {
    setLoading(true);
    setResult(null);
    try {
      const r = await api.post<{ output: string; steps: Run["steps"]; pending: { id: string; summary: string }[] }>(`/api/agents/${a.key}/run`, { input });
      setResult(r);
      if (r.pending.length) {
        const all = await api.get<{ items: typeof pending }>("/api/ai/pending");
        setPending(all.items.filter((p) => r.pending.some((x) => x.id === p.id)));
      }
      qc.invalidateQueries({ queryKey: ["agents"] });
    } catch (e) {
      toast({ kind: "error", title: "Exécution impossible", description: (e as Error).message });
    } finally {
      setLoading(false);
    }
  };
  return (
    <Dialog open onClose={onClose} title={`Lancer — ${a.name}`} size="lg" footer={<Button variant="primary" loading={loading} disabled={input.trim().length < 3 || !status?.ai.configured} icon={<Play className="size-3.5" />} onClick={go}>Exécuter</Button>}>
      {!status?.ai.configured && <p className="mb-3 rounded-[8px] border border-warning/30 bg-warning/10 px-3 py-2 text-[12.5px] text-warning">IA non configurée : ajoute ta clé dans Paramètres → Configuration pour exécuter les agents.</p>}
      <Textarea value={input} onChange={(e) => setInput(e.target.value)} rows={3} data-autofocus />
      {loading && (
        <p className="t-meta mt-3 inline-flex items-center gap-2">
          <Loader2 className="size-3.5 animate-spin" /> L'agent travaille…
        </p>
      )}
      {result && (
        <div className="mt-4 border-t border-line-soft pt-3">
          {result.steps.length > 0 && <p className="t-meta mb-2">Étapes : {result.steps.map((s) => s.summary).join(" · ")}</p>}
          <Markdown content={result.output} />
          {pending.map((p) => (
            <PendingCard key={p.id} p={p} />
          ))}
        </div>
      )}
    </Dialog>
  );
}
