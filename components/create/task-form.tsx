"use client";
import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PRIORITY, TASK_STATUS, type Priority, type TaskStatus } from "@/lib/catalog";
import { useProjects } from "@/hooks/use-data";

export type TaskFormValue = {
  title: string;
  description: string;
  priority: Priority;
  status: TaskStatus;
  dueDate: string;
  dueTime: string;
  category: string;
  projectId: string;
  reminderAt: string;
  subtasks: string[];
};

export const emptyTask = (d: Partial<TaskFormValue> = {}): TaskFormValue => ({
  title: "",
  description: "",
  priority: "medium",
  status: "todo",
  dueDate: "",
  dueTime: "",
  category: "",
  projectId: "",
  reminderAt: "",
  subtasks: [],
  ...d,
});

export function toTaskPayload(v: TaskFormValue) {
  return {
    title: v.title.trim(),
    description: v.description,
    priority: v.priority,
    status: v.status,
    dueDate: v.dueDate || null,
    dueTime: v.dueTime || null,
    category: v.category.trim() || null,
    projectId: v.projectId || null,
    reminderAt: v.reminderAt ? new Date(v.reminderAt).toISOString() : null,
  };
}

export function TaskForm({ value, onChange, withSubtasks = true, errors = {} }: { value: TaskFormValue; onChange: (v: TaskFormValue) => void; withSubtasks?: boolean; errors?: Record<string, string[]> }) {
  const { data: projects } = useProjects();
  const [sub, setSub] = useState("");
  const set = <K extends keyof TaskFormValue>(k: K, v: TaskFormValue[K]) => onChange({ ...value, [k]: v });

  return (
    <div className="flex flex-col gap-3.5">
      <Field label="Titre" error={errors.title?.[0]}>
        <Input value={value.title} onChange={(e) => set("title", e.target.value)} placeholder="Que faut-il faire ?" data-autofocus required maxLength={300} />
      </Field>
      <Field label="Description">
        <Textarea value={value.description} onChange={(e) => set("description", e.target.value)} placeholder="Détails, contexte, liens…" rows={3} />
      </Field>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Priorité">
          <Select value={value.priority} onChange={(e) => set("priority", e.target.value as Priority)}>
            {Object.entries(PRIORITY).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Statut">
          <Select value={value.status} onChange={(e) => set("status", e.target.value as TaskStatus)}>
            {Object.entries(TASK_STATUS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Échéance" error={errors.dueDate?.[0]}>
          <Input type="date" value={value.dueDate} onChange={(e) => set("dueDate", e.target.value)} />
        </Field>
        <Field label="Heure">
          <Input type="time" value={value.dueTime} onChange={(e) => set("dueTime", e.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Projet">
          <Select value={value.projectId} onChange={(e) => set("projectId", e.target.value)}>
            <option value="">Aucun</option>
            {projects?.items.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Catégorie">
          <Input value={value.category} onChange={(e) => set("category", e.target.value)} placeholder="ex. Admin" maxLength={60} />
        </Field>
        <Field label="Rappel">
          <Input type="datetime-local" value={value.reminderAt} onChange={(e) => set("reminderAt", e.target.value)} />
        </Field>
      </div>
      {withSubtasks && (
        <Field label="Sous-tâches">
          <div className="flex flex-col gap-1.5">
            {value.subtasks.map((s, i) => (
              <div key={i} className="flex items-center gap-2 rounded-[7px] border border-line-soft bg-bg-2 px-2.5 py-1.5 text-[13px]">
                <span className="flex-1 truncate">{s}</span>
                <button type="button" className="text-fg-3 hover:text-danger" onClick={() => set("subtasks", value.subtasks.filter((_, j) => j !== i))} aria-label="Retirer">
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
            <div className="flex gap-2">
              <Input
                value={sub}
                onChange={(e) => setSub(e.target.value)}
                placeholder="Ajouter une sous-tâche"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && sub.trim()) {
                    e.preventDefault();
                    set("subtasks", [...value.subtasks, sub.trim()]);
                    setSub("");
                  }
                }}
              />
              <Button size="icon" type="button" onClick={() => sub.trim() && (set("subtasks", [...value.subtasks, sub.trim()]), setSub(""))} aria-label="Ajouter">
                <Plus className="size-4" />
              </Button>
            </div>
          </div>
        </Field>
      )}
    </div>
  );
}
