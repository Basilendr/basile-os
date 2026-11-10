import "server-only";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";
import { schema, type DB } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { localNow, shiftDate, zonedMidnight } from "../quiz/time";
import { userTz } from "../quiz/quiz";
import { timetableView } from "./timetable";

/** Minuteur Pomodoro : séances de travail enregistrées par matière, et temps de travail du jour et de la semaine. */

const s = schema.studySessions;

export const FocusInput = z.object({
  subject: z.string().trim().min(1, "Choisis une matière").max(80),
  homeworkId: z.uuid().nullish(),
  minutes: z.number().int().min(1).max(240),
  completed: z.boolean().default(true),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime(),
});

export async function recordSession(db: DB, userId: string, raw: z.input<typeof FocusInput>) {
  const v = FocusInput.parse(raw);
  let homeworkId = v.homeworkId ?? null;
  if (homeworkId) {
    const [hw] = await db.select({ id: schema.schoolHomework.id }).from(schema.schoolHomework).where(and(eq(schema.schoolHomework.id, homeworkId), eq(schema.schoolHomework.userId, userId)));
    if (!hw) homeworkId = null;
  }
  const [row] = await db.insert(s).values({ userId, subject: v.subject, homeworkId, minutes: v.minutes, completed: v.completed, startedAt: new Date(v.startedAt), endedAt: new Date(v.endedAt) }).returning();
  return { id: row.id };
}

export async function deleteSession(db: DB, userId: string, id: string) {
  const [row] = await db.delete(s).where(and(eq(s.id, id), eq(s.userId, userId))).returning({ id: s.id });
  if (!row) throw notFound("Séance");
  return { ok: true };
}

/** Les cours qui ne sont pas des matières (repas, vie de classe…) ne sont pas proposés. */
const NOT_SUBJECT = /repas|self|pastorale|vie de classe|permanence|^etude|accomp|orient|aumonerie|cantine|pause/i;

const ACRONYMS = new Set(["SES", "SVT", "SNT", "EPS", "EMC", "NSI", "HGGSP", "LLCER", "DNL", "SI", "PC", "LV", "LCA", "ES", "TP", "TD"]);

/** « SCIENCES VIE & TERRE » → « Sciences Vie & Terre » ; les sigles (SES, SVT, LV2) restent en capitales. */
export function prettySubject(name: string) {
  const t = name.replace(/\s+/g, " ").trim();
  if (t !== t.toUpperCase() || !/[A-ZÀ-Ý]{5}/.test(t)) return t;
  return t.replace(/[A-Za-zÀ-ÿ0-9]+/g, (w) => (ACRONYMS.has(w) || /\d/.test(w) ? w : w[0] + w.slice(1).toLowerCase()));
}

const key = (x: string) =>
  x
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "");

export async function focusOverview(db: DB, userId: string) {
  const tz = await userTz(db, userId);
  const now = localNow(tz);
  const weekStart = shiftDate(now.date, -6);
  const since = zonedMidnight(weekStart, tz);
  const [sessions, lessons, homework, quizzes] = await Promise.all([
    db.select().from(s).where(and(eq(s.userId, userId), gte(s.endedAt, zonedMidnight(shiftDate(now.date, -30), tz)))).orderBy(desc(s.endedAt)).limit(400),
    timetableView(db, userId, zonedMidnight(shiftDate(now.date, -21), tz), zonedMidnight(shiftDate(now.date, 8), tz)).then((v) => v.items.filter((l) => !l.cancelled)),
    db.select().from(schema.schoolHomework).where(and(eq(schema.schoolHomework.userId, userId), gte(schema.schoolHomework.dueDate, now.date), lte(schema.schoolHomework.dueDate, shiftDate(now.date, 21)))),
    db.select({ subject: schema.quizzes.subject }).from(schema.quizzes).where(and(eq(schema.quizzes.userId, userId), gte(schema.quizzes.forDate, shiftDate(now.date, -30)))),
  ]);

  // Matières proposées : celles déjà travaillées d'abord, puis l'emploi du temps, les devoirs et les quiz.
  const subjects = new Map<string, string>();
  for (const name of [...sessions.map((x) => x.subject), ...quizzes.map((x) => x.subject ?? ""), ...homework.map((h) => h.subject), ...lessons.map((l) => l.subject)]) {
    const pretty = prettySubject(name);
    if (!pretty || NOT_SUBJECT.test(pretty) || subjects.has(key(pretty))) continue;
    subjects.set(key(pretty), pretty);
  }

  const week = sessions.filter((x) => x.endedAt >= since);
  const dayOf = (d: Date) => localNow(tz, d).date;
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = shiftDate(weekStart, i);
    const list = week.filter((x) => dayOf(x.endedAt) === date);
    return { date, minutes: list.reduce((n, x) => n + x.minutes, 0), sessions: list.filter((x) => x.completed).length };
  });
  const bySubject = new Map<string, number>();
  for (const x of week) bySubject.set(x.subject, (bySubject.get(x.subject) ?? 0) + x.minutes);
  let streak = 0;
  const worked = new Set(sessions.map((x) => dayOf(x.endedAt)));
  for (let d = worked.has(now.date) ? now.date : shiftDate(now.date, -1); worked.has(d); d = shiftDate(d, -1)) streak++;
  const today = days[6];

  return {
    subjects: [...subjects.values()].slice(0, 24),
    tests: homework.filter((h) => h.isTest).map((h) => ({ id: h.id, subject: prettySubject(h.subject), title: h.title, dueDate: h.dueDate })),
    today: { date: now.date, minutes: today.minutes, sessions: today.sessions },
    week: { minutes: days.reduce((n, d) => n + d.minutes, 0), days },
    bySubject: [...bySubject.entries()].map(([subject, minutes]) => ({ subject, minutes })).sort((a, b) => b.minutes - a.minutes),
    streak,
    recent: sessions.slice(0, 10).map((x) => ({ id: x.id, subject: x.subject, minutes: x.minutes, completed: x.completed, endedAt: x.endedAt.toISOString() })),
  };
}
