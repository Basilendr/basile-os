import "server-only";
import { and, asc, desc, eq, gte, inArray, isNotNull, lt, lte, ne, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/lib/db";
import { schema } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { zDate, zPriority, zTime } from "@/lib/api";
import { isoDate, addDays } from "@/lib/utils";
import { logActivity } from "./activity";
import { emit } from "./events";

export const TaskStatusZ = z.enum(["todo", "in_progress", "review", "done"]);

export const TaskCreate = z.object({
  title: z.string().trim().min(1, "Titre requis").max(300),
  description: z.string().max(20_000).default(""),
  status: TaskStatusZ.default("todo"),
  priority: zPriority.default("medium"),
  dueDate: zDate.nullable().optional(),
  dueTime: zTime.nullable().optional(),
  category: z.string().trim().max(60).nullable().optional(),
  projectId: z.uuid().nullable().optional(),
  reminderAt: z.iso.datetime({ offset: true }).nullable().optional(),
  sourceType: z.enum(["email", "note", "ai", "automation", "event"]).nullable().optional(),
  sourceId: z.string().max(200).nullable().optional(),
  subtasks: z.array(z.string().trim().min(1).max(300)).max(50).optional(),
});
export type TaskCreateInput = z.input<typeof TaskCreate>;

export const TaskUpdate = TaskCreate.omit({ subtasks: true, sourceType: true, sourceId: true })
  .partial()
  .extend({
    position: z.number().optional(),
    attachments: z.array(z.object({ fileId: z.uuid(), name: z.string().max(300) })).max(30).optional(),
  });

export const TaskQuery = z.object({
  view: z.enum(["today", "upcoming", "all", "overdue", "done", "project"]).default("all"),
  projectId: z.uuid().optional(),
  q: z.string().max(200).optional(),
  priority: zPriority.optional(),
  status: TaskStatusZ.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(300),
});

async function assertProject(db: DB, userId: string, projectId: string | null | undefined) {
  if (!projectId) return;
  const [p] = await db.select({ id: schema.projects.id }).from(schema.projects).where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)));
  if (!p) throw notFound("Projet");
}

export async function listTasks(db: DB, userId: string, q: z.infer<typeof TaskQuery>) {
  const t = schema.tasks;
  const today = isoDate();
  const where: SQL[] = [eq(t.userId, userId)];
  switch (q.view) {
    case "today":
      where.push(ne(t.status, "done"), sql`(${t.dueDate} <= ${today})`);
      break;
    case "upcoming":
      where.push(ne(t.status, "done"), gte(t.dueDate, isoDate(addDays(new Date(), 1))));
      break;
    case "overdue":
      where.push(ne(t.status, "done"), lt(t.dueDate, today));
      break;
    case "done":
      where.push(eq(t.status, "done"));
      break;
  }
  if (q.projectId) where.push(eq(t.projectId, q.projectId));
  if (q.priority) where.push(eq(t.priority, q.priority));
  if (q.status) where.push(eq(t.status, q.status));
  if (q.q) where.push(sql`unaccent(lower(${t.title})) like unaccent(lower(${"%" + q.q + "%"}))`);

  const rows = await db
    .select({
      task: t,
      projectName: schema.projects.name,
      projectColor: schema.projects.color,
      subtaskTotal: sql<number>`(select count(*)::int from ${schema.subtasks} s where s.task_id = ${t.id})`,
      subtaskDone: sql<number>`(select count(*)::int from ${schema.subtasks} s where s.task_id = ${t.id} and s.done)`,
    })
    .from(t)
    .leftJoin(schema.projects, eq(schema.projects.id, t.projectId))
    .where(and(...where))
    .orderBy(
      q.view === "done" ? desc(t.completedAt) : sql`${t.dueDate} asc nulls last`,
      sql`case ${t.priority} when 'urgent' then 0 when 'high' then 1 when 'medium' then 2 else 3 end`,
      asc(t.position),
      desc(t.createdAt),
    )
    .limit(q.limit);
  return rows.map((r) => ({ ...r.task, projectName: r.projectName, projectColor: r.projectColor, subtaskTotal: r.subtaskTotal, subtaskDone: r.subtaskDone }));
}

export async function getTask(db: DB, userId: string, id: string) {
  const [task] = await db.select().from(schema.tasks).where(and(eq(schema.tasks.id, id), eq(schema.tasks.userId, userId)));
  if (!task) throw notFound("Tâche");
  const subtasks = await db.select().from(schema.subtasks).where(eq(schema.subtasks.taskId, id)).orderBy(asc(schema.subtasks.position), asc(schema.subtasks.createdAt));
  return { ...task, subtasks };
}

export async function createTask(db: DB, userId: string, raw: TaskCreateInput) {
  const input = TaskCreate.parse(raw);
  await assertProject(db, userId, input.projectId);
  const { subtasks, reminderAt, ...rest } = input;
  const [{ maxPos }] = await db.select({ maxPos: sql<number>`coalesce(max(${schema.tasks.position}), 0)` }).from(schema.tasks).where(eq(schema.tasks.userId, userId));
  const [task] = await db
    .insert(schema.tasks)
    .values({
      ...rest,
      userId,
      position: Number(maxPos) + 1,
      reminderAt: reminderAt ? new Date(reminderAt) : null,
      completedAt: rest.status === "done" ? new Date() : null,
    })
    .returning();
  if (subtasks?.length) {
    await db.insert(schema.subtasks).values(subtasks.map((title, i) => ({ userId, taskId: task.id, title, position: i })));
  }
  await logActivity(db, userId, { type: "task.created", title: `Tâche créée : ${task.title}`, entityType: "task", entityId: task.id });
  await emit(db, { type: "task.created", userId, entityType: "task", entityId: task.id, data: task, key: `task.created:${task.id}` });
  return task;
}

export async function updateTask(db: DB, userId: string, id: string, raw: z.input<typeof TaskUpdate>) {
  const patch = TaskUpdate.parse(raw);
  const before = await getTask(db, userId, id);
  if (patch.projectId !== undefined) await assertProject(db, userId, patch.projectId);
  const values: Partial<typeof schema.tasks.$inferInsert> = { ...patch, reminderAt: patch.reminderAt === undefined ? undefined : patch.reminderAt ? new Date(patch.reminderAt) : null };
  if (patch.reminderAt !== undefined) values.reminderSentAt = null;
  const completing = patch.status === "done" && before.status !== "done";
  const reopening = patch.status && patch.status !== "done" && before.status === "done";
  if (completing) values.completedAt = new Date();
  if (reopening) values.completedAt = null;
  if (patch.dueDate && before.dueDate && patch.dueDate > before.dueDate) values.postponedCount = before.postponedCount + 1;

  const [task] = await db.update(schema.tasks).set(values).where(and(eq(schema.tasks.id, id), eq(schema.tasks.userId, userId))).returning();
  if (completing) {
    await logActivity(db, userId, { type: "task.completed", title: `Tâche terminée : ${task.title}`, entityType: "task", entityId: id, meta: { projectId: task.projectId } });
    await emit(db, { type: "task.completed", userId, entityType: "task", entityId: id, data: task, key: `task.completed:${id}:${task.completedAt?.getTime()}` });
  } else if (Object.keys(patch).some((k) => k !== "position")) {
    await logActivity(db, userId, { type: "task.updated", title: `Tâche modifiée : ${task.title}`, entityType: "task", entityId: id, meta: { fields: Object.keys(patch) } });
  }
  return task;
}

export async function deleteTask(db: DB, userId: string, id: string) {
  const [t] = await db.delete(schema.tasks).where(and(eq(schema.tasks.id, id), eq(schema.tasks.userId, userId))).returning();
  if (!t) throw notFound("Tâche");
  await logActivity(db, userId, { type: "task.deleted", title: `Tâche supprimée : ${t.title}`, entityType: "task", entityId: id });
  return t;
}

/** Réordonnancement Kanban : met à jour statut + position en une transaction. */
export async function moveTasks(db: DB, userId: string, moves: { id: string; status?: z.infer<typeof TaskStatusZ>; position: number }[]) {
  for (const m of moves) {
    if (m.status) await updateTask(db, userId, m.id, { status: m.status, position: m.position });
    else await db.update(schema.tasks).set({ position: m.position }).where(and(eq(schema.tasks.id, m.id), eq(schema.tasks.userId, userId)));
  }
}

/* Sous-tâches */
export async function addSubtask(db: DB, userId: string, taskId: string, title: string) {
  await getTask(db, userId, taskId);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.subtasks).where(eq(schema.subtasks.taskId, taskId));
  const [s] = await db.insert(schema.subtasks).values({ userId, taskId, title, position: n }).returning();
  return s;
}

export async function updateSubtask(db: DB, userId: string, id: string, patch: { title?: string; done?: boolean }) {
  const [s] = await db.update(schema.subtasks).set(patch).where(and(eq(schema.subtasks.id, id), eq(schema.subtasks.userId, userId))).returning();
  if (!s) throw notFound("Sous-tâche");
  return s;
}

export async function deleteSubtask(db: DB, userId: string, id: string) {
  const rows = await db.delete(schema.subtasks).where(and(eq(schema.subtasks.id, id), eq(schema.subtasks.userId, userId))).returning();
  if (!rows.length) throw notFound("Sous-tâche");
}

/** Compteurs utilisés par la vue d'ensemble et les vues de tâches. */
export async function taskCounts(db: DB, userId: string) {
  const t = schema.tasks;
  const today = isoDate();
  const [r] = await db
    .select({
      today: sql<number>`count(*) filter (where ${t.status} <> 'done' and ${t.dueDate} <= ${today})::int`,
      upcoming: sql<number>`count(*) filter (where ${t.status} <> 'done' and ${t.dueDate} > ${today})::int`,
      overdue: sql<number>`count(*) filter (where ${t.status} <> 'done' and ${t.dueDate} < ${today})::int`,
      open: sql<number>`count(*) filter (where ${t.status} <> 'done')::int`,
      done: sql<number>`count(*) filter (where ${t.status} = 'done')::int`,
      doneToday: sql<number>`count(*) filter (where ${t.status} = 'done' and ${t.completedAt} >= date_trunc('day', now()))::int`,
      all: sql<number>`count(*)::int`,
    })
    .from(t)
    .where(eq(t.userId, userId));
  return r;
}

/** Rappels arrivés à échéance (utilisé par l'ordonnanceur). */
export async function dueReminders(db: DB, now = new Date()) {
  return db
    .select()
    .from(schema.tasks)
    .where(and(isNotNull(schema.tasks.reminderAt), lte(schema.tasks.reminderAt, now), sql`${schema.tasks.reminderSentAt} is null`, ne(schema.tasks.status, "done")))
    .limit(100);
}

export async function tasksByIds(db: DB, userId: string, ids: string[]) {
  if (!ids.length) return [];
  return db.select().from(schema.tasks).where(and(eq(schema.tasks.userId, userId), inArray(schema.tasks.id, ids)));
}
