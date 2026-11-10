"use client";
import { useEffect, useMemo, useState } from "react";
import { DndContext, DragOverlay, PointerSensor, KeyboardSensor, TouchSensor, closestCorners, useDroppable, useSensor, useSensors, type DragEndEvent, type DragOverEvent, type DragStartEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { TASK_STATUS, PRIORITY, type TaskStatus } from "@/lib/catalog";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { useUI } from "@/components/shell/ui-context";
import { TaskMeta, PRIORITY_TONE } from "./task-row";
import type { Task } from "@/types";

const COLUMNS: TaskStatus[] = ["todo", "in_progress", "review", "done"];
const COL_COLOR: Record<TaskStatus, string> = { todo: "var(--fg-3)", in_progress: "var(--accent)", review: "var(--warning)", done: "var(--success)" };

/** Tableau Kanban : glisser-déposer entre colonnes (statut) et dans une colonne (ordre), persisté côté serveur. */
export function Kanban({ tasks, onOpen, projectId }: { tasks: Task[]; onOpen: (id: string) => void; projectId?: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { openCreate } = useUI();
  const grouped = useMemo(() => {
    const g: Record<TaskStatus, Task[]> = { todo: [], in_progress: [], review: [], done: [] };
    for (const t of [...tasks].sort((a, b) => a.position - b.position)) g[t.status].push(t);
    return g;
  }, [tasks]);
  const [cols, setCols] = useState(grouped);
  const [active, setActive] = useState<Task | null>(null);
  useEffect(() => setCols(grouped), [grouped]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const findCol = (id: string): TaskStatus | null => (COLUMNS.includes(id as TaskStatus) ? (id as TaskStatus) : (COLUMNS.find((c) => cols[c].some((t) => t.id === id)) ?? null));

  const onStart = (e: DragStartEvent) => setActive(tasks.find((t) => t.id === e.active.id) ?? null);

  const onOver = (e: DragOverEvent) => {
    const from = findCol(String(e.active.id));
    const to = e.over ? findCol(String(e.over.id)) : null;
    if (!from || !to || from === to) return;
    setCols((c) => {
      const item = c[from].find((t) => t.id === e.active.id)!;
      const overIdx = c[to].findIndex((t) => t.id === e.over!.id);
      const next = [...c[to]];
      next.splice(overIdx < 0 ? next.length : overIdx, 0, { ...item, status: to });
      return { ...c, [from]: c[from].filter((t) => t.id !== e.active.id), [to]: next };
    });
  };

  const onEnd = async (e: DragEndEvent) => {
    setActive(null);
    const col = findCol(String(e.active.id));
    if (!col) return;
    let list = cols[col];
    if (e.over && e.over.id !== e.active.id && !COLUMNS.includes(e.over.id as TaskStatus)) {
      const a = list.findIndex((t) => t.id === e.active.id);
      const b = list.findIndex((t) => t.id === e.over!.id);
      if (a >= 0 && b >= 0) list = arrayMove(list, a, b);
    }
    setCols((c) => ({ ...c, [col]: list }));
    const original = tasks.find((t) => t.id === e.active.id);
    const moves = list.map((t, i) => ({ id: t.id, position: i + 1, ...(t.id === e.active.id && original?.status !== col ? { status: col } : {}) }));
    try {
      await api.post("/api/tasks/move", { moves });
    } catch (err) {
      setCols(grouped);
      toast({ kind: "error", title: "Déplacement non enregistré", description: (err as Error).message });
    } finally {
      ["tasks", "projects", "project", "dashboard", "activity"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    }
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onStart} onDragOver={onOver} onDragEnd={onEnd} onDragCancel={() => (setActive(null), setCols(grouped))}>
      <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-4 md:mx-0 md:grid md:grid-cols-4 md:overflow-visible md:px-0">
        {COLUMNS.map((c) => (
          <Column key={c} status={c} tasks={cols[c]} onOpen={onOpen} onAdd={() => openCreate("task", { status: c, projectId: projectId ?? "" })} />
        ))}
      </div>
      <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(.2,.8,.2,1)" }}>{active ? <Card t={active} dragging /> : null}</DragOverlay>
    </DndContext>
  );
}

function Column({ status, tasks, onOpen, onAdd }: { status: TaskStatus; tasks: Task[]; onOpen: (id: string) => void; onAdd: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div className="flex w-[82vw] shrink-0 snap-start flex-col rounded-[12px] border border-line-soft bg-bg-2/60 md:w-auto">
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <span className="size-2 rounded-full" style={{ background: COL_COLOR[status] }} />
        <span className="text-[13px] font-medium">{TASK_STATUS[status]}</span>
        <span className="t-num text-[12px] text-fg-3">{tasks.length}</span>
        <button onClick={onAdd} className="ml-auto grid size-6 place-items-center rounded-[6px] text-fg-3 hover:bg-raised hover:text-fg" aria-label={`Ajouter dans ${TASK_STATUS[status]}`}>
          <Plus className="size-3.5" />
        </button>
      </div>
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className={cn("flex min-h-[120px] flex-1 flex-col gap-2 rounded-b-[12px] p-2 transition-colors", isOver && "bg-accent/5")}>
          {tasks.map((t) => (
            <SortableCard key={t.id} t={t} onOpen={() => onOpen(t.id)} />
          ))}
          {tasks.length === 0 && <p className="t-meta py-6 text-center">Dépose une tâche ici</p>}
        </div>
      </SortableContext>
    </div>
  );
}

function SortableCard({ t, onOpen }: { t: Task; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: t.id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} {...attributes} {...listeners} className={cn("touch-manipulation", isDragging && "opacity-30")} onClick={onOpen}>
      <Card t={t} />
    </div>
  );
}

function Card({ t, dragging }: { t: Task; dragging?: boolean }) {
  return (
    <div
      className={cn(
        "cursor-grab rounded-[10px] border border-line bg-card p-3 transition-shadow hover:border-fg-3/40 active:cursor-grabbing",
        dragging && "rotate-[1.5deg] shadow-[var(--shadow-lg)]",
      )}
    >
      <p className={cn("text-[13px] leading-snug font-medium", t.status === "done" && "text-fg-3 line-through")}>{t.title}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {t.priority !== "medium" && <Badge tone={PRIORITY_TONE[t.priority]}>{PRIORITY[t.priority]}</Badge>}
      </div>
      <div className="mt-1.5">
        <TaskMeta t={t} />
      </div>
    </div>
  );
}
