"use client";
import { useMemo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { DndContext, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { FolderKanban, LayoutGrid, List, Columns3, GanttChart, Plus } from "lucide-react";
import { PageHeader, EmptyState, ErrorState, Skeleton, Badge, Progress } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useUI } from "@/components/shell/ui-context";
import { useProjects } from "@/hooks/use-data";
import { api } from "@/lib/client/api";
import { PROJECT_STATUS, PRIORITY, type ProjectStatus } from "@/lib/catalog";
import { cn, formatDueDate, parseIsoDate } from "@/lib/utils";
import { ProjectIcon } from "./project-icon";
import type { Project } from "@/types";

type Layout = "grid" | "list" | "board" | "timeline";
const STATUS_TONE = { planning: "violet", active: "accent", paused: "warning", completed: "success", archived: "neutral" } as const;

export function ProjectsView() {
  const sp = useSearchParams();
  const router = useRouter();
  const layout = (sp.get("layout") as Layout) || "grid";
  const archived = sp.get("archived") === "1";
  const { data, error, refetch, isLoading } = useProjects({ archived });
  const { openCreate } = useUI();
  const set = (k: string, v: string | null) => {
    const p = new URLSearchParams(sp.toString());
    if (v) p.set(k, v);
    else p.delete(k);
    router.replace(`/projects?${p}`, { scroll: false });
  };
  const items = data?.items ?? [];

  return (
    <div className="mx-auto max-w-[1600px] px-1 pt-1 pb-10 md:px-3 md:pt-2">
      <PageHeader
        title="Projets"
        description={data ? `${items.filter((p) => p.status === "active").length} actifs · ${items.length} au total` : " "}
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={() => set("archived", archived ? null : "1")}>
              {archived ? "Masquer les archivés" : "Afficher les archivés"}
            </Button>
            <Segmented
              size="sm"
              value={layout}
              onChange={(v) => set("layout", v === "grid" ? null : v)}
              options={[
                { value: "grid", label: "Grille", icon: <LayoutGrid /> },
                { value: "list", label: "Liste", icon: <List /> },
                { value: "board", label: "Kanban", icon: <Columns3 /> },
                { value: "timeline", label: "Chronologie", icon: <GanttChart /> },
              ]}
            />
            <Button variant="primary" size="sm" icon={<Plus className="size-3.5" />} onClick={() => openCreate("project")}>
              Nouveau projet
            </Button>
          </>
        }
      />
      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40 rounded-[12px]" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="surface">
          <EmptyState icon={<FolderKanban className="size-5" />} title="Aucun projet" description="Crée ton premier projet pour regrouper tâches, notes, documents et réunions." action={<Button variant="primary" onClick={() => openCreate("project")}>Créer un projet</Button>} />
        </div>
      ) : layout === "grid" ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((p) => (
            <ProjectCard key={p.id} p={p} />
          ))}
        </div>
      ) : layout === "list" ? (
        <ProjectList items={items} />
      ) : layout === "board" ? (
        <ProjectBoard items={items} />
      ) : (
        <ProjectTimeline items={items} />
      )}
    </div>
  );
}

function ProjectCard({ p }: { p: Project }) {
  return (
    <Link href={`/projects/${p.id}`} className="surface focus-ring group flex flex-col overflow-hidden transition-colors hover:border-fg-3/40">
      <div className="relative h-20 shrink-0" style={{ background: p.coverUrl ? undefined : `linear-gradient(135deg, color-mix(in srgb, ${p.color} 30%, var(--card)), var(--card))` }}>
        {p.coverUrl && <img src={p.coverUrl} alt="" className="size-full object-cover opacity-80" />}
        <span className="absolute -bottom-4 left-4 grid size-9 place-items-center rounded-[10px] border border-line bg-card" style={{ color: p.color }}>
          <ProjectIcon name={p.icon} className="size-4.5" />
        </span>
      </div>
      <div className="flex flex-1 flex-col p-4 pt-6">
        <div className="flex items-start justify-between gap-2">
          <h3 className="t-section truncate">{p.name}</h3>
          <Badge tone={STATUS_TONE[p.status]}>{PROJECT_STATUS[p.status]}</Badge>
        </div>
        <p className="t-sub mt-1 line-clamp-2 min-h-[2.6em] text-[13px]">{p.description || "Pas de description."}</p>
        <div className="mt-auto pt-3">
          <div className="t-meta mb-1.5 flex justify-between">
            <span>
              {p.taskDone}/{p.taskTotal} tâches{p.taskOverdue ? ` · ${p.taskOverdue} en retard` : ""}
            </span>
            <span className="t-num">{p.progress}%</span>
          </div>
          <Progress value={p.progress} color={p.color} />
          {p.dueDate && <p className="t-meta mt-2">Échéance {formatDueDate(p.dueDate)}</p>}
        </div>
      </div>
    </Link>
  );
}

function ProjectList({ items }: { items: Project[] }) {
  return (
    <div className="surface overflow-hidden">
      <div className="t-label hidden grid-cols-[1fr_120px_110px_140px_110px] gap-4 border-b border-line-soft px-4 py-2.5 md:grid">
        <span>Projet</span>
        <span>Statut</span>
        <span>Priorité</span>
        <span>Avancement</span>
        <span>Échéance</span>
      </div>
      {items.map((p) => (
        <Link key={p.id} href={`/projects/${p.id}`} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 border-b border-line-soft px-4 py-3 last:border-0 hover:bg-raised/50 md:grid-cols-[1fr_120px_110px_140px_110px]">
          <span className="flex min-w-0 items-center gap-2.5">
            <ProjectIcon name={p.icon} className="size-4 shrink-0" style={{ color: p.color }} />
            <span className="truncate text-[13.5px] font-medium">{p.name}</span>
          </span>
          <span>
            <Badge tone={STATUS_TONE[p.status]}>{PROJECT_STATUS[p.status]}</Badge>
          </span>
          <span className="t-meta hidden md:block">{PRIORITY[p.priority]}</span>
          <span className="hidden items-center gap-2 md:flex">
            <Progress value={p.progress} color={p.color} className="w-20" />
            <span className="t-num text-[12px] text-fg-2">{p.progress}%</span>
          </span>
          <span className="t-meta hidden md:block">{p.dueDate ? formatDueDate(p.dueDate) : "—"}</span>
        </Link>
      ))}
    </div>
  );
}

const BOARD: ProjectStatus[] = ["planning", "active", "paused", "completed"];

function ProjectBoard({ items }: { items: Project[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }));
  const onEnd = async (e: DragEndEvent) => {
    const status = e.over?.id as ProjectStatus | undefined;
    const p = items.find((x) => x.id === e.active.id);
    if (!status || !p || p.status === status) return;
    qc.setQueryData<{ items: Project[] }>(["projects", { archived: false }], (d) => d && { items: d.items.map((x) => (x.id === p.id ? { ...x, status } : x)) });
    try {
      await api.patch(`/api/projects/${p.id}`, { status });
    } catch (err) {
      toast({ kind: "error", title: "Statut non modifié", description: (err as Error).message });
    }
    qc.invalidateQueries({ queryKey: ["projects"] });
  };
  return (
    <DndContext sensors={sensors} onDragEnd={onEnd}>
      <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-4 md:mx-0 md:grid md:grid-cols-4 md:px-0">
        {BOARD.map((s) => (
          <BoardColumn key={s} status={s} items={items.filter((p) => p.status === s)} />
        ))}
      </div>
    </DndContext>
  );
}

function BoardColumn({ status, items }: { status: ProjectStatus; items: Project[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div ref={setNodeRef} className={cn("flex w-[80vw] shrink-0 snap-start flex-col gap-2 rounded-[12px] border border-line-soft bg-bg-2/60 p-2 md:w-auto", isOver && "bg-accent/5")}>
      <div className="flex items-center gap-2 px-1.5 pt-1 pb-1 text-[13px] font-medium">
        {PROJECT_STATUS[status]} <span className="t-num text-[12px] text-fg-3">{items.length}</span>
      </div>
      {items.map((p) => (
        <DraggableProject key={p.id} p={p} />
      ))}
    </div>
  );
}

function DraggableProject({ p }: { p: Project }) {
  const router = useRouter();
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: p.id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => router.push(`/projects/${p.id}`)}
      style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined}
      className={cn("cursor-grab rounded-[10px] border border-line bg-card p-3", isDragging && "z-10 shadow-[var(--shadow-lg)]")}
    >
      <div className="flex items-center gap-2">
        <ProjectIcon name={p.icon} className="size-3.5" style={{ color: p.color }} />
        <span className="truncate text-[13px] font-medium">{p.name}</span>
      </div>
      <Progress value={p.progress} color={p.color} className="mt-2.5" />
      <p className="t-meta mt-1.5">
        {p.progress}% · {p.taskDone}/{p.taskTotal} tâches
      </p>
    </div>
  );
}

/** Chronologie : barres début → échéance sur une échelle de mois. */
function ProjectTimeline({ items }: { items: Project[] }) {
  const dated = items.filter((p) => p.startDate || p.dueDate);
  const range = useMemo(() => {
    const ds = dated.flatMap((p) => [p.startDate, p.dueDate].filter(Boolean).map((d) => parseIsoDate(d!).getTime()));
    const now = Date.now();
    const min = Math.min(now, ...ds);
    const max = Math.max(now + 30 * 86400_000, ...ds);
    const start = new Date(min);
    start.setDate(1);
    const end = new Date(max);
    end.setMonth(end.getMonth() + 1, 1);
    return { start: start.getTime(), end: end.getTime() };
  }, [dated]);
  if (!dated.length) return <div className="surface"><EmptyState icon={<GanttChart className="size-5" />} title="Aucun projet daté" description="Ajoute une date de début ou une échéance pour voir la chronologie." /></div>;
  const pct = (t: number) => ((t - range.start) / (range.end - range.start)) * 100;
  const months: Date[] = [];
  for (let d = new Date(range.start); d.getTime() < range.end; d.setMonth(d.getMonth() + 1)) months.push(new Date(d));
  return (
    <div className="surface overflow-x-auto">
      <div className="min-w-[720px] p-4">
        <div className="relative mb-2 ml-[200px] h-5">
          {months.map((m) => (
            <span key={m.toISOString()} className="t-label absolute" style={{ left: `${pct(m.getTime())}%` }}>
              {m.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" })}
            </span>
          ))}
        </div>
        {dated.map((p) => {
          const s = p.startDate ? parseIsoDate(p.startDate).getTime() : parseIsoDate(p.dueDate!).getTime() - 7 * 86400_000;
          const e = p.dueDate ? parseIsoDate(p.dueDate).getTime() + 86400_000 : s + 14 * 86400_000;
          return (
            <Link key={p.id} href={`/projects/${p.id}`} className="group flex h-10 items-center hover:bg-raised/40">
              <span className="flex w-[200px] shrink-0 items-center gap-2 truncate pr-3 text-[13px]">
                <ProjectIcon name={p.icon} className="size-3.5 shrink-0" style={{ color: p.color }} />
                <span className="truncate">{p.name}</span>
              </span>
              <span className="relative h-full flex-1">
                <span className="absolute top-0 bottom-0 w-px bg-danger/50" style={{ left: `${pct(Date.now())}%` }} />
                <span
                  className="absolute top-1/2 h-5 -translate-y-1/2 overflow-hidden rounded-[6px]"
                  style={{ left: `${pct(s)}%`, width: `${Math.max(1, pct(e) - pct(s))}%`, background: `color-mix(in srgb, ${p.color} 25%, transparent)`, border: `1px solid color-mix(in srgb, ${p.color} 50%, transparent)` }}
                >
                  <span className="block h-full" style={{ width: `${p.progress}%`, background: `color-mix(in srgb, ${p.color} 55%, transparent)` }} />
                </span>
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
