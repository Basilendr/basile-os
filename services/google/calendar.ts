import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import type { DB } from "@/lib/db";
import { schema } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/log";
import { gfetch } from "./client";
import { isServiceConnected, upsertIntegration } from "./oauth";

const API = "https://www.googleapis.com/calendar/v3";

export type GEvent = {
  id: string;
  etag?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  colorId?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: { email: string; displayName?: string; responseStatus?: string }[];
  recurrence?: string[];
  reminders?: { useDefault?: boolean; overrides?: { method: string; minutes: number }[] };
  extendedProperties?: { private?: Record<string, string> };
};

/** Événements de l'emploi du temps écrits par Basile OS dans l'agenda principal : déjà affichés dans École. */
export const isSchoolEvent = (g: GEvent) => g.extendedProperties?.private?.basileos === "school";

export const isConnected = (db: DB, userId: string) => isServiceConnected(db, userId, "calendar");

type EventFields = {
  title?: string;
  description?: string;
  location?: string | null;
  startAt?: string;
  endAt?: string;
  allDay?: boolean;
  timezone?: string;
  attendees?: { email: string; name?: string }[];
  color?: string | null;
  recurrence?: string[];
  reminders?: { method: string; minutes: number }[];
};

/** Couleurs Google Calendar (colorId 1–11). */
export const GOOGLE_COLORS: Record<string, string> = {
  "1": "#7986cb",
  "2": "#33b679",
  "3": "#8e24aa",
  "4": "#e67c73",
  "5": "#f6bf26",
  "6": "#f4511e",
  "7": "#039be5",
  "8": "#616161",
  "9": "#3f51b5",
  "10": "#0b8043",
  "11": "#d50000",
};

function toGoogle(e: EventFields): Partial<GEvent> {
  const g: Partial<GEvent> = {};
  if (e.title !== undefined) g.summary = e.title;
  if (e.description !== undefined) g.description = e.description;
  if (e.location !== undefined) g.location = e.location ?? "";
  if (e.startAt || e.endAt) {
    const tz = e.timezone ?? "Europe/Paris";
    if (e.allDay) {
      if (e.startAt) g.start = { date: e.startAt.slice(0, 10) };
      if (e.endAt) g.end = { date: e.endAt.slice(0, 10) };
    } else {
      if (e.startAt) g.start = { dateTime: e.startAt, timeZone: tz };
      if (e.endAt) g.end = { dateTime: e.endAt, timeZone: tz };
    }
  }
  if (e.attendees) g.attendees = e.attendees.map((a) => ({ email: a.email, displayName: a.name }));
  if (e.color !== undefined) g.colorId = e.color && GOOGLE_COLORS[e.color] ? e.color : Object.entries(GOOGLE_COLORS).find(([, v]) => v === e.color)?.[0];
  if (e.recurrence) g.recurrence = e.recurrence;
  if (e.reminders) g.reminders = e.reminders.length ? { useDefault: false, overrides: e.reminders } : { useDefault: true };
  return g;
}

export function toLocal(g: GEvent, calendarId = "primary"): Omit<typeof schema.calendarEvents.$inferInsert, "userId"> {
  const allDay = Boolean(g.start?.date);
  const startAt = new Date(g.start?.dateTime ?? `${g.start?.date}T00:00:00`);
  const endAt = new Date(g.end?.dateTime ?? `${g.end?.date ?? g.start?.date}T00:00:00`);
  return {
    source: "google",
    calendarId,
    externalId: g.id,
    etag: g.etag ?? null,
    title: g.summary ?? "(sans titre)",
    description: g.description ?? "",
    location: g.location ?? null,
    startAt,
    endAt: endAt > startAt ? endAt : new Date(startAt.getTime() + 30 * 60_000),
    allDay,
    timezone: g.start?.timeZone ?? "Europe/Paris",
    attendees: (g.attendees ?? []).map((a) => ({ email: a.email, name: a.displayName, status: a.responseStatus })),
    color: g.colorId ? (GOOGLE_COLORS[g.colorId] ?? null) : null,
    recurrence: g.recurrence ?? [],
    reminders: g.reminders?.overrides ?? [],
    status: g.status === "cancelled" ? "cancelled" : "confirmed",
    htmlLink: g.htmlLink ?? null,
  };
}

export async function insertEvent(db: DB, userId: string, e: EventFields) {
  return gfetch<GEvent>(db, userId, `${API}/calendars/primary/events?sendUpdates=${e.attendees?.length ? "all" : "none"}`, {
    method: "POST",
    body: JSON.stringify(toGoogle(e)),
  });
}

export async function patchEvent(db: DB, userId: string, calendarId: string, eventId: string, e: EventFields, etag?: string | null) {
  return gfetch<GEvent>(db, userId, `${API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
    method: "PATCH",
    body: JSON.stringify(toGoogle(e)),
    headers: etag ? { "if-match": etag } : undefined,
  });
}

export async function deleteEvent(db: DB, userId: string, calendarId: string, eventId: string) {
  try {
    await gfetch(db, userId, `${API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, { method: "DELETE" });
  } catch (e) {
    // déjà supprimé côté Google : on accepte
    if (!(e instanceof AppError && (e.code === "not_found" || e.code === "conflict"))) throw e;
  }
}

/**
 * Synchronisation incrémentale (syncToken). Premier passage : 60 jours passés → futur.
 * Un 410 (jeton expiré) déclenche une resynchronisation complète.
 */
export async function syncCalendar(db: DB, userId: string): Promise<{ upserted: number; removed: number; full: boolean }> {
  const [integ] = await db.select().from(schema.integrations).where(and(eq(schema.integrations.userId, userId), eq(schema.integrations.service, "calendar")));
  if (integ?.status !== "connected") throw new AppError("not_configured", "Google Calendar n'est pas connecté");
  let syncToken = (integ.syncState as { syncToken?: string }).syncToken;
  let full = !syncToken;
  let upserted = 0;
  let removed = 0;
  try {
    let pageToken: string | undefined;
    let nextSyncToken: string | undefined;
    do {
      const p = new URLSearchParams({ maxResults: "250", singleEvents: "true", showDeleted: "true" });
      if (syncToken) p.set("syncToken", syncToken);
      else p.set("timeMin", new Date(Date.now() - 60 * 86400_000).toISOString());
      if (pageToken) p.set("pageToken", pageToken);
      let page: { items?: GEvent[]; nextPageToken?: string; nextSyncToken?: string };
      try {
        page = await gfetch(db, userId, `${API}/calendars/primary/events?${p}`);
      } catch (e) {
        if (e instanceof AppError && (e.details as { status?: number })?.status === 410) {
          syncToken = undefined;
          full = true;
          pageToken = undefined;
          await db.delete(schema.calendarEvents).where(and(eq(schema.calendarEvents.userId, userId), eq(schema.calendarEvents.source, "google")));
          continue;
        }
        throw e;
      }
      const items = page.items ?? [];
      const cancelled = items.filter((i) => i.status === "cancelled" || isSchoolEvent(i)).map((i) => i.id);
      if (cancelled.length) {
        const r = await db
          .delete(schema.calendarEvents)
          .where(and(eq(schema.calendarEvents.userId, userId), eq(schema.calendarEvents.source, "google"), inArray(schema.calendarEvents.externalId, cancelled)))
          .returning({ id: schema.calendarEvents.id });
        removed += r.length;
      }
      for (const g of items.filter((i) => i.status !== "cancelled" && !isSchoolEvent(i) && (i.start?.dateTime || i.start?.date))) {
        const v = toLocal(g);
        await db
          .insert(schema.calendarEvents)
          .values({ ...v, userId })
          .onConflictDoUpdate({
            target: [schema.calendarEvents.userId, schema.calendarEvents.calendarId, schema.calendarEvents.externalId],
            set: v,
          });
        upserted++;
      }
      pageToken = page.nextPageToken;
      nextSyncToken = page.nextSyncToken ?? nextSyncToken;
    } while (pageToken);
    await upsertIntegration(db, userId, "calendar", { lastSyncAt: new Date(), lastError: null, status: "connected", syncState: { syncToken: nextSyncToken } });
    return { upserted, removed, full };
  } catch (e) {
    log.error("calendar.sync_failed", { userId, error: String(e) });
    await upsertIntegration(db, userId, "calendar", { lastError: (e as Error).message });
    throw e;
  }
}
