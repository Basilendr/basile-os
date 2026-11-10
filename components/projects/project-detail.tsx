"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Pencil, Trash2, Lightbulb, Plus, NotebookPen, FileText, CalendarDays, Activity as ActivityIcon, Flag, X, ListChecks, Upload } from "lucide-react";
import { api } from "@/lib/client/api";
import { PROJECT_STATUS, PRIORITY } from "@/lib/catalog";
import { formatDueDate, relativeTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardHeader, EmptyState, ErrorState, Skeleton } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/tabs";
import { Dialog, ConfirmDialog } from "@/components/ui/dialog";
import { Checkbox, Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useUI } from "@/components/shell/ui-context";
import { AreaChart, Ring } from "@/components/charts/charts";
import { Kanban } from "@/components/tasks/kanban";
import { TaskDetail } from "@/components/tasks/task-detail";
import { ProjectForm, toProjectPayload, type ProjectFormValue } from "@/components/create/project-form";
import { ProjectIcon } from "./project-icon";
import type { ProjectDetail as PD } from "@/types";

type Tab = "tasks" | "milestones" | "notes" | "files" | "meetings" | "activity";

export function ProjectDetail({ id }: { id: string }) {
  const { data: p, error, refetch } = useQuery({ queryKey: ["project", id], queryFn: () => api.get<PD>(`/api/projects/${id}`) });
  const [tab, setTab] = useState<Tab>("tasks");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { askAssistant, openCreate } = useUI();
  const qc = useQueryClient();
  const router = useRouter();
  const { toast } = useToast();

  if (error) return <ErrorState error={error} onRetry={() => refetch()} className="py-24" />;
  if (!p)
    return (
      <div className="mx-auto max-w-[1600px] space-y-4 px-1 pt-1 pb-10 md:px-3 md:pt-2">
        <Skeleton className="h-36 rounded-[14px]" />
        <Skeleton className="h-64 rounded-[14px]" />
      </div>
    );

  const ai = (prompt: string) => askAssistant(`${prompt} Projet : « ${p.name} » (id ${p.id}).`);

  return (
    <div className="mx-auto max-w-[1600px] px-1 pt-1 pb-10 md:px-3 md:pt-2">
      <Link href="/projects" className="t-meta mb-3 inline-flex items-center gap-1 hover:text-fg">
        <ArrowLeft className="size-3.5" /> Projets
      </Link>
      <div className="surface relative mb-5 overflow-hidden">
        <div className="h-28" style={{ background: p.coverUrl ? undefined : `linear-gradient(120deg, color-mix(in srgb, ${p.color} 35%, var(--card)), var(--card) 70%)` }}>
          {p.coverUrl && <img src={p.coverUrl} alt="" className="size-full object-cover opacity-80" />}
        </div>
        <div className="flex flex-wrap items-end gap-4 px-5 pb-5">
          <span className="-mt-7 grid size-14 place-items-center rounded-[14px] border border-line bg-card shadow-[var(--shadow-md)]" style={{ color: p.color }}>
            <ProjectIcon name={p.icon} className="size-6" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="t-title truncate">{p.name}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <Badge tone="accent">{PROJECT_STATUS[p.status]}</Badge>
              <Badge>Priorité {PRIORITY[p.priority].toLowerCase()}</Badge>
              {p.startDate && <span className="t-meta">Début {formatDueDate(p.startDate)}</span>}
              {p.dueDate && <span className="t-meta">· Échéance {formatDueDate(p.dueDate)}</span>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" icon={<Lightbulb className="size-3.5 text-fg-3" />} onClick={() => ai("Génère un plan d'action structuré en étapes et tâches pour ce projet, en t'appuyant sur ses tâches, notes et documents existants.")}>
              Générer un plan
            </Button>
            <Button size="sm" variant="ghost" onClick={() => ai("Identifie les blocages et retards de ce projet, puis propose les 3 prochaines actions.")}>
              Blocages
            </Button>
            <Button size="sm" variant="ghost" onClick={() => ai("Rédige le rapport hebdomadaire de ce projet : avancement, terminé cette semaine, restant, risques.")}>
              Rapport hebdo
            </Button>
            <Button size="sm" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(true)}>
              Modifier
            </Button>
            <Button size="icon-sm" variant="ghost" onClick={() => setDeleting(true)} aria-label="Supprimer le projet">
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>
        {p.description && <p className="t-sub border-t border-line-soft px-5 py-3 whitespace-pre-wrap">{p.description}</p>}
      </div>

      <div className="mb-5 grid gap-4 lg:grid-cols-12">
        <Card className="flex items-center gap-5 p-5 lg:col-span-4">
          <Ring value={p.stats.progress} size={84} color={p.color} label="Avancement" />
          <div className="grid flex-1 grid-cols-2 gap-3">
            {[
              ["Terminées", p.stats.done],
              ["Restantes", p.stats.remaining],
              ["En retard", p.stats.overdue],
              ["Étapes", `${p.milestones.filter((m) => m.done).length}/${p.milestones.length}`],
            ].map(([l, v]) => (
              <div key={l as string}>
                <p className="t-label">{l}</p>
                <p className="t-num text-[20px] font-semibold">{v}</p>
              </div>
            ))}
          </div>
        </Card>
        <Card className="lg:col-span-8">
          <CardHeader title="Progression dans le temps" subtitle="Tâches terminées cumulées, 12 dernières semaines" />
          <div className="px-4 pb-3">
            <AreaChart
              title="Tâches terminées cumulées par semaine"
              color={p.color}
              height={130}
              data={p.progressSeries.map((s) => ({ label: new Date(s.week).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }), value: s.done }))}
            />
          </div>
        </Card>
      </div>

      <Segmented
        className="mb-4"
        value={tab}
        onChange={setTab}
        options={[
          { value: "tasks", label: "Tâches", icon: <ListChecks />, count: p.tasks.length },
          { value: "milestones", label: "Étapes", icon: <Flag />, count: p.milestones.length },
          { value: "notes", label: "Notes", icon: <NotebookPen />, count: p.notes.length },
          { value: "files", label: "Documents", icon: <FileText />, count: p.files.length },
          { value: "meetings", label: "Réunions", icon: <CalendarDays />, count: p.events.length },
          { value: "activity", label: "Historique", icon: <ActivityIcon /> },
        ]}
      />

      {tab === "tasks" &&
        (p.tasks.length === 0 ? (
          <div className="surface">
            <EmptyState icon={<ListChecks className="size-5" />} title="Aucune tâche" action={<Button variant="primary" size="sm" onClick={() => openCreate("task", { projectId: p.id })}>Ajouter une tâche</Button>} />
          </div>
        ) : (
          <Kanban tasks={p.tasks.map((t) => ({ ...t, projectName: p.name, projectColor: p.color }))} onOpen={setTaskId} projectId={p.id} />
        ))}
      {tab === "milestones" && <Milestones p={p} />}
      {tab === "notes" && (
        <Card className="p-2">
          <div className="flex justify-end p-1">
            <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => openCreate("note", { projectId: p.id, title: `Note — ${p.name}` })}>
              Nouvelle note
            </Button>
          </div>
          {p.notes.length === 0 ? (
            <EmptyState icon={<NotebookPen className="size-5" />} title="Aucune note liée" />
          ) : (
            p.notes.map((n) => (
              <Link key={n.id} href={`/notes?note=${n.id}`} className="flex items-center gap-2.5 rounded-[8px] px-3 py-2.5 hover:bg-raised/60">
                <NotebookPen className="size-4 text-fg-3" />
                <span className="flex-1 truncate text-[13.5px]">{n.title}</span>
                <span className="t-meta">{relativeTime(n.updatedAt)}</span>
              </Link>
            ))
          )}
        </Card>
      )}
      {tab === "files" && (
        <Card className="p-2">
          <div className="flex justify-end p-1">
            <Button size="sm" icon={<Upload className="size-3.5" />} onClick={() => router.push(`/files?upload=1&project=${p.id}`)}>
              Ajouter un document
            </Button>
          </div>
          {p.files.length === 0 ? (
            <EmptyState icon={<FileText className="size-5" />} title="Aucun document lié" description="Associe un fichier à ce projet depuis le gestionnaire de fichiers." />
          ) : (
            p.files.map((f) => (
              <a key={f.id} href={`/files?file=${f.id}`} className="flex items-center gap-2.5 rounded-[8px] px-3 py-2.5 hover:bg-raised/60">
                <FileText className="size-4 text-fg-3" />
                <span className="flex-1 truncate text-[13.5px]">{f.name}</span>
              </a>
            ))
          )}
        </Card>
      )}
      {tab === "meetings" && (
        <Card className="p-2">
          <div className="flex justify-end p-1">
            <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => openCreate("event", { projectId: p.id })}>
              Planifier une réunion
            </Button>
          </div>
          {p.events.length === 0 ? (
            <EmptyState icon={<CalendarDays className="size-5" />} title="Aucune réunion liée" />
          ) : (
            p.events.map((e) => (
              <Link key={e.id} href={`/calendar?event=${e.id}`} className="flex items-center gap-2.5 rounded-[8px] px-3 py-2.5 hover:bg-raised/60">
                <CalendarDays className="size-4 text-fg-3" />
                <span className="flex-1 truncate text-[13.5px]">{e.title}</span>
                <span className="t-meta">{new Date(e.startAt).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}</span>
              </Link>
            ))
          )}
        </Card>
      )}
      {tab === "activity" && (
        <Card className="p-2">
          {p.activity.length === 0 ? (
            <EmptyState icon={<ActivityIcon className="size-5" />} title="Pas encore d'historique" />
          ) : (
            p.activity.map((a) => (
              <div key={a.id} className="flex items-center gap-3 px-3 py-2">
                <span className="size-1.5 rounded-full bg-fg-3" />
                <span className="flex-1 text-[13px] text-fg-2">{a.title}</span>
                <span className="t-meta">{relativeTime(a.createdAt)}</span>
              </div>
            ))
          )}
        </Card>
      )}

      <TaskDetail id={taskId} onClose={() => setTaskId(null)} />
      <EditProject p={p} open={editing} onClose={() => setEditing(false)} />
      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        title={`Supprimer « ${p.name} » ?`}
        description="Le projet et ses étapes seront supprimés. Les tâches, notes et fichiers liés sont conservés mais détachés du projet."
        confirmLabel="Supprimer le projet"
        danger
        onConfirm={async () => {
          try {
            await api.del(`/api/projects/${p.id}`);
            qc.invalidateQueries({ queryKey: ["projects"] });
            toast({ kind: "success", title: "Projet supprimé" });
            router.push("/projects");
          } catch (e) {
            toast({ kind: "error", title: "Suppression impossible", description: (e as Error).message });
          }
        }}
      />
    </div>
  );
}

function EditProject({ p, open, onClose }: { p: PD; open: boolean; onClose: () => void }) {
  const init = (): ProjectFormValue => ({ name: p.name, description: p.description, icon: p.icon, color: p.color, coverUrl: p.coverUrl ?? "", status: p.status, priority: p.priority, startDate: p.startDate ?? "", dueDate: p.dueDate ?? "" });
  const [v, setV] = useState<ProjectFormValue>(init);
  const [loading, setLoading] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Modifier le projet"
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            variant="primary"
            loading={loading}
            onClick={async () => {
              setLoading(true);
              try {
                await api.patch(`/api/projects/${p.id}`, toProjectPayload(v));
                qc.invalidateQueries({ queryKey: ["project", p.id] });
                qc.invalidateQueries({ queryKey: ["projects"] });
                toast({ kind: "success", title: "Projet mis à jour" });
                onClose();
              } catch (e) {
                toast({ kind: "error", title: "Modification impossible", description: (e as Error).message });
              } finally {
                setLoading(false);
              }
            }}
          >
            Enregistrer
          </Button>
        </>
      }
    >
      <ProjectForm value={v} onChange={setV} />
    </Dialog>
  );
}

function Milestones({ p }: { p: PD }) {
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const qc = useQueryClient();
  const { toast } = useToast();
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      qc.invalidateQueries({ queryKey: ["project", p.id] });
    } catch (e) {
      toast({ kind: "error", title: "Étape non enregistrée", description: (e as Error).message });
    }
  };
  return (
    <Card className="p-3">
      <form
        className="mb-2 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) return;
          run(() => api.post(`/api/projects/${p.id}/milestones`, { title: title.trim(), dueDate: due || null }));
          setTitle("");
          setDue("");
        }}
      >
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nouvelle étape (jalon)" className="min-w-0 flex-1" />
        <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="w-40" />
        <Button type="submit" icon={<Plus className="size-3.5" />}>
          Ajouter
        </Button>
      </form>
      {p.milestones.length === 0 ? (
        <EmptyState icon={<Flag className="size-5" />} title="Aucune étape" description="Découpe le projet en jalons pour suivre son avancement." />
      ) : (
        <ol className="relative ml-2 border-l border-line pl-4">
          {p.milestones.map((m) => (
            <li key={m.id} className="group relative flex items-center gap-3 py-2">
              <span className="absolute -left-[21px] size-2.5 rounded-full border-2 border-card" style={{ background: m.done ? "var(--success)" : "var(--line)" }} />
              <Checkbox checked={m.done} onChange={(v) => run(() => api.patch(`/api/milestones/${m.id}`, { done: v }))} />
              <span className={m.done ? "flex-1 text-[13.5px] text-fg-3 line-through" : "flex-1 text-[13.5px]"}>{m.title}</span>
              {m.dueDate && <span className="t-meta">{formatDueDate(m.dueDate)}</span>}
              <button className="text-fg-3 opacity-0 group-hover:opacity-100 hover:text-danger" onClick={() => run(() => api.del(`/api/milestones/${m.id}`))} aria-label="Supprimer l'étape">
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
