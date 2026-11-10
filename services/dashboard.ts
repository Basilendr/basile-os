import "server-only";
import { and, asc, desc, eq, isNull, lte, ne, sql } from "drizzle-orm";
import type { DB } from "@/lib/db";
import { schema } from "@/lib/db";
import { addDays, isoDate } from "@/lib/utils";
import { DEFAULT_WIDGETS, WIDGETS, WIDGET_SLOTS, type WidgetKey } from "@/lib/catalog";
import { taskCounts } from "./tasks";
import { listEvents } from "./calendar";
import { listProjects } from "./projects";
import { isServiceConnected } from "./google/oauth";
import { recentActivity } from "./activity";
import { rowsOf } from "@/lib/sql";

/** Données de la vue d'ensemble — exclusivement issues des données réelles de l'utilisateur. */
export async function dashboard(db: DB, userId: string, tz: { from: Date; to: Date }, periodDays = 7) {
  const today = isoDate();
  const [counts, events, projects, gmailOn, calendarOn, activity, widgets, briefing, trend] = await Promise.all([
    taskCounts(db, userId),
    listEvents(db, userId, tz.from, tz.to),
    listProjects(db, userId),
    isServiceConnected(db, userId, "gmail"),
    isServiceConnected(db, userId, "calendar"),
    recentActivity(db, userId, 12),
    db.select().from(schema.dashboardWidgets).where(eq(schema.dashboardWidgets.userId, userId)).orderBy(asc(schema.dashboardWidgets.position)),
    db.select().from(schema.briefings).where(and(eq(schema.briefings.userId, userId), eq(schema.briefings.date, today))).orderBy(desc(schema.briefings.createdAt)).limit(1),
    trends(db, userId, periodDays),
  ]);

  const todayTasks = await db
    .select({ task: schema.tasks, projectName: schema.projects.name, projectColor: schema.projects.color })
    .from(schema.tasks)
    .leftJoin(schema.projects, eq(schema.projects.id, schema.tasks.projectId))
    .where(and(eq(schema.tasks.userId, userId), sql`(${schema.tasks.dueDate} = ${today} or (${schema.tasks.status} = 'done' and ${schema.tasks.completedAt} >= date_trunc('day', now())))`))
    .orderBy(sql`${schema.tasks.dueTime} asc nulls last`);

  const deadlines = await db
    .select({ id: schema.tasks.id, title: schema.tasks.title, dueDate: schema.tasks.dueDate, priority: schema.tasks.priority, projectName: schema.projects.name })
    .from(schema.tasks)
    .leftJoin(schema.projects, eq(schema.projects.id, schema.tasks.projectId))
    .where(and(eq(schema.tasks.userId, userId), ne(schema.tasks.status, "done"), lte(schema.tasks.dueDate, isoDate(addDays(new Date(), 7)))))
    .orderBy(asc(schema.tasks.dueDate))
    .limit(8);

  let unreadEmails: number | null = null;
  let importantEmails: number | null = null;
  if (gmailOn) {
    const [r] = await db
      .select({
        unread: sql<number>`count(*) filter (where ${schema.emailMessages.isUnread} and 'INBOX' = any(${schema.emailMessages.labelIds}))::int`,
        important: sql<number>`count(*) filter (where ${schema.emailMessages.isUnread} and ${schema.emailMessages.isImportant} and 'INBOX' = any(${schema.emailMessages.labelIds}))::int`,
      })
      .from(schema.emailMessages)
      .where(eq(schema.emailMessages.userId, userId));
    unreadEmails = r.unread;
    importantEmails = r.important;
  }

  const [notif] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.notifications)
    .where(and(eq(schema.notifications.userId, userId), isNull(schema.notifications.readAt), eq(schema.notifications.importance, "high")));

  const now = Date.now();
  const upcoming = events.filter((e) => e.endAt.getTime() > now);
  const conflicts = findConflicts(events.filter((e) => !e.allDay));

  return {
    counts,
    stats: {
      doneToday: counts.doneToday,
      openToday: counts.today,
      overdue: counts.overdue,
      upcomingEvents: upcoming.length,
      nextEvent: upcoming[0] ? { id: upcoming[0].id, title: upcoming[0].title, startAt: upcoming[0].startAt } : null,
      unreadEmails,
      importantEmails,
      activeProjects: projects.filter((p) => p.status === "active").length,
      importantNotifications: notif.n,
    },
    connections: { gmail: gmailOn, calendar: calendarOn },
    events,
    todayTasks: todayTasks.map((r) => ({ ...r.task, projectName: r.projectName, projectColor: r.projectColor })),
    projects: projects.filter((p) => p.status === "active" || p.status === "planning").slice(0, 6),
    deadlines,
    conflicts,
    activity,
    trend,
    widgets: normalizeWidgets(widgets),
    briefing: briefing[0] ?? null,
    context: contextLine({ events: upcoming.length, today: counts.today, overdue: counts.overdue, important: importantEmails, conflicts: conflicts.length }),
  };
}

/**
 * Indicateurs de la période (N derniers jours) comparés à la période précédente de même durée,
 * plus la série quotidienne pour le graphique d'activité. Uniquement des comptages réels.
 */
async function trends(db: DB, userId: string, days: number) {
  const t = schema.tasks;
  const [k] = rowsOf<Record<string, number>>(
    await db.execute(sql`
      with w as (select now() - make_interval(days => ${days}) as a, now() - make_interval(days => ${days * 2}) as b)
      select
        (select count(*)::int from ${t}, w where user_id = ${userId} and completed_at > w.a) as done_cur,
        (select count(*)::int from ${t}, w where user_id = ${userId} and completed_at > w.b and completed_at <= w.a) as done_prev,
        (select count(*)::int from ${t}, w where user_id = ${userId} and created_at > w.a) as created_cur,
        (select count(*)::int from ${t}, w where user_id = ${userId} and created_at > w.b and created_at <= w.a) as created_prev,
        (select count(*)::int from ${schema.calendarEvents}, w where user_id = ${userId} and status <> 'cancelled' and start_at > w.a and start_at <= now()) as events_cur,
        (select count(*)::int from ${schema.calendarEvents}, w where user_id = ${userId} and status <> 'cancelled' and start_at > w.b and start_at <= w.a) as events_prev,
        (select count(*)::int from ${schema.emailMessages}, w where user_id = ${userId} and 'INBOX' = any(label_ids) and internal_date > w.a) as mail_cur,
        (select count(*)::int from ${schema.emailMessages}, w where user_id = ${userId} and 'INBOX' = any(label_ids) and internal_date > w.b and internal_date <= w.a) as mail_prev,
        (select count(*)::int from ${schema.notes}, w where user_id = ${userId} and updated_at > w.a) as notes_cur,
        (select count(*)::int from ${schema.notes}, w where user_id = ${userId} and updated_at > w.b and updated_at <= w.a) as notes_prev,
        (select count(*)::int from ${t}, w where user_id = ${userId} and completed_at > w.a and due_date is not null and completed_at::date <= due_date) as on_time,
        (select count(*)::int from ${t}, w where user_id = ${userId} and completed_at > w.a and due_date is not null) as with_due`),
  );
  const series = rowsOf<{ d: string; done: number; created: number; events: number }>(
    await db.execute(sql`
      with s as (select generate_series(date_trunc('day', now()) - make_interval(days => ${days - 1}), date_trunc('day', now()), '1 day'::interval) d)
      select to_char(d, 'YYYY-MM-DD') as d,
        (select count(*)::int from ${t} where user_id = ${userId} and date_trunc('day', completed_at) = s.d) as done,
        (select count(*)::int from ${t} where user_id = ${userId} and date_trunc('day', created_at) = s.d) as created,
        (select count(*)::int from ${schema.calendarEvents} where user_id = ${userId} and status <> 'cancelled' and date_trunc('day', start_at) = s.d) as events
      from s order by d`),
  );
  const pair = (cur: number, prev: number) => ({ cur, prev, delta: prev ? Math.round(((cur - prev) / prev) * 100) : null });
  return {
    days,
    tasksDone: pair(k.done_cur, k.done_prev),
    tasksCreated: pair(k.created_cur, k.created_prev),
    events: pair(k.events_cur, k.events_prev),
    emails: pair(k.mail_cur, k.mail_prev),
    notes: pair(k.notes_cur, k.notes_prev),
    onTimeRate: k.with_due ? Math.round((k.on_time / k.with_due) * 100) : null,
    series,
  };
}

function findConflicts(events: { id: string; title: string; startAt: Date; endAt: Date }[]) {
  const out: { a: string; b: string; titles: [string, string] }[] = [];
  const sorted = [...events].sort((x, y) => x.startAt.getTime() - y.startAt.getTime());
  for (let i = 0; i < sorted.length; i++)
    for (let j = i + 1; j < sorted.length && sorted[j].startAt < sorted[i].endAt; j++) out.push({ a: sorted[i].id, b: sorted[j].id, titles: [sorted[i].title, sorted[j].title] });
  return out;
}

/** Phrase de contexte factuelle construite à partir des compteurs réels (aucune invention). */
function contextLine(c: { events: number; today: number; overdue: number; important: number | null; conflicts: number }) {
  const parts: string[] = [];
  if (c.events) parts.push(`${c.events} ${c.events > 1 ? "rendez-vous restants" : "rendez-vous restant"}`);
  if (c.today) parts.push(`${c.today} ${c.today > 1 ? "tâches prévues" : "tâche prévue"}`);
  if (c.important) parts.push(`${c.important} ${c.important > 1 ? "emails importants non lus" : "email important non lu"}`);
  let s = parts.length ? `Ta journée comporte ${parts.join(", ").replace(/, ([^,]*)$/, " et $1")}.` : "Aucun rendez-vous ni tâche prévus aujourd'hui.";
  if (c.overdue) s += ` ${c.overdue} ${c.overdue > 1 ? "tâches sont" : "tâche est"} en retard.`;
  if (c.conflicts) s += ` Attention : ${c.conflicts} conflit${c.conflicts > 1 ? "s" : ""} d'agenda.`;
  return s;
}

export async function saveWidgets(db: DB, userId: string, widgets: { widgetKey: string; position: number; size: string; visible: boolean }[]) {
  await db.delete(schema.dashboardWidgets).where(eq(schema.dashboardWidgets.userId, userId));
  if (widgets.length) await db.insert(schema.dashboardWidgets).values(widgets.map((w) => ({ ...w, userId })));
}



/**
 * Ignore les widgets retirés du catalogue et complète avec les nouveaux.
 * Une disposition antérieure à l'accueil sur un seul écran (sans « today ») repart des valeurs par défaut.
 */
function normalizeWidgets(rows: { widgetKey: string; position: number; size: string; visible: boolean }[]) {
  const defaults = DEFAULT_WIDGETS.map((k, i) => ({ widgetKey: k as WidgetKey, position: i, size: WIDGETS[k].defaultSize as string, visible: i < WIDGET_SLOTS }));
  if (!rows.some((w) => w.widgetKey === "today")) return defaults;
  const known = rows.filter((w) => w.widgetKey in WIDGETS).sort((a, b) => a.position - b.position);
  const missing = DEFAULT_WIDGETS.filter((k) => !known.some((w) => w.widgetKey === k));
  return [...known, ...missing.map((k, i) => ({ widgetKey: k as WidgetKey, position: known.length + i, size: WIDGETS[k].defaultSize as string, visible: false }))];
}
