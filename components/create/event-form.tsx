"use client";
import { Field, Input, Select, Textarea, Switch } from "@/components/ui/input";
import { useProjects } from "@/hooks/use-data";
import { useStatus } from "@/hooks/use-status";
import { cn } from "@/lib/utils";

export const EVENT_COLORS = ["", "#7986cb", "#33b679", "#8e24aa", "#e67c73", "#f6bf26", "#f4511e", "#039be5", "#616161", "#3f51b5", "#0b8043", "#d50000"];

export type EventFormValue = {
  title: string;
  description: string;
  location: string;
  date: string;
  start: string;
  end: string;
  endDate: string;
  allDay: boolean;
  timezone: string;
  attendees: string;
  color: string;
  recurrence: "" | "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  reminder: string;
  projectId: string;
  target: "auto" | "local";
};

const pad = (n: number) => String(n).padStart(2, "0");
export function emptyEvent(d: Partial<EventFormValue> = {}, base = new Date()): EventFormValue {
  const s = new Date(base);
  if (!d.start) s.setMinutes(s.getMinutes() < 30 ? 30 : 60, 0, 0);
  const e = new Date(s.getTime() + 60 * 60_000);
  const date = `${s.getFullYear()}-${pad(s.getMonth() + 1)}-${pad(s.getDate())}`;
  return {
    title: "",
    description: "",
    location: "",
    date,
    endDate: date,
    start: `${pad(s.getHours())}:${pad(s.getMinutes())}`,
    end: `${pad(e.getHours())}:${pad(e.getMinutes())}`,
    allDay: false,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    attendees: "",
    color: "",
    recurrence: "",
    reminder: "10",
    projectId: "",
    target: "auto",
    ...d,
  };
}

export function toEventPayload(v: EventFormValue) {
  const startAt = v.allDay ? new Date(`${v.date}T00:00:00`) : new Date(`${v.date}T${v.start}:00`);
  const endAt = v.allDay ? new Date(new Date(`${v.endDate || v.date}T00:00:00`).getTime() + 86400_000) : new Date(`${v.endDate || v.date}T${v.end}:00`);
  return {
    title: v.title.trim(),
    description: v.description,
    location: v.location.trim() || null,
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    allDay: v.allDay,
    timezone: v.timezone,
    attendees: v.attendees
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((email) => ({ email })),
    color: v.color || null,
    recurrence: v.recurrence ? [`RRULE:FREQ=${v.recurrence}`] : [],
    reminders: v.reminder ? [{ method: "popup" as const, minutes: Number(v.reminder) }] : [],
    projectId: v.projectId || null,
    target: v.target,
  };
}

export function EventForm({ value, onChange, errors = {}, showTarget = true }: { value: EventFormValue; onChange: (v: EventFormValue) => void; errors?: Record<string, string[]>; showTarget?: boolean }) {
  const set = <K extends keyof EventFormValue>(k: K, v: EventFormValue[K]) => onChange({ ...value, [k]: v });
  const { data: projects } = useProjects();
  const { data: status } = useStatus();
  const googleOn = status?.google.services.calendar.status === "connected";
  return (
    <div className="flex flex-col gap-3.5">
      <Field label="Titre" error={errors.title?.[0]}>
        <Input value={value.title} onChange={(e) => set("title", e.target.value)} placeholder="Rendez-vous, réunion, séance de travail…" data-autofocus />
      </Field>
      <div className="flex items-center justify-between rounded-[8px] border border-line-soft bg-bg-2 px-3 py-2">
        <span className="text-[13px] text-fg-2">Toute la journée</span>
        <Switch checked={value.allDay} onChange={(v) => set("allDay", v)} label="Toute la journée" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Date">
          <Input type="date" value={value.date} onChange={(e) => onChange({ ...value, date: e.target.value, endDate: value.endDate < e.target.value ? e.target.value : value.endDate })} />
        </Field>
        {!value.allDay ? (
          <>
            <Field label="Début">
              <Input type="time" value={value.start} onChange={(e) => set("start", e.target.value)} />
            </Field>
            <Field label="Fin" error={errors.endAt?.[0]}>
              <Input type="time" value={value.end} onChange={(e) => set("end", e.target.value)} />
            </Field>
          </>
        ) : null}
        <Field label="Date de fin">
          <Input type="date" value={value.endDate} min={value.date} onChange={(e) => set("endDate", e.target.value)} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Lieu">
          <Input value={value.location} onChange={(e) => set("location", e.target.value)} placeholder="Adresse ou lien visio" />
        </Field>
        <Field label="Fuseau horaire">
          <Input value={value.timezone} onChange={(e) => set("timezone", e.target.value)} />
        </Field>
      </div>
      <Field label="Participants" hint="Adresses email séparées par des virgules. Google leur enverra une invitation." error={errors.attendees?.[0]}>
        <Input value={value.attendees} onChange={(e) => set("attendees", e.target.value)} placeholder="nom@exemple.com" />
      </Field>
      <Field label="Description">
        <Textarea value={value.description} onChange={(e) => set("description", e.target.value)} rows={3} />
      </Field>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Récurrence">
          <Select value={value.recurrence} onChange={(e) => set("recurrence", e.target.value as EventFormValue["recurrence"])}>
            <option value="">Aucune</option>
            <option value="DAILY">Chaque jour</option>
            <option value="WEEKLY">Chaque semaine</option>
            <option value="MONTHLY">Chaque mois</option>
            <option value="YEARLY">Chaque année</option>
          </Select>
        </Field>
        <Field label="Rappel">
          <Select value={value.reminder} onChange={(e) => set("reminder", e.target.value)}>
            <option value="">Aucun</option>
            <option value="0">À l'heure</option>
            <option value="10">10 min avant</option>
            <option value="30">30 min avant</option>
            <option value="60">1 h avant</option>
            <option value="1440">1 jour avant</option>
          </Select>
        </Field>
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
      </div>
      <Field label="Couleur">
        <div className="flex flex-wrap gap-1.5">
          {EVENT_COLORS.map((c) => (
            <button
              key={c || "none"}
              type="button"
              onClick={() => set("color", c)}
              className={cn("size-6 rounded-full border-2", value.color === c ? "border-fg" : "border-transparent", !c && "bg-raised")}
              style={c ? { background: c } : undefined}
              aria-label={c || "Par défaut"}
            />
          ))}
        </div>
      </Field>
      {showTarget && (
        <Field label="Calendrier">
          <Select value={value.target} onChange={(e) => set("target", e.target.value as "auto" | "local")}>
            <option value="auto">{googleOn ? "Google Calendar (principal)" : "BASILE OS (Google non connecté)"}</option>
            <option value="local">BASILE OS uniquement</option>
          </Select>
        </Field>
      )}
    </div>
  );
}
