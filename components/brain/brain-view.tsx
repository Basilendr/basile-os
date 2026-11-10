"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BrainCircuit, Network, Lightbulb, Search, Plus, Trash2, RefreshCw, Link2, X } from "lucide-react";
import { api } from "@/lib/client/api";
import { cn, relativeTime } from "@/lib/utils";
import { PageHeader, EmptyState, Badge, Card } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Dialog, ConfirmDialog } from "@/components/ui/dialog";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { useUI } from "@/components/shell/ui-context";

type GNode = { id: string; type: string; title: string; href: string; color?: string };
type GEdge = { source: string; target: string; relation: string };
type KItem = { id: string; kind: string; title: string; content: string; tags: string[]; sourceType: string | null; sourceId: string | null; updatedAt: string };

const TYPE_COLOR: Record<string, string> = { project: "#6385FF", task: "#3DD68C", note: "#9B8CFF", file: "#F5A524", contact: "#F472B6", email: "#38BDF8", event: "#F2555A", knowledge: "#A3E635" };
const TYPE_LABEL: Record<string, string> = { project: "Projets", task: "Tâches", note: "Notes", file: "Documents", contact: "Personnes", email: "Emails", event: "Réunions", knowledge: "Idées & connaissances" };
const KINDS: Record<string, string> = { idea: "Idée", meeting: "Compte rendu", summary: "Résumé IA", reference: "Référence", email: "Email important" };

export function BrainView() {
  const sp = useSearchParams();
  const router = useRouter();
  const [tab, setTab] = useState<"graph" | "items" | "search">(sp.get("item") ? "items" : "graph");
  return (
    <div className="mx-auto max-w-[1600px] px-1 pt-1 pb-10 md:px-3 md:pt-2">
      <PageHeader title="Second Brain" description="Tes connaissances reliées entre elles : projets, notes, documents, personnes, réunions et idées.">
        <Segmented value={tab} onChange={setTab} options={[{ value: "graph", label: "Graphe", icon: <Network /> }, { value: "items", label: "Connaissances", icon: <Lightbulb /> }, { value: "search", label: "Recherche par le sens", icon: <Search /> }]} />
      </PageHeader>
      {tab === "graph" ? <Graph /> : tab === "items" ? <Items openId={sp.get("item")} onOpen={(id) => router.replace(id ? `/brain?item=${id}` : "/brain", { scroll: false })} /> : <Semantic />}
    </div>
  );
}

/** Graphe de connaissances : simulation de forces légère, zoom/déplacement, clic = ouverture de la source. */
function Graph() {
  const { data } = useQuery({ queryKey: ["brain-graph"], queryFn: () => api.get<{ nodes: GNode[]; edges: GEdge[] }>("/api/brain/graph") });
  const router = useRouter();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<string | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [, tick] = useState(0);
  const sim = useRef<Map<string, { x: number; y: number; vx: number; vy: number }>>(new Map());
  const svg = useRef<SVGSVGElement>(null);
  const W = 1000;
  const H = 620;
  const nodes = useMemo(() => (data?.nodes ?? []).filter((n) => !hidden.has(n.type)), [data, hidden]);
  const edges = useMemo(() => (data?.edges ?? []).filter((e) => nodes.some((n) => n.id === e.source) && nodes.some((n) => n.id === e.target)), [data, nodes]);
  const degree = useMemo(() => {
    const d = new Map<string, number>();
    edges.forEach((e) => (d.set(e.source, (d.get(e.source) ?? 0) + 1), d.set(e.target, (d.get(e.target) ?? 0) + 1)));
    return d;
  }, [edges]);

  useEffect(() => {
    const m = sim.current;
    nodes.forEach((n, i) => {
      if (!m.has(n.id)) m.set(n.id, { x: W / 2 + Math.cos(i) * (100 + i * 3), y: H / 2 + Math.sin(i) * (100 + i * 3), vx: 0, vy: 0 });
    });
    let frame = 0;
    let raf = 0;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const step = () => {
      const ps = nodes.map((n) => [n.id, m.get(n.id)!] as const);
      for (let i = 0; i < ps.length; i++)
        for (let j = i + 1; j < ps.length; j++) {
          const a = ps[i][1];
          const b = ps[j][1];
          const dx = a.x - b.x || 0.01;
          const dy = a.y - b.y || 0.01;
          const d2 = Math.max(dx * dx + dy * dy, 80);
          const f = 1800 / d2;
          a.vx += (dx / Math.sqrt(d2)) * f;
          a.vy += (dy / Math.sqrt(d2)) * f;
          b.vx -= (dx / Math.sqrt(d2)) * f;
          b.vy -= (dy / Math.sqrt(d2)) * f;
        }
      for (const e of edges) {
        const a = m.get(e.source);
        const b = m.get(e.target);
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (d - 90) * 0.012;
        a.vx += (dx / d) * f;
        a.vy += (dy / d) * f;
        b.vx -= (dx / d) * f;
        b.vy -= (dy / d) * f;
      }
      for (const [, p] of ps) {
        p.vx += (W / 2 - p.x) * 0.002;
        p.vy += (H / 2 - p.y) * 0.002;
        p.vx *= 0.82;
        p.vy *= 0.82;
        p.x += p.vx;
        p.y += p.vy;
      }
    };
    if (reduce) {
      for (let i = 0; i < 300; i++) step();
      tick((t) => t + 1);
      return;
    }
    const loop = () => {
      step();
      if (++frame % 2 === 0) tick((t) => t + 1);
      if (frame < 360) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [nodes, edges]);

  const pan = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  if (data && !data.nodes.length)
    return (
      <div className="surface">
        <EmptyState icon={<Network className="size-5" />} title="Graphe vide" description="Associe des tâches, notes, documents et réunions à tes projets, ou relie des éléments entre eux : le graphe se construira automatiquement." />
      </div>
    );
  const neighbors = hover ? new Set(edges.flatMap((e) => (e.source === hover ? [e.target] : e.target === hover ? [e.source] : []))) : null;
  const types = [...new Set((data?.nodes ?? []).map((n) => n.type))];

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-3 py-2">
        {types.map((t) => (
          <button
            key={t}
            onClick={() =>
              setHidden((h) => {
                const n = new Set(h);
                if (n.has(t)) n.delete(t);
                else n.add(t);
                return n;
              })
            }
            className={cn("inline-flex items-center gap-1.5 rounded-[6px] border px-2 py-1 text-[12px]", hidden.has(t) ? "border-line text-fg-3 line-through" : "border-line text-fg-2")}
          >
            <span className="size-2 rounded-full" style={{ background: TYPE_COLOR[t] }} />
            {TYPE_LABEL[t] ?? t} ({data?.nodes.filter((n) => n.type === t).length})
          </button>
        ))}
        <span className="t-meta ml-auto">Molette : zoom · glisser : déplacer · clic : ouvrir</span>
      </div>
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        className="h-[62vh] w-full touch-none bg-bg-2/40"
        onWheel={(e) => {
          const k = Math.min(3, Math.max(0.3, view.k * (e.deltaY > 0 ? 0.9 : 1.1)));
          setView((v) => ({ ...v, k }));
        }}
        onPointerDown={(e) => {
          (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
          pan.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
        }}
        onPointerMove={(e) => pan.current && setView((v) => ({ ...v, x: pan.current!.vx + (e.clientX - pan.current!.x), y: pan.current!.vy + (e.clientY - pan.current!.y) }))}
        onPointerUp={() => (pan.current = null)}
        role="img"
        aria-label="Graphe de connaissances"
      >
        <g transform={`translate(${view.x + (W / 2) * (1 - view.k)} ${view.y + (H / 2) * (1 - view.k)}) scale(${view.k})`}>
          {edges.map((e, i) => {
            const a = sim.current.get(e.source);
            const b = sim.current.get(e.target);
            if (!a || !b) return null;
            const on = hover && (e.source === hover || e.target === hover);
            return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={on ? "var(--accent)" : "var(--line)"} strokeWidth={on ? 1.6 : 1} opacity={hover && !on ? 0.25 : 1} />;
          })}
          {nodes.map((n) => {
            const p = sim.current.get(n.id);
            if (!p) return null;
            const r = 5 + Math.min(10, (degree.get(n.id) ?? 0) * 1.5) + (n.type === "project" ? 4 : 0);
            const dim = neighbors && n.id !== hover && !neighbors.has(n.id);
            return (
              <g
                key={n.id}
                transform={`translate(${p.x} ${p.y})`}
                className="cursor-pointer"
                opacity={dim ? 0.25 : 1}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => router.push(n.href)}
                onMouseEnter={() => setHover(n.id)}
                onMouseLeave={() => setHover(null)}
              >
                <circle r={r} fill={n.color ?? TYPE_COLOR[n.type]} stroke="var(--card)" strokeWidth={2} />
                {(r > 9 || hover === n.id || neighbors?.has(n.id)) && (
                  <text y={r + 13} textAnchor="middle" fontSize={11} fill="var(--fg-2)" style={{ pointerEvents: "none" }}>
                    {n.title.length > 28 ? n.title.slice(0, 27) + "…" : n.title}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
    </Card>
  );
}

function Items({ openId, onOpen }: { openId: string | null; onOpen: (id: string | null) => void }) {
  const [kind, setKind] = useState("");
  const { data } = useQuery({ queryKey: ["brain-items", kind], queryFn: () => api.get<{ items: KItem[] }>(`/api/brain/items${kind ? `?kind=${kind}` : ""}`) });
  const [creating, setCreating] = useState(false);
  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <Select value={kind} onChange={(e) => setKind(e.target.value)} className="w-auto">
          <option value="">Tous les types</option>
          {Object.entries(KINDS).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </Select>
        <Button variant="primary" size="sm" className="ml-auto" icon={<Plus className="size-3.5" />} onClick={() => setCreating(true)}>
          Ajouter
        </Button>
      </div>
      {!data ? null : !data.items.length ? (
        <div className="surface">
          <EmptyState icon={<Lightbulb className="size-5" />} title="Aucune connaissance" description="Ajoute des idées, comptes rendus de réunion, références — ou envoie un email important au Second Brain depuis la boîte de réception." />
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.items.map((k) => (
            <Card key={k.id} className="cursor-pointer p-4 transition-colors hover:border-fg-3/40" onClick={() => onOpen(k.id)}>
              <Badge tone="violet">{KINDS[k.kind] ?? k.kind}</Badge>
              <p className="t-section mt-2 line-clamp-2">{k.title}</p>
              <p className="t-sub mt-1 line-clamp-3 text-[13px]">{k.content}</p>
              <p className="t-meta mt-2">{relativeTime(k.updatedAt)}</p>
            </Card>
          ))}
        </div>
      )}
      <ItemEditor open={creating} onClose={() => setCreating(false)} />
      <ItemSheet id={openId} onClose={() => onOpen(null)} />
    </>
  );
}

function ItemEditor({ open, onClose, item }: { open: boolean; onClose: () => void; item?: KItem }) {
  const [v, setV] = useState({ kind: item?.kind ?? "idea", title: item?.title ?? "", content: item?.content ?? "", tags: (item?.tags ?? []).join(", ") });
  const qc = useQueryClient();
  const { toast } = useToast();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={item ? "Modifier" : "Nouvelle connaissance"}
      size="lg"
      footer={
        <Button
          variant="primary"
          disabled={!v.title.trim()}
          onClick={async () => {
            const body = { ...v, tags: v.tags.split(",").map((t) => t.trim()).filter(Boolean) };
            try {
              if (item) await api.patch(`/api/brain/items/${item.id}`, body);
              else await api.post("/api/brain/items", body);
              qc.invalidateQueries({ queryKey: ["brain-items"] });
              qc.invalidateQueries({ queryKey: ["brain-item"] });
              qc.invalidateQueries({ queryKey: ["brain-graph"] });
              onClose();
            } catch (e) {
              toast({ kind: "error", title: "Enregistrement impossible", description: (e as Error).message });
            }
          }}
        >
          Enregistrer
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Type">
          <Select value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}>
            {Object.entries(KINDS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Titre">
          <Input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} data-autofocus />
        </Field>
        <Field label="Contenu">
          <Textarea value={v.content} onChange={(e) => setV({ ...v, content: e.target.value })} rows={8} />
        </Field>
        <Field label="Étiquettes">
          <Input value={v.tags} onChange={(e) => setV({ ...v, tags: e.target.value })} placeholder="séparées par des virgules" />
        </Field>
      </div>
    </Dialog>
  );
}

function ItemSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data: k } = useQuery({ queryKey: ["brain-item", id], queryFn: () => api.get<KItem & { links: { type: string; id: string; title: string; href: string; linkId: string; relation: string }[] }>(`/api/brain/items/${id}`), enabled: !!id });
  const [edit, setEdit] = useState(false);
  const [del, setDel] = useState(false);
  const [linking, setLinking] = useState(false);
  const qc = useQueryClient();
  const { askAssistant } = useUI();
  return (
    <Sheet
      open={!!id}
      onClose={onClose}
      title={k ? KINDS[k.kind] : ""}
      actions={
        k && (
          <>
            <Button size="sm" variant="ghost" onClick={() => setEdit(true)}>
              Modifier
            </Button>
            <Button size="icon-sm" variant="ghost" onClick={() => setDel(true)} aria-label="Supprimer">
              <Trash2 className="size-4" />
            </Button>
          </>
        )
      }
    >
      {k && (
        <div className="flex flex-col gap-4 p-4">
          <h2 className="t-title">{k.title}</h2>
          <p className="text-[14px] leading-relaxed whitespace-pre-wrap text-fg-2">{k.content}</p>
          {k.sourceType === "email" && k.sourceId && (
            <Link href={`/inbox?message=${k.sourceId}`} className="text-[13px] text-accent">
              Voir l'email d'origine
            </Link>
          )}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <p className="t-label">Relié à</p>
              <Button size="sm" variant="ghost" icon={<Link2 className="size-3.5" />} onClick={() => setLinking(true)}>
                Relier
              </Button>
            </div>
            {!k.links.length && <p className="t-meta">Aucune relation.</p>}
            {k.links.map((l) => (
              <div key={l.linkId} className="flex items-center gap-2 py-1">
                <span className="size-2 rounded-full" style={{ background: TYPE_COLOR[l.type] }} />
                <Link href={l.href} className="flex-1 truncate text-[13px] hover:underline">
                  {l.title}
                </Link>
                <span className="t-meta">{l.relation}</span>
                <button
                  onClick={async () => {
                    await api.del(`/api/brain/links/${l.linkId}`);
                    qc.invalidateQueries({ queryKey: ["brain-item", id] });
                    qc.invalidateQueries({ queryKey: ["brain-graph"] });
                  }}
                  aria-label="Retirer"
                  className="text-fg-3 hover:text-danger"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
          </section>
          <Button size="sm" variant="ghost" icon={<Lightbulb className="size-3.5 text-fg-3" />} onClick={() => (onClose(), askAssistant(`À partir de « ${k.title} » (élément du Second Brain), retrouve les notes, documents et projets liés et propose des relations, avec sources.`))}>
            Suggérer des liens
          </Button>
        </div>
      )}
      {k && <ItemEditor open={edit} onClose={() => setEdit(false)} item={k} />}
      {k && <LinkDialog open={linking} onClose={() => setLinking(false)} from={{ type: "knowledge", id: k.id }} onLinked={() => (qc.invalidateQueries({ queryKey: ["brain-item", id] }), qc.invalidateQueries({ queryKey: ["brain-graph"] }))} />}
      <ConfirmDialog
        open={del}
        onClose={() => setDel(false)}
        danger
        title="Supprimer cet élément ?"
        confirmLabel="Supprimer"
        onConfirm={async () => {
          await api.del(`/api/brain/items/${id}`);
          qc.invalidateQueries({ queryKey: ["brain-items"] });
          qc.invalidateQueries({ queryKey: ["brain-graph"] });
          setDel(false);
          onClose();
        }}
      />
    </Sheet>
  );
}

export function LinkDialog({ open, onClose, from, onLinked }: { open: boolean; onClose: () => void; from: { type: string; id: string }; onLinked: () => void }) {
  const [q, setQ] = useState("");
  const { data } = useQuery({ queryKey: ["link-search", q], queryFn: () => api.get<{ hits: { type: string; id: string; title: string; subtitle?: string }[] }>(`/api/search?q=${encodeURIComponent(q)}&limit=5&types=project,task,note,file,contact,event,knowledge`), enabled: open && q.length > 1 });
  const { toast } = useToast();
  return (
    <Dialog open={open} onClose={onClose} title="Relier à un élément">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un projet, une note, un contact…" data-autofocus />
      <div className="mt-2 max-h-72 overflow-y-auto">
        {data?.hits.filter((h) => !(h.type === from.type && h.id === from.id)).map((h) => (
          <button
            key={`${h.type}-${h.id}`}
            onClick={async () => {
              try {
                await api.post("/api/brain/links", { fromType: from.type, fromId: from.id, toType: h.type, toId: h.id, relation: "related" });
                onLinked();
                onClose();
              } catch (e) {
                toast({ kind: "error", title: "Relation impossible", description: (e as Error).message });
              }
            }}
            className="flex w-full items-center gap-2 rounded-[7px] px-2 py-2 text-left text-[13px] hover:bg-raised"
          >
            <span className="size-2 rounded-full" style={{ background: TYPE_COLOR[h.type] }} />
            <span className="flex-1 truncate">{h.title}</span>
            <Badge>{TYPE_LABEL[h.type] ?? h.type}</Badge>
          </button>
        ))}
      </div>
    </Dialog>
  );
}

function Semantic() {
  const [q, setQ] = useState("");
  const [submitted, setSubmitted] = useState("");
  const { data: integ } = useQuery({ queryKey: ["integrations"], queryFn: () => api.get<{ ai: { embeddings: { name: string; model: string } | null } }>("/api/integrations") });
  const enabled = !!integ?.ai.embeddings;
  const { data, error, isFetching } = useQuery({ queryKey: ["semantic", submitted], queryFn: () => api.get<{ items: { entityType: string; entityId: string; title: string; href: string; score: number; excerpt: string }[] }>(`/api/brain/semantic?q=${encodeURIComponent(submitted)}`), enabled: enabled && submitted.length > 1, retry: false });
  const { data: lexical } = useQuery({ queryKey: ["lexical", submitted], queryFn: () => api.get<{ hits: { type: string; id: string; title: string; subtitle?: string; href: string }[] }>(`/api/search?q=${encodeURIComponent(submitted)}&limit=8`), enabled: !enabled && submitted.length > 1 });
  const [reindexing, setReindexing] = useState(false);
  const { toast } = useToast();
  return (
    <div className="max-w-3xl">
      <form onSubmit={(e) => (e.preventDefault(), setSubmitted(q.trim()))} className="mb-4 flex gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ex. « le document où j'ai parlé des tarifs du site »" />
        <Button type="submit" variant="primary" loading={isFetching} icon={<Search className="size-3.5" />}>
          Rechercher
        </Button>
      </form>
      {!enabled ? (
        <p className="mb-4 rounded-[9px] border border-warning/30 bg-warning/10 px-3 py-2 text-[12.5px] text-warning">
          Recherche sémantique inactive : aucun fournisseur d'embeddings configuré (VOYAGE_API_KEY ou OPENAI_API_KEY). Résultats ci-dessous par mots-clés.
        </p>
      ) : (
        <div className="mb-4 flex items-center gap-2">
          <span className="t-meta">
            Index : {integ?.ai.embeddings?.name} · {integ?.ai.embeddings?.model} (pgvector)
          </span>
          <Button
            size="sm"
            variant="ghost"
            loading={reindexing}
            icon={<RefreshCw className="size-3.5" />}
            onClick={async () => {
              setReindexing(true);
              try {
                const r = await api.post<{ chunks: number }>("/api/brain/reindex");
                toast({ kind: "success", title: "Index mis à jour", description: `${r.chunks} segment(s) indexé(s)` });
              } catch (e) {
                toast({ kind: "error", title: "Réindexation impossible", description: (e as Error).message });
              } finally {
                setReindexing(false);
              }
            }}
          >
            Réindexer
          </Button>
        </div>
      )}
      {error && <p className="text-[13px] text-danger">{(error as Error).message}</p>}
      <div className="flex flex-col gap-2">
        {data?.items.map((h) => (
          <Link key={`${h.entityType}-${h.entityId}`} href={h.href} className="surface block p-3 hover:border-fg-3/40">
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full" style={{ background: TYPE_COLOR[h.entityType] }} />
              <span className="flex-1 truncate text-[13.5px] font-medium">{h.title}</span>
              <Badge tone="accent">{Math.round(h.score * 100)} %</Badge>
            </div>
            <p className="t-meta mt-1 line-clamp-2">{h.excerpt}</p>
          </Link>
        ))}
        {lexical?.hits.map((h) => (
          <Link key={`${h.type}-${h.id}`} href={h.href} className="surface block p-3 hover:border-fg-3/40">
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full" style={{ background: TYPE_COLOR[h.type] }} />
              <span className="flex-1 truncate text-[13.5px] font-medium">{h.title}</span>
              <Badge>{TYPE_LABEL[h.type] ?? h.type}</Badge>
            </div>
            {h.subtitle && <p className="t-meta mt-1 line-clamp-2">{h.subtitle}</p>}
          </Link>
        ))}
        {submitted && !isFetching && !data?.items.length && !lexical?.hits.length && <EmptyState icon={<BrainCircuit className="size-5" />} title="Aucun résultat" />}
      </div>
    </div>
  );
}
