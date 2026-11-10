"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPin, Users, Clock, Pencil, Trash2, Lightbulb, Mail, FileText, ListChecks, ExternalLink, Repeat, Bell, User } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge, Skeleton } from "@/components/ui/misc";
import { Textarea } from "@/components/ui/input";
import { Dialog, ConfirmDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { useUI } from "@/components/shell/ui-context";
import { EventForm, toEventPayload, type EventFormValue } from "@/components/create/event-form";
import { api } from "@/lib/client/api";
import { formatTime, isoDate, pad2 } from "@/lib/utils";
import type { CalendarEvent } from "@/types";

type Prep = {
  event: CalendarEvent;
  contacts: { id: string; name: string; email: string | null; company: string | null }[];
  emails: { id: string; subject: string; from: string | null; fromEmail: string | null; date: string }[];
  docs: { type: string; id: string; title: string; subtitle?: string; href: string }[];
  links: { type: string; id: string; title: string; href: string }[];
  project: { id: string; name: string } | null;
};

export function EventDetail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data, error } = useQuery({ queryKey: ["event-prep", id], queryFn: () => api.get<Prep>(`/api/events/${id}/prep`), enabled: !!id });
  const ev = data?.event;
  const [notes, setNotes] = useState("");
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();
  const { askAssistant } = useUI();
  useEffect(() => setNotes(ev?.prepNotes ?? ""), [ev?.id, ev?.prepNotes]);
  const refresh = () => {
    ["events", "event-prep", "dashboard"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };

  const checklist = async () => {
    if (!ev) return;
    try {
      await api.post("/api/tasks", {
        title: `Préparer : ${ev.title}`,
        dueDate: isoDate(new Date(ev.startAt)),
        subtasks: ["Relire les échanges récents", "Rassembler les documents", "Lister les questions à poser", "Définir l'objectif du rendez-vous"],
        sourceType: "event",
        sourceId: ev.id,
        projectId: ev.projectId,
      });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      toast({ kind: "success", title: "Checklist de préparation créée" });
    } catch (e) {
      toast({ kind: "error", title: "Création impossible", description: (e as Error).message });
    }
  };

  return (
    <Sheet
      open={!!id}
      onClose={onClose}
      title={ev ? (ev.source === "google" ? "Événement Google Calendar" : "Événement local") : "Événement"}
      actions={
        ev && (
          <>
            <Button size="icon-sm" variant="ghost" onClick={() => setEditing(true)} aria-label="Modifier">
              <Pencil className="size-4" />
            </Button>
            <Button size="icon-sm" variant="ghost" onClick={() => setDeleting(true)} aria-label="Supprimer">
              <Trash2 className="size-4" />
            </Button>
          </>
        )
      }
    >
      {error ? (
        <p className="p-4 text-[13px] text-danger">{(error as Error).message}</p>
      ) : !ev || !data ? (
        <div className="space-y-3 p-4">
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="h-24" />
        </div>
      ) : (
        <div className="flex flex-col gap-5 p-4">
          <div>
            <div className="flex items-start gap-2.5">
              <span className="mt-2 size-3 shrink-0 rounded-[4px]" style={{ background: ev.color ?? "var(--accent)" }} />
              <h2 className="t-title">{ev.title}</h2>
            </div>
            <div className="t-sub mt-3 flex flex-col gap-1.5 text-[13px]">
              <span className="flex items-center gap-2">
                <Clock className="size-3.5 text-fg-3" />
                {new Date(ev.startAt).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}
                {!ev.allDay && ` · ${formatTime(ev.startAt)} – ${formatTime(ev.endAt)}`} <span className="t-meta">({ev.timezone})</span>
              </span>
              {ev.location && (
                <span className="flex items-center gap-2">
                  <MapPin className="size-3.5 text-fg-3" />
                  {/^https?:\/\//.test(ev.location) ? (
                    <a href={ev.location} target="_blank" rel="noopener noreferrer" className="text-accent underline-offset-2 hover:underline">
                      {ev.location}
                    </a>
                  ) : (
                    ev.location
                  )}
                </span>
              )}
              {ev.attendees.length > 0 && (
                <span className="flex items-start gap-2">
                  <Users className="mt-0.5 size-3.5 text-fg-3" />
                  <span>{ev.attendees.map((a) => a.name || a.email).join(", ")}</span>
                </span>
              )}
              {ev.recurrence.length > 0 && (
                <span className="flex items-center gap-2">
                  <Repeat className="size-3.5 text-fg-3" />
                  {ev.recurrence.join(" ")}
                </span>
              )}
              {ev.reminders.length > 0 && (
                <span className="flex items-center gap-2">
                  <Bell className="size-3.5 text-fg-3" />
                  {ev.reminders.map((r) => `${r.minutes} min avant`).join(", ")}
                </span>
              )}
              {data.project && (
                <Link href={`/projects/${data.project.id}`} className="text-accent">
                  Projet : {data.project.name}
                </Link>
              )}
              {ev.htmlLink && (
                <a href={ev.htmlLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent">
                  Ouvrir dans Google Calendar <ExternalLink className="size-3" />
                </a>
              )}
            </div>
            {ev.description && <p className="mt-3 rounded-[9px] border border-line-soft bg-bg-2 p-3 text-[13px] whitespace-pre-wrap text-fg-2">{ev.description}</p>}
          </div>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <p className="t-label">Préparation du rendez-vous</p>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" icon={<ListChecks className="size-3.5" />} onClick={checklist}>
                  Checklist
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Lightbulb className="size-3.5 text-fg-3" />}
                  onClick={() => (onClose(), askAssistant(`Prépare mon rendez-vous « ${ev.title} » (événement ${ev.id}, ${new Date(ev.startAt).toLocaleString("fr-FR")}) : résumé, emails et documents associés, contacts concernés, questions à poser.`))}
                >
                  Préparer
                </Button>
              </div>
            </div>
            <Group icon={<User />} title="Contacts concernés" empty="Aucun participant trouvé dans tes contacts.">
              {data.contacts.map((c) => (
                <Link key={c.id} href={`/contacts?contact=${c.id}`} className="block truncate rounded-[6px] px-2 py-1 text-[13px] hover:bg-raised">
                  {c.name} {c.company && <span className="t-meta">· {c.company}</span>}
                </Link>
              ))}
            </Group>
            <Group icon={<Mail />} title="Emails associés" empty="Aucun email associé trouvé (Gmail synchronisé requis).">
              {data.emails.map((m) => (
                <Link key={m.id} href={`/inbox?message=${m.id}`} className="block truncate rounded-[6px] px-2 py-1 text-[13px] hover:bg-raised">
                  {m.subject || "(sans objet)"} <span className="t-meta">· {m.from || m.fromEmail}</span>
                </Link>
              ))}
            </Group>
            <Group icon={<FileText />} title="Documents et notes pertinents" empty="Aucun document correspondant au sujet.">
              {[...data.docs, ...data.links].map((d) => (
                <Link key={`${d.type}-${d.id}`} href={d.href} className="block truncate rounded-[6px] px-2 py-1 text-[13px] hover:bg-raised">
                  {d.title} <Badge className="ml-1">{d.type}</Badge>
                </Link>
              ))}
            </Group>
          </section>

          <section>
            <p className="t-label mb-2">Notes personnelles</p>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={async () => {
                if (notes === ev.prepNotes) return;
                try {
                  await api.patch(`/api/events/${ev.id}`, { prepNotes: notes });
                  qc.invalidateQueries({ queryKey: ["event-prep", id] });
                } catch (e) {
                  toast({ kind: "error", title: "Notes non enregistrées", description: (e as Error).message });
                }
              }}
              placeholder="Objectifs, points à aborder, décisions…"
              rows={4}
            />
          </section>
        </div>
      )}
      {ev && <EditEvent ev={ev} open={editing} onClose={() => setEditing(false)} onSaved={refresh} />}
      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        danger
        title="Supprimer cet événement ?"
        description={ev?.source === "google" ? "L'événement sera aussi supprimé de Google Calendar (les participants peuvent être notifiés)." : "L'événement sera supprimé."}
        confirmLabel="Supprimer"
        onConfirm={async () => {
          try {
            await api.del(`/api/events/${id}`);
            setDeleting(false);
            onClose();
            refresh();
            toast({ kind: "success", title: "Événement supprimé" });
          } catch (e) {
            toast({ kind: "error", title: "Suppression impossible", description: (e as Error).message });
          }
        }}
      />
    </Sheet>
  );
}

function Group({ icon, title, empty, children }: { icon: React.ReactNode; title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <div className="mb-2 rounded-[10px] border border-line-soft p-2">
      <p className="mb-1 flex items-center gap-1.5 px-1 text-[12.5px] font-medium text-fg-2 [&>svg]:size-3.5 [&>svg]:text-fg-3">
        {icon}
        {title}
      </p>
      {children.length ? children : <p className="t-meta px-2 py-1">{empty}</p>}
    </div>
  );
}

function EditEvent({ ev, open, onClose, onSaved }: { ev: CalendarEvent; open: boolean; onClose: () => void; onSaved: () => void }) {
  const toForm = (): EventFormValue => {
    const s = new Date(ev.startAt);
    const e = new Date(ev.endAt);
    const endDisplay = ev.allDay ? new Date(e.getTime() - 86400_000) : e;
    const rr = ev.recurrence[0]?.match(/FREQ=(\w+)/)?.[1] ?? "";
    return {
      title: ev.title,
      description: ev.description,
      location: ev.location ?? "",
      date: isoDate(s),
      endDate: isoDate(endDisplay),
      start: `${pad2(s.getHours())}:${pad2(s.getMinutes())}`,
      end: `${pad2(e.getHours())}:${pad2(e.getMinutes())}`,
      allDay: ev.allDay,
      timezone: ev.timezone,
      attendees: ev.attendees.map((a) => a.email).join(", "),
      color: ev.color ?? "",
      recurrence: (["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(rr) ? rr : "") as EventFormValue["recurrence"],
      reminder: ev.reminders[0] ? String(ev.reminders[0].minutes) : "",
      projectId: ev.projectId ?? "",
      target: "auto",
    };
  };
  const [v, setV] = useState<EventFormValue>(toForm);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  useEffect(() => {
    if (open) setV(toForm());
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Modifier l'événement"
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
                const { target, ...p } = toEventPayload(v);
                void target;
                await api.patch(`/api/events/${ev.id}`, p);
                onSaved();
                onClose();
                toast({ kind: "success", title: "Événement mis à jour" });
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
      <EventForm value={v} onChange={setV} showTarget={false} />
    </Dialog>
  );
}
