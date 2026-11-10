import "server-only";
import { and, eq } from "drizzle-orm";
import { schema, type DB } from "@/lib/db";
import { notify } from "../notifications";
import { userTz } from "../quiz/quiz";
import { localNow, shiftDate, zonedMidnight } from "../quiz/time";
import { timetableView } from "./timetable";

export const REMINDER_HOUR = 18;

/** À partir de 18 h : une notification (une seule par soir) avec les devoirs pas encore faits pour le prochain jour de cours. */
export async function homeworkReminder(db: DB, userId: string) {
  const tz = await userTz(db, userId);
  const now = localNow(tz);
  if (now.hour < REMINDER_HOUR) return null;
  const from = zonedMidnight(shiftDate(now.date, 1), tz);
  const week = await timetableView(db, userId, from, zonedMidnight(shiftDate(now.date, 8), tz));
  const first = week.items.find((l) => !l.cancelled)?.startAt;
  if (!first) return null;
  const nextDate = new Date(first).toLocaleDateString("sv-SE", { timeZone: tz });
  // Le rappel ne concerne que le lendemain ou le prochain jour de cours après un week-end ou des jours fériés.
  if (nextDate > shiftDate(now.date, 4)) return null;
  const hw = schema.schoolHomework;
  const todo = await db.select().from(hw).where(and(eq(hw.userId, userId), eq(hw.dueDate, nextDate), eq(hw.done, false), eq(hw.isTest, false)));
  if (!todo.length) return null;
  const when = nextDate === shiftDate(now.date, 1) ? "demain" : new Date(`${nextDate}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", timeZone: "UTC" });
  const subjects = [...new Set(todo.map((h) => h.subject))];
  return notify(db, userId, {
    type: "homework",
    title: `${todo.length} devoir${todo.length > 1 ? "s" : ""} à faire pour ${when}`,
    body: subjects.slice(0, 4).join(", ") + (subjects.length > 4 ? "…" : ""),
    href: "/today",
    importance: "high",
    dedupeKey: `homework:${now.date}`,
  });
}
