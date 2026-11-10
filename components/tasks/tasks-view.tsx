"use client";
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { CheckCircle2, LayoutList, Columns3, Plus, Search, Lightbulb, Sun, CalendarClock, ListTodo, AlertTriangle, CheckCheck, FolderKanban } from "lucide-react";
import { PageHeader, EmptyState, ErrorState, Skeleton, Dot } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useUI } from "@/components/shell/ui-context";
import { useTasks, useUpdateTask, type TaskView } from "@/hooks/use-data";
import { api } from "@/lib/client/api";
import * as chrono from "chrono-node";
import { isoDate } from "@/lib/utils";
import { TaskRow } from "./task-row";
import { TaskDetail } from "./task-detail";
import { Kanban } from "./kanban";
import type { Task } from "@/types";

const VIEWS: { value: TaskView; label: string; icon: React.ReactNode; key: keyof NonNullable<ReturnType<typeof useTasks>["data"]>["counts"] }[] = [
  { value: "today", label: "Ma journée", icon: <Sun />, key: "today" },
  { value: "upcoming", label: "À venir", icon: <CalendarClock />, key: "upcoming" },
  { value: "all", label: "Toutes", icon: <ListTodo />, key: "all" },
  { value: "overdue", label: "En retard", icon: <AlertTriangle />, key: "overdue" },
  { value: "done", label: "Terminées", icon: <CheckCheck />, key: "done" },
  { value: "project", label: "Par projet", icon: <FolderKanban />, key: "open" },
];

export function TasksView() {
  const sp = useSearchParams();
  const router = useRouter();
  const view = (sp.get("view") as TaskView) || "today";
  const layout = sp.get("layout") === "board" ? "board" : "list";
  const openId = sp.get("task");
  const [q, setQ] = useState("");
  const { data, error, refetch, isLoading } = useTasks({ view: layout === "board" ? "all" : view === "project" ? "all" : view, q: q || undefined });
  const update = useUpdateTask();
  const { askAssistant } = useUI();

  const setParam = (k: string, v: string | null) => {
    const p = new URLSearchParams(sp.toString());
    if (v) p.set(k, v);
    else p.delete(k);
    router.replace(`/tasks?${p}`, { scroll: false });
  };

  const items = useMemo(() => {
    const list = data?.items ?? [];
    return view === "project" && layout === "list" ? list.filter((t) => t.status !== "done") : list;
  }, [data, view, layout]);

  const groups = useMemo(() => {
    if (view !== "project") return null;
    const m = new Map<string, { name: string; color: string; tasks: Task[] }>();
    for (const t of items) {
      const k = t.projectId ?? "none";
      if (!m.has(k)) m.set(k, { name: t.projectName ?? "Sans projet", color: t.projectColor ?? "var(--fg-3)", tasks: [] });
      m.get(k)!.tasks.push(t);
    }
    return [...m.entries()].sort((a, b) => (a[0] === "none" ? 1 : b[0] === "none" ? -1 : a[1].name.localeCompare(b[1].name)));
  }, [items, view]);

  return (
    <div className="mx-auto max-w-[1600px] px-1 pt-1 pb-10 md:px-3 md:pt-2">
      <PageHeader
        title="Tâches"
        description={data ? `${data.counts.open} ouvertes · ${data.counts.doneToday} terminée${data.counts.doneToday > 1 ? "s" : ""} aujourd'hui${data.counts.overdue ? ` · ${data.counts.overdue} en retard` : ""}` : " "}
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              icon={<Lightbulb className="size-3.5 text-fg-3" />}
              onClick={() => askAssistant("Analyse mes tâches ouvertes : identifie les retards, propose un ordre de priorité pour aujourd'hui et la prochaine action.")}
            >
              Prioriser
            </Button>
            <Segmented
              size="sm"
              value={layout}
              onChange={(v) => setParam("layout", v === "list" ? null : v)}
              options={[
                { value: "list", label: "Liste", icon: <LayoutList /> },
                { value: "board", label: "Kanban", icon: <Columns3 /> },
              ]}
            />
          </>
        }
      >
        {layout === "list" && (
          <Segmented
            value={view}
            onChange={(v) => setParam("view", v)}
            options={VIEWS.map((v) => ({ value: v.value, label: v.label, icon: v.icon, count: data?.counts[v.key] }))}
          />
        )}
      </PageHeader>

      <QuickAdd view={view} />

      <div className="relative mb-3 max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-fg-3" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrer les tâches…" className="pl-8" />
      </div>

      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : layout === "board" ? (
        <Kanban tasks={items} onOpen={(id) => setParam("task", id)} />
      ) : items.length === 0 ? (
        <div className="surface">
          <EmptyState
            icon={<CheckCircle2 className="size-5" />}
            title={view === "today" ? "Rien de prévu aujourd'hui" : view === "overdue" ? "Aucune tâche en retard" : view === "done" ? "Aucune tâche terminée" : "Aucune tâche"}
            description="Ajoute une tâche ci-dessus — tu peux écrire « demain 14h » ou « vendredi » pour fixer l'échéance."
          />
        </div>
      ) : groups ? (
        <div className="space-y-4">
          {groups.map(([k, g]) => (
            <section key={k} className="surface p-1.5">
              <h3 className="flex items-center gap-2 px-3 pt-2 pb-1 text-[13px] font-medium">
                <Dot color={g.color} />
                {g.name}
                <span className="t-meta">{g.tasks.length}</span>
              </h3>
              <TaskList tasks={g.tasks} onOpen={(id) => setParam("task", id)} onToggle={(t, v) => update.mutate({ id: t.id, patch: { status: v ? "done" : "todo" } })} selected={openId} />
            </section>
          ))}
        </div>
      ) : (
        <div className="surface p-1.5">
          <TaskList tasks={items} onOpen={(id) => setParam("task", id)} onToggle={(t, v) => update.mutate({ id: t.id, patch: { status: v ? "done" : "todo" } })} selected={openId} />
        </div>
      )}

      <TaskDetail id={openId} onClose={() => setParam("task", null)} />
    </div>
  );
}

function TaskList({ tasks, onOpen, onToggle, selected }: { tasks: Task[]; onOpen: (id: string) => void; onToggle: (t: Task, v: boolean) => void; selected: string | null }) {
  return (
    <AnimatePresence initial={false}>
      {tasks.map((t) => (
        <motion.div key={t.id} layout="position" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} transition={{ type: "spring", bounce: 0, visualDuration: 0.25 }}>
          <TaskRow t={t} onOpen={() => onOpen(t.id)} onToggle={(v) => onToggle(t, v)} selected={selected === t.id} />
        </motion.div>
      ))}
    </AnimatePresence>
  );
}

/** Saisie rapide avec compréhension des dates en français (« demain 14h », « vendredi »). */
function QuickAdd({ view }: { view: TaskView }) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();
  const parsed = useMemo(() => {
    const r = chrono.fr.parse(text, new Date(), { forwardDate: true })[0];
    if (!r) return null;
    const d = r.start.date();
    const hasTime = r.start.isCertain("hour");
    return { date: isoDate(d), time: hasTime ? `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : null, text: r.text };
  }, [text]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = text.trim();
    if (!raw) return;
    const priority = /!urgent|!!!/.test(raw) ? "urgent" : /!haute|!!/.test(raw) ? "high" : undefined;
    const title = (parsed ? raw.replace(parsed.text, "") : raw).replace(/!urgent|!haute|!!!|!!/g, "").replace(/\s+/g, " ").trim() || raw;
    setLoading(true);
    try {
      await api.post("/api/tasks", {
        title,
        dueDate: parsed?.date ?? (view === "today" ? isoDate() : null),
        dueTime: parsed?.time ?? null,
        ...(priority ? { priority } : {}),
      });
      setText("");
      ["tasks", "dashboard", "activity", "projects"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    } catch (err) {
      toast({ kind: "error", title: "Tâche non créée", description: (err as Error).message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="surface mb-4 flex items-center gap-2 p-1.5 pl-3">
      <Plus className="size-4 shrink-0 text-fg-3" />
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Ajouter une tâche… (ex. « Appeler le comptable demain 10h !haute »)"
        className="h-9 min-w-0 flex-1 bg-transparent text-[13.5px] placeholder:text-fg-3 focus:outline-none"
      />
      {parsed && (
        <span className="t-meta hidden shrink-0 rounded-[6px] bg-raised px-2 py-1 sm:block">
          {new Date(parsed.date + "T00:00:00").toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })}
          {parsed.time && ` · ${parsed.time}`}
        </span>
      )}
      <Button type="submit" variant="primary" size="sm" loading={loading} disabled={!text.trim()}>
        Ajouter
      </Button>
    </form>
  );
}
