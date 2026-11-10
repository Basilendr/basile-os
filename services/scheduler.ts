import "server-only";
import { and, eq, gt, isNull, lte, ne, sql } from "drizzle-orm";
import { getDb, schema, type DB } from "@/lib/db";
import { env, serverless } from "@/lib/env";
import { log } from "@/lib/log";
import { rowsOf } from "@/lib/sql";
import { addDays, isoDate } from "@/lib/utils";
import { dueReminders } from "./tasks";
import { notify } from "./notifications";
import { emit } from "./events";

type Job = { name: string; everyMs: number; run: (db: DB) => Promise<void> };
const jobs: Job[] = [];
const g = globalThis as unknown as { __basileScheduler?: NodeJS.Timeout; __basileJobsLast?: Record<string, number>; __basileRunning?: Set<string> };

export function registerJob(job: Job) {
  if (!jobs.find((j) => j.name === job.name)) jobs.push(job);
}

/** Ordonnanceur interne (une instance) : tick chaque 30 s, chaque tâche protégée contre le chevauchement. */
export function startScheduler() {
  if (g.__basileScheduler || env.DISABLE_SCHEDULER === "1" || serverless) return;
  g.__basileJobsLast ??= {};
  g.__basileRunning ??= new Set();
  g.__basileScheduler = setInterval(tick, 30_000);
  setTimeout(tick, 5_000);
  log.info("scheduler.started", { jobs: jobs.map((j) => j.name) });
}

async function tick() {
  const db = await getDb().catch(() => null);
  if (!db) return;
  for (const job of jobs) {
    const last = g.__basileJobsLast![job.name] ?? 0;
    if (Date.now() - last < job.everyMs || g.__basileRunning!.has(job.name)) continue;
    g.__basileRunning!.add(job.name);
    g.__basileJobsLast![job.name] = Date.now();
    job
      .run(db)
      .catch((e) => log.error("scheduler.job_failed", { job: job.name, error: String(e) }))
      .finally(() => g.__basileRunning!.delete(job.name));
  }
}

/**
 * Hébergement serverless (Vercel) : pas de minuterie permanente. Les tâches dues sont lancées après
 * les requêtes de l'interface et par la tâche cron ; la table job_runs évite qu'elles tournent deux fois.
 */
export async function runDueJobs(db?: DB) {
  db ??= await getDb();
  const due: Job[] = [];
  for (const job of jobs) {
    const res = await db.execute(sql`
      insert into job_runs (name, last_run_at) values (${job.name}, now())
      on conflict (name) do update set last_run_at = now()
      where job_runs.last_run_at < now() - make_interval(secs => ${job.everyMs / 1000})
      returning name`);
    if (rowsOf(res).length) due.push(job);
  }
  await Promise.all(due.map((job) => job.run(db).catch((e) => log.error("scheduler.job_failed", { job: job.name, error: String(e) }))));
  return due.map((j) => j.name);
}

/* ---------------------------------------------------------------- tâches périodiques de base */

registerJob({
  name: "task-reminders",
  everyMs: 30_000,
  async run(db) {
    for (const t of await dueReminders(db)) {
      await notify(db, t.userId, { type: "reminder", title: `Rappel : ${t.title}`, body: t.dueDate ? `Échéance ${t.dueDate}${t.dueTime ? ` à ${t.dueTime}` : ""}` : "", href: `/tasks?task=${t.id}`, entityType: "task", entityId: t.id, importance: "high", dedupeKey: `reminder:${t.id}:${t.reminderAt?.toISOString()}` });
      await db.update(schema.tasks).set({ reminderSentAt: new Date() }).where(eq(schema.tasks.id, t.id));
    }
  },
});

registerJob({
  name: "deadlines",
  everyMs: 15 * 60_000,
  async run(db) {
    const tomorrow = isoDate(addDays(new Date(), 1));
    const rows = await db
      .select()
      .from(schema.tasks)
      .where(and(ne(schema.tasks.status, "done"), lte(schema.tasks.dueDate, tomorrow)));
    for (const t of rows) {
      const overdue = t.dueDate! < isoDate();
      await notify(db, t.userId, {
        type: "deadline",
        title: overdue ? `En retard : ${t.title}` : `Échéance ${t.dueDate === tomorrow ? "demain" : "aujourd'hui"} : ${t.title}`,
        href: `/tasks?task=${t.id}`,
        entityType: "task",
        entityId: t.id,
        importance: overdue || t.priority === "urgent" ? "high" : "normal",
        dedupeKey: `deadline:${t.id}:${t.dueDate}:${overdue ? "late" : "soon"}`,
      });
      await emit(db, { type: "deadline.near", userId: t.userId, entityType: "task", entityId: t.id, data: { title: t.title, dueDate: t.dueDate, priority: t.priority, overdue }, key: `deadline.near:${t.id}:${t.dueDate}` });
    }
  },
});

registerJob({
  name: "events-soon",
  everyMs: 60_000,
  async run(db) {
    const now = new Date();
    const soon = new Date(now.getTime() + 15 * 60_000);
    const rows = await db
      .select()
      .from(schema.calendarEvents)
      .where(and(eq(schema.calendarEvents.allDay, false), gt(schema.calendarEvents.startAt, now), lte(schema.calendarEvents.startAt, soon), eq(schema.calendarEvents.status, "confirmed")));
    for (const e of rows) {
      await notify(db, e.userId, {
        type: "event_soon",
        title: `Bientôt : ${e.title}`,
        body: `${e.startAt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: e.timezone })}${e.location ? ` · ${e.location}` : ""}`,
        href: `/calendar?event=${e.id}`,
        entityType: "event",
        entityId: e.id,
        importance: "high",
        dedupeKey: `event-soon:${e.id}:${e.startAt.toISOString()}`,
      });
    }
  },
});

registerJob({
  name: "google-sync",
  everyMs: 5 * 60_000,
  async run(db) {
    const { syncGmail } = await import("./google/gmail");
    const { syncCalendar } = await import("./google/calendar");
    const rows = await db.select().from(schema.integrations).where(and(eq(schema.integrations.provider, "google"), eq(schema.integrations.status, "connected")));
    for (const i of rows) {
      try {
        if (i.service === "gmail") await syncGmail(db, i.userId);
        if (i.service === "calendar") await syncCalendar(db, i.userId);
      } catch (e) {
        await notify(db, i.userId, { type: "integration_error", title: `Synchronisation ${i.service === "gmail" ? "Gmail" : "Calendar"} en échec`, body: (e as Error).message.slice(0, 200), href: "/integrations", importance: "normal", dedupeKey: `sync-error:${i.service}:${isoDate()}` });
      }
    }
  },
});

registerJob({
  name: "mail-sync",
  everyMs: 10 * 60_000,
  async run(db) {
    const { syncMail } = await import("./mail/mail");
    const rows = await db.select({ userId: schema.mailAccounts.userId }).from(schema.mailAccounts).where(eq(schema.mailAccounts.status, "connected"));
    for (const r of rows) await syncMail(db, r.userId).catch((e) => log.warn("mail.sync_failed", { error: String(e) }));
  },
});

registerJob({
  name: "school-sync",
  everyMs: 10 * 60_000,
  async run(db) {
    const { syncSchool } = await import("./school/school");
    const rows = await db.select({ userId: schema.schoolAccounts.userId }).from(schema.schoolAccounts).where(serverless ? eq(schema.schoolAccounts.status, "connected") : ne(schema.schoolAccounts.status, "qcm_required"));
    // Sur le Mac, un compte passé en erreur (ex. refus venu d'un serveur hébergé) est retenté avec le mot de passe enregistré.
    for (const r of rows) await syncSchool(db, r.userId).catch((e) => log.warn("school.sync_failed", { error: String(e) }));
  },
});

registerJob({
  name: "cleanup",
  everyMs: 6 * 3600_000,
  async run(db) {
    await db.delete(schema.sessions).where(lte(schema.sessions.expiresAt, new Date()));
    await db.delete(schema.oauthStates).where(lte(schema.oauthStates.createdAt, new Date(Date.now() - 3600_000)));
    await db.execute(sql`delete from ${schema.notifications} where read_at is not null and created_at < now() - interval '90 days'`);
    void isNull;
  },
});

// Quiz de révision : cours du jour le soir, bilan le week-end, étapes avant les évaluations.
registerJob({
  name: "quiz-schedule",
  everyMs: 5 * 60_000,
  async run(db) {
    const { runQuizSchedule } = await import("./quiz/schedule");
    await runQuizSchedule(db);
  },
});
