"use client";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { PRIORITY, PROJECT_STATUS, type Priority, type ProjectStatus } from "@/lib/catalog";
import { cn } from "@/lib/utils";
import { ProjectIcon, PROJECT_ICONS } from "@/components/projects/project-icon";

export const PROJECT_COLORS = ["#6385FF", "#9B8CFF", "#3DD68C", "#F5A524", "#F2555A", "#38BDF8", "#F472B6", "#A3E635", "#A1A1AA"];

export type ProjectFormValue = {
  name: string;
  description: string;
  icon: string;
  color: string;
  coverUrl: string;
  status: ProjectStatus;
  priority: Priority;
  startDate: string;
  dueDate: string;
};

export const emptyProject = (d: Partial<ProjectFormValue> = {}): ProjectFormValue => ({
  name: "",
  description: "",
  icon: "folder",
  color: "#6385FF",
  coverUrl: "",
  status: "active",
  priority: "medium",
  startDate: "",
  dueDate: "",
  ...d,
});

export const toProjectPayload = (v: ProjectFormValue) => ({
  ...v,
  name: v.name.trim(),
  coverUrl: v.coverUrl.trim() || null,
  startDate: v.startDate || null,
  dueDate: v.dueDate || null,
});

export function ProjectForm({ value, onChange, errors = {} }: { value: ProjectFormValue; onChange: (v: ProjectFormValue) => void; errors?: Record<string, string[]> }) {
  const set = <K extends keyof ProjectFormValue>(k: K, v: ProjectFormValue[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="flex flex-col gap-3.5">
      <Field label="Nom" error={errors.name?.[0]}>
        <Input value={value.name} onChange={(e) => set("name", e.target.value)} placeholder="Nom du projet" data-autofocus maxLength={160} />
      </Field>
      <Field label="Description">
        <Textarea value={value.description} onChange={(e) => set("description", e.target.value)} placeholder="Objectif, périmètre, résultat attendu…" rows={3} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Icône">
          <div className="flex flex-wrap gap-1.5">
            {PROJECT_ICONS.map((i) => (
              <button
                key={i}
                type="button"
                onClick={() => set("icon", i)}
                className={cn("grid size-8 place-items-center rounded-[7px] border", value.icon === i ? "border-accent bg-accent/10 text-accent" : "border-line text-fg-3 hover:text-fg")}
                aria-label={i}
              >
                <ProjectIcon name={i} className="size-4" />
              </button>
            ))}
          </div>
        </Field>
        <Field label="Couleur">
          <div className="flex flex-wrap gap-1.5">
            {PROJECT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => set("color", c)}
                className={cn("size-7 rounded-full border-2 transition-transform active:scale-90", value.color === c ? "border-fg" : "border-transparent")}
                style={{ background: c }}
                aria-label={c}
              />
            ))}
          </div>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Statut">
          <Select value={value.status} onChange={(e) => set("status", e.target.value as ProjectStatus)}>
            {Object.entries(PROJECT_STATUS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Priorité">
          <Select value={value.priority} onChange={(e) => set("priority", e.target.value as Priority)}>
            {Object.entries(PRIORITY).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Début">
          <Input type="date" value={value.startDate} onChange={(e) => set("startDate", e.target.value)} />
        </Field>
        <Field label="Échéance">
          <Input type="date" value={value.dueDate} onChange={(e) => set("dueDate", e.target.value)} />
        </Field>
      </div>
      <Field label="Image de couverture (URL)" error={errors.coverUrl?.[0]} hint="Optionnel — URL https d'une image.">
        <Input value={value.coverUrl} onChange={(e) => set("coverUrl", e.target.value)} placeholder="https://…" />
      </Field>
    </div>
  );
}
