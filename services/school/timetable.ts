import "server-only";
import { and, asc, desc, eq, gte, isNotNull, lt, lte, ne } from "drizzle-orm";
import { schema, type DB } from "@/lib/db";
import { log } from "@/lib/log";
import { userTz } from "../quiz/quiz";
import { localNow, shiftDate } from "../quiz/time";
import { fetchVacations, publicHolidays } from "./days";
import { weekDocument } from "./documents";
import { applyChanges, learnTemplate, lessonFor, localParts, type ChangeRow } from "./overlay";

/** Emploi du temps à jour : École Directe + modifications de la vie scolaire + fériés et vacances + devoirs. */

const c = schema.schoolChanges;
const shortDate = (d: Date) => d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "Europe/Paris" });

/** Modifications connues entre deux dates (incluses), avec leur origine lisible. */
export async function changesBetween(db: DB, userId: string, from: string, to: string): Promise<ChangeRow[]> {
  const rows = await db
    .select({ ch: c, fromName: schema.schoolMessages.fromName, msgDate: schema.schoolMessages.date })
    .from(c)
    .leftJoin(schema.schoolMessages, eq(schema.schoolMessages.id, c.messageId))
    .where(and(eq(c.userId, userId), lte(c.date, to), gte(c.endDate, from)))
    .orderBy(asc(schema.schoolMessages.date));
  return rows.map(({ ch, fromName, msgDate }) => ({
    ...ch,
    origin: ch.source === "holiday" ? "Jour férié" : ch.source === "vacation" ? "Calendrier scolaire" : `Message de ${fromName ?? "la vie scolaire"}${msgDate ? ` du ${shortDate(msgDate)}` : ""}`,
  }));
}

/**
 * Semaine type tirée des derniers emplois du temps reçus (12 semaines) : sert à corriger les semaines
 * pour lesquelles aucun emploi du temps n'a encore été envoyé (intitulés faux d'École Directe, cours des autres groupes).
 */
async function weekTemplate(db: DB, userId: string, tz: string) {
  const today = localNow(tz).date;
  const rows = (await changesBetween(db, userId, shiftDate(today, -84), shiftDate(today, 21))).filter((r) => r.source === "message" && ["lesson", "week", "closed"].includes(r.action));
  const dates = [...new Set(rows.filter((r) => r.action === "lesson").map((r) => r.date))];
  if (!dates.length) return new Map();
  const ed = await db
    .select()
    .from(schema.schoolLessons)
    .where(and(eq(schema.schoolLessons.userId, userId), eq(schema.schoolLessons.source, "ecoledirecte"), gte(schema.schoolLessons.startAt, new Date(`${dates.sort()[0]}T00:00:00Z`)), lt(schema.schoolLessons.startAt, new Date(`${shiftDate(dates.at(-1)!, 1)}T12:00:00Z`))));
  return learnTemplate(ed, rows, tz);
}

export async function timetableView(db: DB, userId: string, from: Date, to: Date) {
  const tz = await userTz(db, userId);
  const fromDate = localParts(from, tz).date;
  const toDate = localParts(new Date(to.getTime() - 1), tz).date;
  const [lessons, changes, homework, account, lastMsg, template, document] = await Promise.all([
    db.select().from(schema.schoolLessons).where(and(eq(schema.schoolLessons.userId, userId), gte(schema.schoolLessons.startAt, from), lt(schema.schoolLessons.startAt, to))).orderBy(asc(schema.schoolLessons.startAt)),
    changesBetween(db, userId, fromDate, toDate),
    db.select().from(schema.schoolHomework).where(and(eq(schema.schoolHomework.userId, userId), gte(schema.schoolHomework.dueDate, fromDate), lte(schema.schoolHomework.dueDate, toDate))).orderBy(asc(schema.schoolHomework.dueDate)),
    db.select({ gcalEnabled: schema.schoolAccounts.gcalEnabled, gcalId: schema.schoolAccounts.gcalId, gcalSyncedAt: schema.schoolAccounts.gcalSyncedAt, gcalError: schema.schoolAccounts.gcalError }).from(schema.schoolAccounts).where(eq(schema.schoolAccounts.userId, userId)),
    db
      .select({ id: schema.schoolMessages.id, subject: schema.schoolMessages.subject, fromName: schema.schoolMessages.fromName, date: schema.schoolMessages.date, note: schema.schoolMessages.agentNote, at: schema.schoolMessages.agentAt })
      .from(schema.schoolMessages)
      .where(and(eq(schema.schoolMessages.userId, userId), isNotNull(schema.schoolMessages.agentNote), ne(schema.schoolMessages.agentNote, "")))
      .orderBy(desc(schema.schoolMessages.date))
      .limit(1),
    weekTemplate(db, userId, tz),
    weekDocument(db, userId, fromDate, tz),
  ]);
  const view = applyChanges(lessons, changes, tz, template);
  return {
    document,
    items: view.lessons,
    days: view.days,
    homework: homework.map((h) => ({ id: h.id, subject: h.subject, title: h.title, dueDate: h.dueDate, isTest: h.isTest, done: h.done, lessonId: lessonFor(h, view.lessons, tz) })),
    agent: lastMsg[0] ? { ...lastMsg[0], date: lastMsg[0].date.toISOString(), at: lastMsg[0].at?.toISOString() ?? null } : null,
    google: account[0] ? { enabled: account[0].gcalEnabled, linked: !!account[0].gcalId, separate: !!account[0].gcalId && account[0].gcalId !== "primary", syncedAt: account[0].gcalSyncedAt?.toISOString() ?? null, error: account[0].gcalError } : null,
  };
}

/* ---------------------------------------------------------------- fériés et vacances */

const g = globalThis as { __schoolDays?: Map<string, number> };
const refreshed = (g.__schoolDays ??= new Map());

/** Met à jour les jours fériés (calculés) et les vacances scolaires (académie de Paris, zone C), une fois par jour au plus. */
export async function refreshSchoolDays(db: DB, userId: string, force = false) {
  if (!force && Date.now() - (refreshed.get(userId) ?? 0) < 20 * 3600_000) return;
  refreshed.set(userId, Date.now());
  const today = localNow(await userTz(db, userId)).date;
  const y = Number(today.slice(0, 4));
  const holidays = [y - 1, y, y + 1].flatMap(publicHolidays);
  await db.delete(c).where(and(eq(c.userId, userId), eq(c.source, "holiday")));
  await db.insert(c).values(holidays.map((h) => ({ userId, source: "holiday", date: h.date, endDate: h.date, action: "closed", subject: `Férié · ${h.name}`, note: h.name })));
  try {
    const vacations = await fetchVacations(today);
    if (!vacations.length) return;
    await db.delete(c).where(and(eq(c.userId, userId), eq(c.source, "vacation")));
    await db.insert(c).values(vacations.map((v) => ({ userId, source: "vacation", date: v.date, endDate: v.endDate, action: "closed", subject: v.name, note: v.name })));
  } catch (e) {
    // Les vacances déjà connues restent en place.
    log.warn("school.vacations_failed", { error: String(e) });
  }
}
