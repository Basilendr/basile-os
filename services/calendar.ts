import "server-only";
import { and, asc, eq, gt, lt } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/lib/db";
import { schema } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import { logActivity } from "./activity";
import { emit } from "./events";
import * as gcal from "./google/calendar";

export const EventInput = z
  .object({
    title: z.string().trim().min(1, "Titre requis").max(300),
    description: z.string().max(20_000).default(""),
    location: z.string().max(500).nullable().optional(),
    startAt: z.iso.datetime({ offset: true }),
    endAt: z.iso.datetime({ offset: true }),
    allDay: z.boolean().default(false),
    timezone: z.string().max(60).default("Europe/Paris"),
    attendees: z.array(z.object({ email: z.email(), name: z.string().max(200).optional() })).max(100).default([]),
    color: z.string().max(20).nullable().optional(),
    recurrence: z.array(z.string().regex(/^(RRULE|EXDATE|RDATE):/)).max(10).default([]),
    reminders: z.array(z.object({ method: z.enum(["popup", "email"]), minutes: z.number().int().min(0).max(40320) })).max(5).default([]),
    projectId: z.uuid().nullable().optional(),
    prepNotes: z.string().max(20_000).optional(),
    /** Cible : calendrier Google (si connecté) ou calendrier local BASILE OS. */
    target: z.enum(["auto", "local", "google"]).default("auto"),
  })
  .refine((e) => new Date(e.endAt) > new Date(e.startAt), { message: "La fin doit être après le début", path: ["endAt"] });

export const EventPatch = z
  .object({
    title: z.string().trim().min(1).max(300),
    description: z.string().max(20_000),
    location: z.string().max(500).nullable(),
    startAt: z.iso.datetime({ offset: true }),
    endAt: z.iso.datetime({ offset: true }),
    allDay: z.boolean(),
    timezone: z.string().max(60),
    attendees: z.array(z.object({ email: z.email(), name: z.string().max(200).optional() })).max(100),
    color: z.string().max(20).nullable(),
    recurrence: z.array(z.string().regex(/^(RRULE|EXDATE|RDATE):/)).max(10),
    reminders: z.array(z.object({ method: z.enum(["popup", "email"]), minutes: z.number().int().min(0).max(40320) })).max(5),
    projectId: z.uuid().nullable(),
    prepNotes: z.string().max(20_000),
  })
  .partial();

export async function listEvents(db: DB, userId: string, from: Date, to: Date) {
  return db
    .select()
    .from(schema.calendarEvents)
    .where(
      and(
        eq(schema.calendarEvents.userId, userId),
        lt(schema.calendarEvents.startAt, to),
        gt(schema.calendarEvents.endAt, from),
        // les événements annulés côté Google sont conservés pour la synchro mais masqués
        eq(schema.calendarEvents.status, "confirmed"),
      ),
    )
    .orderBy(asc(schema.calendarEvents.startAt));
}

export async function getEvent(db: DB, userId: string, id: string) {
  const [e] = await db.select().from(schema.calendarEvents).where(and(eq(schema.calendarEvents.id, id), eq(schema.calendarEvents.userId, userId)));
  if (!e) throw notFound("Événement");
  return e;
}

/**
 * Création : si Google Calendar est connecté (et cible auto/google), l'événement est créé
 * via l'API Google d'abord ; il n'est enregistré localement qu'après confirmation de l'API.
 */
export async function createEvent(db: DB, userId: string, raw: z.input<typeof EventInput>) {
  const { target, ...input } = EventInput.parse(raw);
  const googleOn = await gcal.isConnected(db, userId);
  if (target === "google" && !googleOn) throw new AppError("not_configured", "Google Calendar n'est pas connecté.");
  let values: typeof schema.calendarEvents.$inferInsert = {
    ...input,
    userId,
    startAt: new Date(input.startAt),
    endAt: new Date(input.endAt),
    source: "local",
    prepNotes: input.prepNotes ?? "",
  };
  if (googleOn && target !== "local") {
    const g = await gcal.insertEvent(db, userId, input);
    values = { ...values, ...gcal.toLocal(g), userId, projectId: input.projectId ?? null, prepNotes: input.prepNotes ?? "" };
  }
  const [ev] = await db.insert(schema.calendarEvents).values(values).returning();
  await logActivity(db, userId, { type: "event.created", title: `Événement créé : ${ev.title}`, entityType: "event", entityId: ev.id, meta: { source: ev.source, projectId: ev.projectId } });
  await emit(db, { type: "event.created", userId, entityType: "event", entityId: ev.id, data: { title: ev.title, startAt: ev.startAt.toISOString() }, key: `event.created:${ev.id}` });
  return ev;
}

export async function updateEvent(db: DB, userId: string, id: string, raw: z.input<typeof EventPatch>) {
  const patch = EventPatch.parse(raw);
  const current = await getEvent(db, userId, id);
  const start = patch.startAt ? new Date(patch.startAt) : current.startAt;
  const end = patch.endAt ? new Date(patch.endAt) : current.endAt;
  if (end <= start) throw new AppError("bad_request", "La fin doit être après le début");
  let values: Partial<typeof schema.calendarEvents.$inferInsert> = {
    ...patch,
    startAt: patch.startAt ? start : undefined,
    endAt: patch.endAt ? end : undefined,
  };
  const { projectId, prepNotes, ...remote } = patch;
  if (current.source === "google" && current.externalId && Object.keys(remote).length) {
    const g = await gcal.patchEvent(db, userId, current.calendarId, current.externalId, remote, current.etag);
    values = { ...values, ...gcal.toLocal(g) };
  }
  void projectId;
  void prepNotes;
  const [ev] = await db.update(schema.calendarEvents).set(values).where(and(eq(schema.calendarEvents.id, id), eq(schema.calendarEvents.userId, userId))).returning();
  await logActivity(db, userId, { type: "event.updated", title: `Événement modifié : ${ev.title}`, entityType: "event", entityId: id });
  return ev;
}

export async function deleteEvent(db: DB, userId: string, id: string) {
  const ev = await getEvent(db, userId, id);
  if (ev.source === "google" && ev.externalId) await gcal.deleteEvent(db, userId, ev.calendarId, ev.externalId);
  await db.delete(schema.calendarEvents).where(and(eq(schema.calendarEvents.id, id), eq(schema.calendarEvents.userId, userId)));
  await logActivity(db, userId, { type: "event.deleted", title: `Événement supprimé : ${ev.title}`, entityType: "event", entityId: id });
}

/**
 * Créneaux libres réels entre `from` et `to`, dans les heures de travail,
 * en tenant compte de tous les événements (locaux + Google synchronisés).
 */
export async function findFreeSlots(
  db: DB,
  userId: string,
  opts: { from: Date; to: Date; durationMin: number; dayStart?: number; dayEnd?: number; timezone?: string; limit?: number },
) {
  const events = await listEvents(db, userId, opts.from, opts.to);
  const busy = events.filter((e) => !e.allDay).map((e) => [e.startAt.getTime(), e.endAt.getTime()] as const);
  const dayStart = opts.dayStart ?? 9;
  const dayEnd = opts.dayEnd ?? 19;
  const step = 15 * 60_000;
  const dur = opts.durationMin * 60_000;
  const slots: { start: string; end: string }[] = [];
  const now = Date.now();
  for (let d = new Date(opts.from); d < opts.to && slots.length < (opts.limit ?? 8); d.setDate(d.getDate() + 1)) {
    const ws = new Date(d);
    ws.setHours(dayStart, 0, 0, 0);
    const we = new Date(d);
    we.setHours(dayEnd, 0, 0, 0);
    let t = Math.max(ws.getTime(), opts.from.getTime(), Math.ceil(now / step) * step);
    while (t + dur <= Math.min(we.getTime(), opts.to.getTime())) {
      const clash = busy.find(([s, e]) => s < t + dur && e > t);
      if (clash) {
        t = Math.ceil(clash[1] / step) * step;
        continue;
      }
      slots.push({ start: new Date(t).toISOString(), end: new Date(t + dur).toISOString() });
      if (slots.length >= (opts.limit ?? 8)) break;
      t += Math.max(dur, 60 * 60_000); // propose des options espacées
    }
    d.setHours(0, 0, 0, 0);
  }
  return slots;
}
