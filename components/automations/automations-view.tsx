"use client";
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Workflow, Plus, Play, Trash2, Zap, Filter, Bolt, Save, History, Check, X, Clock, ShieldCheck, ArrowLeft, Lightbulb } from "lucide-react";
import { api } from "@/lib/client/api";
import { cn, relativeTime } from "@/lib/utils";
import { TRIGGERS, ACTIONS, OPS, TEMPLATES, type FieldDef } from "@/services/automations/catalog";
import { PageHeader, Card, EmptyState, Badge, Skeleton } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/input";
import { Dialog, ConfirmDialog } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";

type Cond = { field: string; op: keyof typeof OPS; value: unknown };
type Act = { type: string; config: Record<string, unknown> };
type Automation = { id: string; name: string; description: string; enabled: boolean; trigger: { type: string; config: Record<string, unknown> }; conditions: Cond[]; actions: Act[]; layout: Record<string, { x: number; y: number }>; lastRunAt: string | null; updatedAt: string };
type Run = { id: string; triggerType: string; status: string; attempt: number; error: string | null; startedAt: string; durationMs: number | null; result: Record<string, unknown> };

export function AutomationsView() {
  const sp = useSearchParams();
  const router = useRouter();
  const id = sp.get("id");
  const { data } = useQuery({ queryKey: ["automations"], queryFn: () => api.get<{ items: Automation[] }>("/api/automations") });
  const { data: runs } = useQuery({ queryKey: ["automation-runs"], queryFn: () => api.get<{ items: { run: Run; name: string }[] }>("/api/automations/runs"), refetchInterval: 30_000 });
  const [creating, setCreating] = useState(!!sp.get("new"));
  const [tab, setTab] = useState<"list" | "history">("list");
  const qc = useQueryClient();
  const { toast } = useToast();
  const selected = data?.items.find((a) => a.id === id);

  const create = async (tpl?: (typeof TEMPLATES)[number]) => {
    try {
      const a = await api.post<Automation>("/api/automations", tpl ? { ...tpl, enabled: false } : { name: "Nouvelle automatisation", trigger: { type: "manual", config: {} }, actions: [{ type: "notify", config: { title: "Automatisation exécutée" } }] });
      qc.invalidateQueries({ queryKey: ["automations"] });
      setCreating(false);
      router.replace(`/automations?id=${a.id}`);
    } catch (e) {
      toast({ kind: "error", title: "Création impossible", description: (e as Error).message });
    }
  };

  if (selected) return <Builder key={selected.id} a={selected} onBack={() => router.replace("/automations")} />;
  if (!data) return <div className="mx-auto max-w-[1200px] px-1 pt-1 pb-10 md:px-3 md:pt-2"><Skeleton className="h-40 rounded-[12px]" /></div>;

  return (
    <div className="mx-auto max-w-[1200px] px-1 pt-1 pb-10 md:px-3 md:pt-2">
      <PageHeader
        title="Automatisations"
        description="Déclencheur → conditions → actions. Les actions externes (email, calendrier) sont toujours soumises à ta validation ; chaque événement ne déclenche qu'une exécution."
        actions={
          <Button variant="primary" size="sm" icon={<Plus className="size-3.5" />} onClick={() => setCreating(true)}>
            Nouvelle
          </Button>
        }
      >
        <Segmented value={tab} onChange={setTab} options={[{ value: "list", label: "Mes automatisations", count: data?.items.length }, { value: "history", label: "Historique", icon: <History /> }]} />
      </PageHeader>
      {tab === "list" ? (
        !data?.items.length ? (
          <div className="surface">
            <EmptyState icon={<Workflow className="size-5" />} title="Aucune automatisation" description="Pars d'un modèle ou crée la tienne." action={<Button variant="primary" onClick={() => setCreating(true)}>Créer une automatisation</Button>} />
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {data.items.map((a) => (
              <Card key={a.id} className="cursor-pointer p-4 transition-colors hover:border-fg-3/40" onClick={() => router.replace(`/automations?id=${a.id}`)}>
                <div className="flex items-start gap-3">
                  <span className={cn("grid size-9 place-items-center rounded-[10px] border border-line", a.enabled ? "text-accent" : "text-fg-3")}>
                    <Workflow className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="t-section truncate">{a.name}</p>
                    <p className="t-meta mt-0.5">
                      {TRIGGERS[a.trigger.type]?.label ?? a.trigger.type} → {a.actions.map((x) => ACTIONS[x.type]?.label ?? x.type).join(", ")}
                    </p>
                    <p className="t-meta mt-1">{a.lastRunAt ? `Dernière exécution ${relativeTime(a.lastRunAt)}` : "Jamais exécutée"}</p>
                  </div>
                  <span onClick={(e) => e.stopPropagation()}>
                    <Switch
                      checked={a.enabled}
                      onChange={async (v) => {
                        await api.patch(`/api/automations/${a.id}`, { enabled: v }).catch((e) => toast({ kind: "error", title: "Erreur", description: e.message }));
                        qc.invalidateQueries({ queryKey: ["automations"] });
                      }}
                      label="Activer"
                    />
                  </span>
                </div>
              </Card>
            ))}
          </div>
        )
      ) : (
        <RunsTable rows={runs?.items ?? []} />
      )}
      <Dialog open={creating} onClose={() => (setCreating(false), router.replace("/automations"))} title="Nouvelle automatisation" description="Choisis un modèle ou pars de zéro." size="lg">
        <div className="grid gap-2 sm:grid-cols-2">
          <button onClick={() => create()} className="rounded-[10px] border border-dashed border-line p-3 text-left hover:border-accent">
            <p className="flex items-center gap-2 text-[13.5px] font-medium">
              <Plus className="size-4" /> Partir de zéro
            </p>
          </button>
          {TEMPLATES.map((t) => (
            <button key={t.name} onClick={() => create(t)} className="rounded-[10px] border border-line p-3 text-left hover:border-accent">
              <p className="text-[13.5px] font-medium">{t.name}</p>
              <p className="t-meta mt-0.5">{TRIGGERS[t.trigger.type].description}</p>
            </button>
          ))}
        </div>
      </Dialog>
    </div>
  );
}

function RunsTable({ rows }: { rows: { run: Run; name?: string }[] }) {
  if (!rows.length) return <div className="surface"><EmptyState icon={<History className="size-5" />} title="Aucune exécution" /></div>;
  return (
    <div className="surface overflow-x-auto">
      <table className="w-full min-w-[640px] text-[13px]">
        <thead>
          <tr className="t-label border-b border-line-soft text-left">
            <th className="px-4 py-2.5">Date</th>
            {rows[0].name !== undefined && <th className="px-4 py-2.5">Automatisation</th>}
            <th className="px-4 py-2.5">Déclencheur</th>
            <th className="px-4 py-2.5">Statut</th>
            <th className="px-4 py-2.5">Durée</th>
            <th className="px-4 py-2.5">Résultat / erreur</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ run: r, name }) => (
            <tr key={r.id} className="border-b border-line-soft last:border-0">
              <td className="px-4 py-2.5 whitespace-nowrap">{new Date(r.startedAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</td>
              {name !== undefined && <td className="px-4 py-2.5">{name}</td>}
              <td className="px-4 py-2.5">{TRIGGERS[r.triggerType]?.label ?? r.triggerType}</td>
              <td className="px-4 py-2.5">
                <Badge tone={r.status === "success" ? "success" : r.status === "failed" ? "danger" : r.status === "skipped" ? "neutral" : "warning"}>
                  {{ success: "Réussie", failed: "Échec", skipped: "Ignorée", running: "En cours" }[r.status] ?? r.status}
                  {r.attempt > 1 && ` (essai ${r.attempt})`}
                </Badge>
              </td>
              <td className="t-num px-4 py-2.5">{r.durationMs !== null ? `${r.durationMs} ms` : "—"}</td>
              <td className="t-meta max-w-[320px] truncate px-4 py-2.5" title={r.error ?? JSON.stringify(r.result)}>
                {r.error ?? ((r.result as { reason?: string }).reason || ((r.result as { actions?: { action: string }[] }).actions ?? []).map((a) => ACTIONS[a.action]?.label ?? a.action).join(", ") || "—")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type NodeRef = { kind: "trigger" } | { kind: "condition"; i: number } | { kind: "action"; i: number };
const nodeKey = (n: NodeRef) => (n.kind === "trigger" ? "trigger" : `${n.kind}-${n.i}`);

/** Constructeur visuel : nœuds déplaçables reliés dans l'ordre d'exécution, panneau de configuration. */
function Builder({ a, onBack }: { a: Automation; onBack: () => void }) {
  const [v, setV] = useState(a);
  const [sel, setSel] = useState<NodeRef>({ kind: "trigger" });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [del, setDel] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: runs, refetch: refetchRuns } = useQuery({ queryKey: ["automation-runs", a.id], queryFn: () => api.get<{ items: Run[] }>(`/api/automations/${a.id}/runs`) });
  const update = (p: Partial<Automation>) => (setV((x) => ({ ...x, ...p })), setDirty(true));

  const nodes: NodeRef[] = useMemo(() => [{ kind: "trigger" }, ...v.conditions.map((_, i) => ({ kind: "condition" as const, i })), ...v.actions.map((_, i) => ({ kind: "action" as const, i }))], [v.conditions, v.actions]);
  const pos = (n: NodeRef, idx: number) => v.layout[nodeKey(n)] ?? { x: 40 + (idx % 3) * 250, y: 40 + Math.floor(idx / 3) * 150 };

  const save = async () => {
    setSaving(true);
    try {
      await api.patch(`/api/automations/${a.id}`, { name: v.name, description: v.description, enabled: v.enabled, trigger: v.trigger, conditions: v.conditions, actions: v.actions, layout: v.layout });
      qc.invalidateQueries({ queryKey: ["automations"] });
      setDirty(false);
      toast({ kind: "success", title: "Automatisation enregistrée" });
    } catch (e) {
      toast({ kind: "error", title: "Enregistrement impossible", description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const preview = `Quand « ${TRIGGERS[v.trigger.type]?.label ?? v.trigger.type} »${v.trigger.type === "schedule.daily" ? ` à ${v.trigger.config.time ?? "08:00"}` : ""}${v.conditions.length ? `, si ${v.conditions.map((c) => `${c.field} ${OPS[c.op]} « ${String(c.value ?? "")} »`).join(" et ")}` : ""}, alors : ${v.actions.map((x) => ACTIONS[x.type]?.label ?? x.type).join(", puis ")}.`;
  const sensitive = v.actions.some((x) => ACTIONS[x.type]?.sensitive);

  return (
    <div className="surface flex h-full min-h-0 overflow-hidden flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-4 py-3">
        <Button size="icon-sm" variant="ghost" onClick={onBack} aria-label="Retour">
          <ArrowLeft className="size-4" />
        </Button>
        <input value={v.name} onChange={(e) => update({ name: e.target.value })} className="t-section min-w-0 flex-1 bg-transparent focus:outline-none" aria-label="Nom" />
        <label className="flex items-center gap-2 text-[13px] text-fg-2">
          {v.enabled ? "Activée" : "Désactivée"}
          <Switch checked={v.enabled} onChange={(x) => update({ enabled: x })} />
        </label>
        <Button
          size="sm"
          loading={running}
          icon={<Play className="size-3.5" />}
          onClick={async () => {
            if (dirty) await save();
            setRunning(true);
            try {
              const r = await api.post<Run | null>(`/api/automations/${a.id}/run`);
              toast({ kind: r?.status === "success" ? "success" : r?.status === "skipped" ? "info" : "error", title: r?.status === "success" ? "Exécution réussie" : r?.status === "skipped" ? "Conditions non remplies" : "Exécution échouée", description: r?.error ?? undefined });
              refetchRuns();
              qc.invalidateQueries({ queryKey: ["notifications"] });
              qc.invalidateQueries({ queryKey: ["status"] });
            } catch (e) {
              toast({ kind: "error", title: "Exécution impossible", description: (e as Error).message });
            } finally {
              setRunning(false);
            }
          }}
        >
          Tester
        </Button>
        <Button size="sm" variant="primary" loading={saving} disabled={!dirty} icon={<Save className="size-3.5" />} onClick={save}>
          Enregistrer
        </Button>
        <Button size="icon-sm" variant="ghost" onClick={() => setDel(true)} aria-label="Supprimer">
          <Trash2 className="size-4" />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="relative min-h-[360px] flex-1 overflow-auto bg-[radial-gradient(circle,var(--line-soft)_1px,transparent_1px)] [background-size:18px_18px]">
          <Canvas nodes={nodes} pos={pos} v={v} sel={sel} onSelect={setSel} onMove={(k, p) => update({ layout: { ...v.layout, [k]: p } })} />
          <div className="absolute bottom-3 left-3 flex gap-2">
            <Button size="sm" icon={<Filter className="size-3.5" />} onClick={() => (update({ conditions: [...v.conditions, { field: TRIGGERS[v.trigger.type]?.fields[0] ?? "data.title", op: "contains", value: "" }] }), setSel({ kind: "condition", i: v.conditions.length }))}>
              Condition
            </Button>
            <Button size="sm" icon={<Bolt className="size-3.5" />} onClick={() => (update({ actions: [...v.actions, { type: "notify", config: {} }] }), setSel({ kind: "action", i: v.actions.length }))}>
              Action
            </Button>
          </div>
        </div>
        <aside className="w-full shrink-0 overflow-y-auto border-t border-line-soft p-4 lg:w-[360px] lg:border-t-0 lg:border-l">
          <NodePanel v={v} sel={sel} update={update} onRemove={() => {
            if (sel.kind === "condition") update({ conditions: v.conditions.filter((_, i) => i !== sel.i) });
            if (sel.kind === "action" && v.actions.length > 1) update({ actions: v.actions.filter((_, i) => i !== sel.i) });
            setSel({ kind: "trigger" });
          }} />
          <div className="mt-6 rounded-[10px] border border-line-soft bg-bg-2/60 p-3">
            <p className="t-label mb-1.5">Prévisualisation</p>
            <p className="text-[13px] text-fg-2">{preview}</p>
            {sensitive && (
              <p className="mt-2 flex items-center gap-1.5 text-[12px] text-warning">
                <ShieldCheck className="size-3.5" /> Les actions externes seront préparées puis soumises à ta validation.
              </p>
            )}
          </div>
          <div className="mt-6">
            <p className="t-label mb-2">Dernières exécutions</p>
            {!runs?.items.length && <p className="t-meta">Aucune.</p>}
            {runs?.items.slice(0, 10).map((r) => (
              <div key={r.id} className="flex items-center gap-2 py-1.5 text-[12.5px]">
                {r.status === "success" ? <Check className="size-3.5 text-success" /> : r.status === "failed" ? <X className="size-3.5 text-danger" /> : <Clock className="size-3.5 text-fg-3" />}
                <span className="flex-1 truncate">{r.error ?? TRIGGERS[r.triggerType]?.label}</span>
                <span className="t-meta">{relativeTime(r.startedAt)}</span>
              </div>
            ))}
          </div>
        </aside>
      </div>
      <ConfirmDialog
        open={del}
        onClose={() => setDel(false)}
        danger
        title="Supprimer cette automatisation ?"
        description="Son historique d'exécutions sera aussi supprimé."
        confirmLabel="Supprimer"
        onConfirm={async () => {
          await api.del(`/api/automations/${a.id}`).catch((e) => toast({ kind: "error", title: "Erreur", description: e.message }));
          qc.invalidateQueries({ queryKey: ["automations"] });
          onBack();
        }}
      />
    </div>
  );
}

function Canvas({ nodes, pos, v, sel, onSelect, onMove }: { nodes: NodeRef[]; pos: (n: NodeRef, i: number) => { x: number; y: number }; v: Automation; sel: NodeRef; onSelect: (n: NodeRef) => void; onMove: (k: string, p: { x: number; y: number }) => void }) {
  const W = 210;
  const H = 74;
  const [live, setLive] = useState<Record<string, { x: number; y: number }>>({});
  const P = (n: NodeRef, i: number) => live[nodeKey(n)] ?? pos(n, i);
  const drag = (n: NodeRef, i: number, e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const start = P(n, i);
    const ox = e.clientX;
    const oy = e.clientY;
    let moved = false;
    const mv = (m: PointerEvent) => {
      if (!moved && Math.hypot(m.clientX - ox, m.clientY - oy) < 5) return;
      moved = true;
      setLive((l) => ({ ...l, [nodeKey(n)]: { x: Math.max(0, start.x + m.clientX - ox), y: Math.max(0, start.y + m.clientY - oy) } }));
    };
    const up = (u: PointerEvent) => {
      el.removeEventListener("pointermove", mv);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      if (moved) onMove(nodeKey(n), { x: Math.max(0, start.x + u.clientX - ox), y: Math.max(0, start.y + u.clientY - oy) });
      else onSelect(n);
      setLive((l) => {
        const c = { ...l };
        delete c[nodeKey(n)];
        return c;
      });
    };
    el.addEventListener("pointermove", mv);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };
  const maxX = Math.max(800, ...nodes.map((n, i) => P(n, i).x + W + 40));
  const maxY = Math.max(400, ...nodes.map((n, i) => P(n, i).y + H + 80));
  return (
    <div className="relative" style={{ width: maxX, height: maxY }}>
      <svg className="pointer-events-none absolute inset-0" width={maxX} height={maxY}>
        {nodes.slice(1).map((n, i) => {
          const a = P(nodes[i], i);
          const b = P(n, i + 1);
          const x1 = a.x + W;
          const y1 = a.y + H / 2;
          const x2 = b.x;
          const y2 = b.y + H / 2;
          const dx = Math.max(40, Math.abs(x2 - x1) / 2);
          return <path key={nodeKey(n)} d={`M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`} fill="none" stroke="var(--accent)" strokeOpacity="0.55" strokeWidth={1.6} markerEnd="url(#arrow)" />;
        })}
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--accent)" fillOpacity="0.7" />
          </marker>
        </defs>
      </svg>
      {nodes.map((n, i) => {
        const p = P(n, i);
        const active = nodeKey(n) === nodeKey(sel);
        const meta =
          n.kind === "trigger"
            ? { icon: <Zap className="size-3.5" />, label: "Déclencheur", title: TRIGGERS[v.trigger.type]?.label ?? v.trigger.type, color: "var(--warning)" }
            : n.kind === "condition"
              ? { icon: <Filter className="size-3.5" />, label: "Condition", title: `${v.conditions[n.i].field} ${OPS[v.conditions[n.i].op]} ${String(v.conditions[n.i].value ?? "")}`, color: "var(--accent-2)" }
              : { icon: ACTIONS[v.actions[n.i].type]?.sensitive ? <ShieldCheck className="size-3.5" /> : <Bolt className="size-3.5" />, label: "Action", title: ACTIONS[v.actions[n.i].type]?.label ?? v.actions[n.i].type, color: "var(--accent)" };
        return (
          <div
            key={nodeKey(n)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && onSelect(n)}
            onPointerDown={(e) => drag(n, i, e)}
            className={cn("absolute cursor-grab touch-none rounded-[11px] border bg-card p-3 shadow-[var(--shadow-md)] select-none active:cursor-grabbing", active ? "border-accent ring-2 ring-accent/25" : "border-line")}
            style={{ left: p.x, top: p.y, width: W, minHeight: H }}
          >
            <p className="t-label mb-1 flex items-center gap-1.5" style={{ color: meta.color }}>
              {meta.icon}
              {meta.label}
            </p>
            <p className="line-clamp-2 text-[13px] font-medium">{meta.title}</p>
          </div>
        );
      })}
    </div>
  );
}

function ConfigFields({ defs, values, onChange }: { defs: FieldDef[]; values: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void }) {
  return (
    <div className="flex flex-col gap-3">
      {defs.map((d) => (
        <Field key={d.key} label={d.label}>
          {d.type === "textarea" ? (
            <Textarea value={String(values[d.key] ?? "")} onChange={(e) => onChange({ ...values, [d.key]: e.target.value })} placeholder={d.placeholder} rows={3} />
          ) : d.type === "select" ? (
            <Select value={String(values[d.key] ?? d.options?.[0]?.value ?? "")} onChange={(e) => onChange({ ...values, [d.key]: e.target.value })}>
              {d.options?.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          ) : d.type === "boolean" ? (
            <Switch checked={Boolean(values[d.key])} onChange={(x) => onChange({ ...values, [d.key]: x })} />
          ) : (
            <Input type={d.type === "number" ? "number" : d.type === "time" ? "time" : "text"} value={String(values[d.key] ?? "")} onChange={(e) => onChange({ ...values, [d.key]: d.type === "number" ? e.target.value : e.target.value })} placeholder={d.placeholder} />
          )}
        </Field>
      ))}
    </div>
  );
}

function NodePanel({ v, sel, update, onRemove }: { v: Automation; sel: NodeRef; update: (p: Partial<Automation>) => void; onRemove: () => void }) {
  const fields = TRIGGERS[v.trigger.type]?.fields ?? [];
  if (sel.kind === "trigger")
    return (
      <div>
        <p className="t-label mb-2 flex items-center gap-1.5">
          <Zap className="size-3.5 text-warning" /> Déclencheur
        </p>
        <Select value={v.trigger.type} onChange={(e) => update({ trigger: { type: e.target.value, config: e.target.value === "schedule.daily" ? { time: "08:00", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } : {} } })}>
          {Object.entries(TRIGGERS).map(([k, t]) => (
            <option key={k} value={k}>
              {t.label}
            </option>
          ))}
        </Select>
        <p className="t-meta mt-2">{TRIGGERS[v.trigger.type]?.description}</p>
        {TRIGGERS[v.trigger.type]?.config && (
          <div className="mt-3">
            <ConfigFields defs={TRIGGERS[v.trigger.type].config!} values={v.trigger.config} onChange={(c) => update({ trigger: { ...v.trigger, config: c } })} />
          </div>
        )}
        {fields.length > 0 && <p className="t-meta mt-3">Variables disponibles : {fields.map((f) => `{{${f}}}`).join(", ")}</p>}
        <Field label="Description" className="mt-4">
          <Textarea value={v.description} onChange={(e) => update({ description: e.target.value })} rows={2} />
        </Field>
      </div>
    );
  if (sel.kind === "condition") {
    const c = v.conditions[sel.i];
    if (!c) return null;
    const set = (p: Partial<Cond>) => update({ conditions: v.conditions.map((x, i) => (i === sel.i ? { ...x, ...p } : x)) });
    return (
      <div className="flex flex-col gap-3">
        <p className="t-label flex items-center gap-1.5">
          <Filter className="size-3.5 text-fg-3" /> Condition {sel.i + 1}
        </p>
        <Field label="Champ">
          <Select value={c.field} onChange={(e) => set({ field: e.target.value })}>
            {[...new Set([...fields, c.field])].map((f) => (
              <option key={f}>{f}</option>
            ))}
          </Select>
        </Field>
        <Field label="Opérateur">
          <Select value={c.op} onChange={(e) => set({ op: e.target.value as Cond["op"] })}>
            {Object.entries(OPS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Valeur">
          <Input value={String(c.value ?? "")} onChange={(e) => set({ value: e.target.value })} />
        </Field>
        <Button variant="danger" size="sm" icon={<Trash2 className="size-3.5" />} onClick={onRemove}>
          Retirer la condition
        </Button>
      </div>
    );
  }
  const act = v.actions[sel.i];
  if (!act) return null;
  const set = (p: Partial<Act>) => update({ actions: v.actions.map((x, i) => (i === sel.i ? { ...x, ...p } : x)) });
  return (
    <div className="flex flex-col gap-3">
      <p className="t-label flex items-center gap-1.5">
        <Bolt className="size-3.5 text-accent" /> Action {sel.i + 1}
      </p>
      <Select value={act.type} onChange={(e) => set({ type: e.target.value, config: {} })}>
        {Object.entries(ACTIONS).map(([k, t]) => (
          <option key={k} value={k}>
            {t.label}
          </option>
        ))}
      </Select>
      <p className="t-meta">{ACTIONS[act.type]?.description}</p>
      {act.type === "generate_briefing" && (
        <p className="flex items-center gap-1.5 text-[12px] text-fg-3">
          <Lightbulb className="size-3.5" /> Nécessite un fournisseur IA configuré.
        </p>
      )}
      <ConfigFields defs={ACTIONS[act.type]?.config ?? []} values={act.config} onChange={(c) => set({ config: c })} />
      {v.actions.length > 1 && (
        <Button variant="danger" size="sm" icon={<Trash2 className="size-3.5" />} onClick={onRemove}>
          Retirer l'action
        </Button>
      )}
    </div>
  );
}

