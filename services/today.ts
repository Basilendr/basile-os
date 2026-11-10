import "server-only";
import { and, asc, eq, gte, lt, lte, ne, sql } from "drizzle-orm";
import { schema, type DB } from "@/lib/db";
import { overview as quizOverview, userTz } from "./quiz/quiz";
import { localNow, shiftDate, zonedMidnight } from "./quiz/time";
import { focusOverview } from "./school/focus";
import { timetableView } from "./school/timetable";

/**
 * Écran « Aujourd'hui » : cours du jour (emploi du temps à jour), devoirs pour le prochain jour de cours,
 * évaluations proches, quiz du jour, temps de travail, tâches et rendez-vous du jour.
 */
export async function todayView(db: DB, userId: string) {
  const tz = await userTz(db, userId);
  const now = localNow(tz);
  const start = zonedMidnight(now.date, tz);
  const end = zonedMidnight(shiftDate(now.date, 1), tz);
  const hw = schema.schoolHomework;
  const t = schema.tasks;
  const ev = schema.calendarEvents;

  const [view, week, homework, tests, quiz, focus, tasks, events, unread, profile] = await Promise.all([
    timetableView(db, userId, start, end),
    // Les 7 jours qui suivent : pour trouver le prochain jour de cours.
    timetableView(db, userId, end, zonedMidnight(shiftDate(now.date, 8), tz)),
    db.select().from(hw).where(and(eq(hw.userId, userId), eq(hw.isTest, false), gte(hw.dueDate, now.date), lte(hw.dueDate, shiftDate(now.date, 7)))).orderBy(asc(hw.dueDate)),
    db.select().from(hw).where(and(eq(hw.userId, userId), eq(hw.isTest, true), gte(hw.dueDate, now.date), lte(hw.dueDate, shiftDate(now.date, 14)))).orderBy(asc(hw.dueDate)),
    quizOverview(db, userId).catch(() => null),
    focusOverview(db, userId).catch(() => null),
    db.select().from(t).where(and(eq(t.userId, userId), ne(t.status, "done"), lte(t.dueDate, now.date))).orderBy(asc(t.dueDate)).limit(8),
    db.select().from(ev).where(and(eq(ev.userId, userId), eq(ev.status, "confirmed"), lt(ev.startAt, end), gte(ev.endAt, start))).orderBy(asc(ev.startAt)).limit(10),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.schoolMessages).where(and(eq(schema.schoolMessages.userId, userId), eq(schema.schoolMessages.read, false))),
    db.select({ name: schema.profiles.displayName }).from(schema.profiles).where(eq(schema.profiles.userId, userId)),
  ]);

  const dateOf = (iso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: tz });
  // Prochain jour avec des cours (demain en semaine, lundi le vendredi soir…) : les devoirs à préparer pour ce jour-là.
  const nextDay = week.items.find((l) => !l.cancelled)?.startAt;
  const nextDate = nextDay ? dateOf(nextDay) : shiftDate(now.date, 1);
  const isGoogleSchool = (e: typeof ev.$inferSelect) => /^⚠︎ |^(Devoir|Évaluation) · /.test(e.title);

  return {
    date: now.date,
    name: profile[0]?.name ?? null,
    school: {
      lessons: view.items.filter((l) => !l.cancelled || l.change),
      days: view.days,
      document: view.document,
      nextDate,
      nextLessons: week.items.filter((l) => dateOf(l.startAt) === nextDate && !l.cancelled).map((l) => ({ id: l.id, subject: l.subject, startAt: l.startAt })),
      homeworkToday: homework.filter((h) => h.dueDate === now.date).map(pickHw),
      homeworkNext: homework.filter((h) => h.dueDate === nextDate).map(pickHw),
      homeworkLater: homework.filter((h) => h.dueDate > nextDate && !h.done).map(pickHw),
      tests: tests.map(pickHw),
      unreadMessages: unread[0]?.n ?? 0,
    },
    quiz: quiz ? { state: quiz.today.state, slotHour: quiz.today.slotHour, quizzes: quiz.today.quizzes, cardsDue: quiz.cards.due, streak: quiz.stats.streak } : null,
    focus: focus ? { todayMinutes: focus.today.minutes, sessions: focus.today.sessions, streak: focus.streak } : null,
    tasks: tasks.map((x) => ({ id: x.id, title: x.title, dueDate: x.dueDate, dueTime: x.dueTime, priority: x.priority, overdue: !!x.dueDate && x.dueDate < now.date })),
    events: events.filter((e) => !isGoogleSchool(e)).map((e) => ({ id: e.id, title: e.title, startAt: e.startAt.toISOString(), endAt: e.endAt.toISOString(), allDay: e.allDay, location: e.location })),
  };
}

const pickHw = (h: typeof schema.schoolHomework.$inferSelect) => ({ id: h.id, subject: h.subject, title: h.title, dueDate: h.dueDate, done: h.done, isTest: h.isTest });

export type TodayView = Awaited<ReturnType<typeof todayView>>;
