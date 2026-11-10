import "server-only";
import { createHash } from "node:crypto";
import { and, eq, gte, inArray } from "drizzle-orm";
import { schema, type DB } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/log";
import { gfetch, pool } from "../google/client";
import { grantedScopes, isServiceConnected } from "../google/oauth";
import { userTz } from "../quiz/quiz";
import { localNow, shiftDate, zonedMidnight } from "../quiz/time";
import { NOT_A_CLASS } from "./overlay";
import { timetableView } from "./timetable";

/**
 * Agenda Google « École » : emploi du temps à jour (modifications comprises), jours fériés, vacances,
 * devoirs et évaluations. Basile OS crée cet agenda et ne touche à aucun autre.
 */

const API = "https://www.googleapis.com/calendar/v3";
const APP_CREATED = "https://www.googleapis.com/auth/calendar.app.created";
const NAME = "École · Basile OS";
const ge = schema.schoolGcalEvents;

type GEvent = { summary: string; description: string; location?: string; colorId?: string; start: { dateTime?: string; date?: string; timeZone?: string }; end: { dateTime?: string; date?: string; timeZone?: string }; transparency?: string; reminders: { useDefault: boolean; overrides?: { method: string; minutes: number }[] }; extendedProperties?: { private: Record<string, string> } };
/** Marque des événements écrits par Basile OS (utile quand ils vont dans l'agenda principal). */
const TAG = { private: { basileos: "school" } };
type Desired = { key: string; startAt: Date; event: GEvent };

const plain = (s: string | null) => (s ?? "").replace(/<[^>]*>/g, "").trim();
const dayAfter = (d: string) => shiftDate(d, 1);

export type GcalState = "synced" | "disconnected" | "disabled" | "error";

/** Ce que l'agenda doit contenir, d'après l'emploi du temps affiché dans Basile OS. */
export async function desiredEvents(db: DB, userId: string, from: string, to: string, tz: string): Promise<Desired[]> {
  const view = await timetableView(db, userId, zonedMidnight(from, tz), zonedMidnight(shiftDate(to, 1), tz));
  const out: Desired[] = [];
  for (const l of view.items) {
    if (l.cancelled || NOT_A_CLASS.test(l.subject)) continue;
    const change = l.change && l.change.kind !== "cancelled" ? l.change : null;
    const label = change?.kind === "added" ? "Ajouté" : change?.kind === "modified" ? "Modifié" : null;
    out.push({
      key: `lesson:${l.startAt}:${l.subject}`,
      startAt: new Date(l.startAt),
      event: {
        summary: `${label ? `⚠︎ ` : ""}${l.subject}`,
        description: [l.teacher, change ? `${label ?? "Événement"} — ${change.note || ""} (${change.origin})`.replace(" —  (", " (") : null].filter(Boolean).join("\n"),
        location: plain(l.room) || undefined,
        colorId: change ? "6" : undefined,
        start: { dateTime: l.startAt, timeZone: tz },
        end: { dateTime: l.endAt, timeZone: tz },
        reminders: { useDefault: false },
      },
    });
  }
  for (const d of view.days)
    out.push({
      key: `day:${d.date}:${d.title}`,
      startAt: new Date(`${d.date}T00:00:00Z`),
      event: { summary: d.title, description: d.origin, colorId: d.kind === "vacation" || d.kind === "holiday" ? "2" : "6", start: { date: d.date }, end: { date: dayAfter(d.date) }, transparency: "transparent", reminders: { useDefault: false } },
    });
  for (const h of view.homework) {
    if (h.done && !h.isTest) continue;
    out.push({
      key: `hw:${h.id}`,
      startAt: new Date(`${h.dueDate}T00:00:00Z`),
      event: {
        summary: `${h.isTest ? "Évaluation" : "Devoir"} · ${h.subject}${h.title ? ` — ${h.title}` : ""}`.slice(0, 200),
        description: h.title,
        colorId: h.isTest ? "11" : "5",
        start: { date: h.dueDate },
        end: { date: dayAfter(h.dueDate) },
        transparency: "transparent",
        // Rappel la veille à 18 h pour une évaluation.
        reminders: h.isTest ? { useDefault: false, overrides: [{ method: "popup", minutes: 6 * 60 }] } : { useDefault: false },
      },
    });
  }
  return out.map((d) => ({ ...d, event: { ...d.event, extendedProperties: TAG } }));
}

const hashOf = (e: GEvent) => createHash("sha1").update(JSON.stringify(e)).digest("hex");

async function setState(db: DB, userId: string, v: Partial<typeof schema.schoolAccounts.$inferInsert>) {
  await db.update(schema.schoolAccounts).set(v).where(eq(schema.schoolAccounts.userId, userId));
}

/**
 * Agenda cible : un agenda « École » séparé quand Google l'autorise (permission « agendas créés par l'application »),
 * sinon l'agenda principal, avec des événements marqués pour ne jamais toucher aux autres.
 * En changeant d'agenda, les événements déjà écrits dans l'ancien sont retirés.
 */
async function targetCalendar(db: DB, userId: string, current: string | null, separate: boolean, tz: string) {
  const moveFrom = async (old: string) => {
    const rows = await db.select().from(ge).where(eq(ge.userId, userId));
    await pool(rows, 4, async (r) => {
      await gfetch(db, userId, `${API}/calendars/${encodeURIComponent(old)}/events/${encodeURIComponent(r.googleId)}`, { method: "DELETE" }).catch(() => null);
    });
    await db.delete(ge).where(eq(ge.userId, userId));
  };
  if (!separate) {
    if (current && current !== "primary") await moveFrom(current);
    if (current !== "primary") await setState(db, userId, { gcalId: "primary" });
    return "primary";
  }
  if (current && current !== "primary") {
    try {
      await gfetch(db, userId, `${API}/calendars/${encodeURIComponent(current)}`);
      return current;
    } catch (e) {
      if (!(e instanceof AppError && e.code === "not_found")) throw e;
      await db.delete(ge).where(eq(ge.userId, userId));
    }
  }
  if (current === "primary") await moveFrom("primary");
  const cal = await gfetch<{ id: string }>(db, userId, `${API}/calendars`, { method: "POST", body: JSON.stringify({ summary: NAME, description: "Emploi du temps, devoirs et évaluations — tenu à jour par Basile OS.", timeZone: tz }) });
  await setState(db, userId, { gcalId: cal.id });
  return cal.id;
}

const g = globalThis as { __gcalRunning?: Set<string> };
const running = (g.__gcalRunning ??= new Set());

/** Met l'agenda Google « École » au niveau de l'emploi du temps (5 semaines). */
export async function syncSchoolCalendar(db: DB, userId: string): Promise<{ state: GcalState; created?: number; updated?: number; removed?: number }> {
  const [acc] = await db.select().from(schema.schoolAccounts).where(eq(schema.schoolAccounts.userId, userId));
  if (!acc) return { state: "disconnected" };
  if (!acc.gcalEnabled) return { state: "disabled" };
  if (!(await isServiceConnected(db, userId, "calendar"))) return { state: "disconnected" };
  const separate = (await grantedScopes(db, userId)).includes(APP_CREATED);
  if (running.has(userId)) return { state: "synced" };
  running.add(userId);
  try {
    const tz = await userTz(db, userId);
    const today = localNow(tz).date;
    const from = shiftDate(today, -7);
    const to = shiftDate(today, 35);
    const calId = await targetCalendar(db, userId, acc.gcalId, separate, tz);
    const base = `${API}/calendars/${encodeURIComponent(calId)}/events`;
    const want = await desiredEvents(db, userId, from, to, tz);
    const wantKeys = new Map(want.map((w) => [w.key, w]));
    const have = await db.select().from(ge).where(and(eq(ge.userId, userId), gte(ge.startAt, zonedMidnight(from, tz))));
    const haveKeys = new Map(have.map((h) => [h.key, h]));
    let created = 0;
    let updated = 0;
    let removed = 0;

    // Suppressions : éléments disparus (cours annulé, devoir supprimé…).
    const gone = have.filter((h) => !wantKeys.has(h.key));
    await pool(gone, 2, async (h) => {
      try {
        await gfetch(db, userId, `${base}/${encodeURIComponent(h.googleId)}`, { method: "DELETE" });
      } catch (e) {
        if (!(e instanceof AppError && (e.code === "not_found" || e.code === "conflict"))) throw e;
      }
      removed++;
    });
    if (gone.length) await db.delete(ge).where(and(eq(ge.userId, userId), inArray(ge.id, gone.map((h) => h.id))));

    // Créations et mises à jour.
    await pool(want, 2, async (w) => {
      const hash = hashOf(w.event);
      const prev = haveKeys.get(w.key);
      if (prev?.hash === hash) return;
      if (prev) {
        try {
          await gfetch(db, userId, `${base}/${encodeURIComponent(prev.googleId)}`, { method: "PUT", body: JSON.stringify(w.event) });
          await db.update(ge).set({ hash, startAt: w.startAt }).where(eq(ge.id, prev.id));
          updated++;
          return;
        } catch (e) {
          if (!(e instanceof AppError && e.code === "not_found")) throw e;
          await db.delete(ge).where(eq(ge.id, prev.id));
        }
      }
      const ev = await gfetch<{ id: string }>(db, userId, base, { method: "POST", body: JSON.stringify(w.event) });
      await db.insert(ge).values({ userId, key: w.key, googleId: ev.id, hash, startAt: w.startAt }).onConflictDoUpdate({ target: [ge.userId, ge.key], set: { googleId: ev.id, hash, startAt: w.startAt } });
      created++;
    });
    await setState(db, userId, { gcalSyncedAt: new Date(), gcalError: null });
    return { state: "synced", created, updated, removed };
  } catch (e) {
    log.warn("school.gcal_failed", { error: String(e) });
    const msg = e instanceof AppError ? e.message : "Synchronisation impossible";
    await setState(db, userId, { gcalError: msg.slice(0, 300) });
    return { state: "error" };
  } finally {
    running.delete(userId);
  }
}

/** Activer ou couper l'agenda Google « École » (l'agenda déjà créé est conservé côté Google). */
export async function setSchoolCalendar(db: DB, userId: string, enabled: boolean) {
  await setState(db, userId, { gcalEnabled: enabled });
  return enabled ? syncSchoolCalendar(db, userId) : { state: "disabled" as GcalState };
}
