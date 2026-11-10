"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, Plus, X, Lightbulb, Paperclip, FileText, ExternalLink } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { useUI } from "@/components/shell/ui-context";
import { api } from "@/lib/client/api";
import { PRIORITY, TASK_STATUS } from "@/lib/catalog";
import { relativeTime } from "@/lib/utils";
import { useProjects, useUpdateTask } from "@/hooks/use-data";
import type { TaskDetail as TD } from "@/types";

const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function TaskDetail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { askAssistant } = useUI();
  const update = useUpdateTask();
  const { data: projects } = useProjects();
  const { data: task } = useQuery({ queryKey: ["task", id], queryFn: () => api.get<TD>(`/api/tasks/${id}`), enabled: !!id });
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [newSub, setNewSub] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);

  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDesc(task.description);
    }
  }, [task?.id, task?.title, task?.description]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["task", id] });
    qc.invalidateQueries({ queryKey: ["tasks"] });
  };
  const patch = (p: Record<string, unknown>) => id && update.mutate({ id, patch: p }, { onSuccess: () => qc.invalidateQueries({ queryKey: ["task", id] }) });

  const subAction = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      refresh();
    } catch (e) {
      toast({ kind: "error", title: "Sous-tâche non enregistrée", description: (e as Error).message });
    }
  };

  return (
    <Sheet
      open={!!id}
      onClose={onClose}
      title={task ? TASK_STATUS[task.status] : "Tâche"}
      actions={
        task && (
          <>
            <Button
              variant="ghost"
              size="sm"
              icon={<Lightbulb className="size-3.5 text-fg-3" />}
              onClick={() => askAssistant(`Aide-moi avec la tâche « ${task.title} » (id ${task.id}) : propose une décomposition en étapes et la prochaine action concrète.`)}
            >
              Assistant
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => setConfirmDelete(true)} aria-label="Supprimer">
              <Trash2 className="size-4" />
            </Button>
          </>
        )
      }
    >
      {!task ? (
        <div className="space-y-3 p-4">
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="h-20" />
        </div>
      ) : (
        <div className="flex flex-col gap-4 p-4">
          <div className="flex items-start gap-3">
            <Checkbox className="mt-2" checked={task.status === "done"} onChange={(v) => patch({ status: v ? "done" : "todo" })} label="Terminer" />
            <textarea
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => title.trim() && title !== task.title && patch({ title: title.trim() })}
              rows={1}
              className="t-title w-full resize-none bg-transparent focus:outline-none"
              aria-label="Titre"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Statut">
              <Select value={task.status} onChange={(e) => patch({ status: e.target.value })}>
                {Object.entries(TASK_STATUS).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Priorité">
              <Select value={task.priority} onChange={(e) => patch({ priority: e.target.value })}>
                {Object.entries(PRIORITY).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Échéance">
              <Input type="date" value={task.dueDate ?? ""} onChange={(e) => patch({ dueDate: e.target.value || null })} />
            </Field>
            <Field label="Heure">
              <Input type="time" value={task.dueTime ?? ""} onChange={(e) => patch({ dueTime: e.target.value || null })} />
            </Field>
            <Field label="Projet">
              <Select value={task.projectId ?? ""} onChange={(e) => patch({ projectId: e.target.value || null })}>
                <option value="">Aucun</option>
                {projects?.items.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Catégorie">
              <Input defaultValue={task.category ?? ""} key={task.category ?? ""} onBlur={(e) => e.target.value !== (task.category ?? "") && patch({ category: e.target.value.trim() || null })} />
            </Field>
            <Field label="Rappel" className="col-span-2">
              <Input type="datetime-local" value={toLocalInput(task.reminderAt)} onChange={(e) => patch({ reminderAt: e.target.value ? new Date(e.target.value).toISOString() : null })} />
            </Field>
          </div>
          <Field label="Description">
            <Textarea value={desc} onChange={(e) => setDesc(e.target.value)} onBlur={() => desc !== task.description && patch({ description: desc })} rows={5} placeholder="Ajoute du contexte…" />
          </Field>

          <section>
            <p className="t-label mb-2">
              Sous-tâches · {task.subtasks.filter((s) => s.done).length}/{task.subtasks.length}
            </p>
            <div className="flex flex-col gap-0.5">
              {task.subtasks.map((s) => (
                <div key={s.id} className="group flex items-center gap-2.5 rounded-[7px] px-1.5 py-1.5 hover:bg-raised/60">
                  <Checkbox checked={s.done} onChange={(v) => subAction(() => api.patch(`/api/subtasks/${s.id}`, { done: v }))} />
                  <span className={s.done ? "flex-1 text-[13px] text-fg-3 line-through" : "flex-1 text-[13px]"}>{s.title}</span>
                  <button className="text-fg-3 opacity-0 group-hover:opacity-100 hover:text-danger" onClick={() => subAction(() => api.del(`/api/subtasks/${s.id}`))} aria-label="Supprimer la sous-tâche">
                    <X className="size-3.5" />
                  </button>
                </div>
              ))}
              <form
                className="mt-1 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!newSub.trim()) return;
                  const t = newSub.trim();
                  setNewSub("");
                  subAction(() => api.post(`/api/tasks/${task.id}/subtasks`, { title: t }));
                }}
              >
                <Input value={newSub} onChange={(e) => setNewSub(e.target.value)} placeholder="Nouvelle sous-tâche" />
                <Button size="icon" type="submit" aria-label="Ajouter">
                  <Plus className="size-4" />
                </Button>
              </form>
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <p className="t-label">Pièces jointes</p>
              <Button size="sm" variant="ghost" icon={<Paperclip className="size-3.5" />} onClick={() => setAttachOpen(true)}>
                Joindre
              </Button>
            </div>
            {task.attachments.length === 0 ? (
              <p className="t-meta">Aucune pièce jointe.</p>
            ) : (
              task.attachments.map((a) => (
                <div key={a.fileId} className="group flex items-center gap-2 rounded-[7px] px-1.5 py-1.5 hover:bg-raised/60">
                  <FileText className="size-3.5 text-fg-3" />
                  <a href={`/api/files/${a.fileId}/content`} target="_blank" className="flex-1 truncate text-[13px] hover:underline">
                    {a.name}
                  </a>
                  <button className="text-fg-3 opacity-0 group-hover:opacity-100 hover:text-danger" onClick={() => patch({ attachments: task.attachments.filter((x) => x.fileId !== a.fileId) })} aria-label="Retirer">
                    <X className="size-3.5" />
                  </button>
                </div>
              ))
            )}
          </section>

          {task.sourceType && (
            <p className="t-meta">
              Créée depuis : {task.sourceType === "email" ? <Link href={`/inbox?message=${task.sourceId}`} className="text-accent">un email <ExternalLink className="inline size-3" /></Link> : task.sourceType === "note" ? <Link href={`/notes?note=${task.sourceId}`} className="text-accent">une note</Link> : task.sourceType}
            </p>
          )}
          <p className="t-meta">
            Créée {relativeTime(task.createdAt)} · modifiée {relativeTime(task.updatedAt)}
            {task.completedAt && ` · terminée ${relativeTime(task.completedAt)}`}
          </p>
        </div>
      )}
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Supprimer cette tâche ?"
        description="La tâche et ses sous-tâches seront définitivement supprimées."
        confirmLabel="Supprimer"
        danger
        onConfirm={async () => {
          try {
            await api.del(`/api/tasks/${id}`);
            setConfirmDelete(false);
            onClose();
            refresh();
            qc.invalidateQueries({ queryKey: ["dashboard"] });
            toast({ kind: "success", title: "Tâche supprimée" });
          } catch (e) {
            toast({ kind: "error", title: "Suppression impossible", description: (e as Error).message });
          }
        }}
      />
      {task && <AttachPicker open={attachOpen} onClose={() => setAttachOpen(false)} onPick={(f) => (patch({ attachments: [...task.attachments.filter((a) => a.fileId !== f.id), { fileId: f.id, name: f.name }] }), setAttachOpen(false))} />}
    </Sheet>
  );
}

export function AttachPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (f: { id: string; name: string }) => void }) {
  const [q, setQ] = useState("");
  const { data } = useQuery({
    queryKey: ["files-picker", q],
    queryFn: () => api.get<{ items: { id: string; name: string; isFolder: boolean; kind: string }[] }>(`/api/files?${q ? `q=${encodeURIComponent(q)}` : "sort=updated"}`),
    enabled: open,
  });
  return (
    <Dialog open={open} onClose={onClose} title="Joindre un fichier" description="Choisis un fichier du gestionnaire de fichiers.">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un fichier…" data-autofocus />
      <div className="mt-3 max-h-72 overflow-y-auto">
        {data?.items.filter((f) => !f.isFolder).length === 0 && (
          <p className="t-meta py-6 text-center">
            Aucun fichier. <Link href="/files?upload=1" className="text-accent">Importer un fichier</Link>
          </p>
        )}
        {data?.items
          .filter((f) => !f.isFolder)
          .map((f) => (
            <button key={f.id} onClick={() => onPick(f)} className="flex w-full items-center gap-2 rounded-[7px] px-2 py-2 text-left text-[13px] hover:bg-raised">
              <FileText className="size-4 text-fg-3" />
              {f.name}
            </button>
          ))}
      </div>
    </Dialog>
  );
}
