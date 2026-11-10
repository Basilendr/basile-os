import "server-only";
import { and, asc, desc, eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/lib/db";
import { schema } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { zDate, zPriority } from "@/lib/api";
import { logActivity } from "./activity";
import { emit } from "./events";
import { rowsOf } from "@/lib/sql";

export const ProjectStatusZ = z.enum(["planning", "active", "paused", "completed", "archived"]);

export const ProjectCreate = z.object({
  name: z.string().trim().min(1, "Nom requis").max(160),
  description: z.string().max(10_000).default(""),
  icon: z.string().max(40).default("folder"),
  coverUrl: z.string().url().max(2000).nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#6385FF"),
  status: ProjectStatusZ.default("active"),
  priority: zPriority.default("medium"),
  startDate: zDate.nullable().optional(),
  dueDate: zDate.nullable().optional(),
});
export const ProjectUpdate = ProjectCreate.partial();

export async function listProjects(db: DB, userId: string, opts: { status?: string; includeArchived?: boolean } = {}) {
  const p = schema.projects;
  const t = schema.tasks;
  const where = [eq(p.userId, userId)];
  if (opts.status) where.push(eq(p.status, opts.status));
  else if (!opts.includeArchived) where.push(sql`${p.status} <> 'archived'`);
  const rows = await db
    .select({
      project: p,
      total: sql<number>`count(${t.id})::int`,
      done: sql<number>`count(${t.id}) filter (where ${t.status} = 'done')::int`,
      overdue: sql<number>`count(${t.id}) filter (where ${t.status} <> 'done' and ${t.dueDate} < current_date)::int`,
      nextDue: sql<string | null>`min(${t.dueDate}) filter (where ${t.status} <> 'done')`,
    })
    .from(p)
    .leftJoin(t, eq(t.projectId, p.id))
    .where(and(...where))
    .groupBy(p.id)
    .orderBy(sql`case ${p.status} when 'active' then 0 when 'planning' then 1 when 'paused' then 2 when 'completed' then 3 else 4 end`, desc(p.updatedAt));
  return rows.map((r) => ({
    ...r.project,
    taskTotal: r.total,
    taskDone: r.done,
    taskOverdue: r.overdue,
    nextDue: r.nextDue,
    progress: r.total ? Math.round((r.done / r.total) * 100) : 0,
  }));
}

export async function getProject(db: DB, userId: string, id: string) {
  const [project] = await db.select().from(schema.projects).where(and(eq(schema.projects.id, id), eq(schema.projects.userId, userId)));
  if (!project) throw notFound("Projet");
  const [tasks, notes, files, milestones, activity, events, links] = await Promise.all([
    db.select().from(schema.tasks).where(and(eq(schema.tasks.userId, userId), eq(schema.tasks.projectId, id))).orderBy(asc(schema.tasks.position)),
    db
      .select({ id: schema.notes.id, title: schema.notes.title, updatedAt: schema.notes.updatedAt })
      .from(schema.notes)
      .where(and(eq(schema.notes.userId, userId), eq(schema.notes.projectId, id)))
      .orderBy(desc(schema.notes.updatedAt)),
    db
      .select({ id: schema.files.id, name: schema.files.name, mimeType: schema.files.mimeType, size: schema.files.size })
      .from(schema.files)
      .where(and(eq(schema.files.userId, userId), eq(schema.files.projectId, id), eq(schema.files.isFolder, false))),
    db.select().from(schema.projectMilestones).where(and(eq(schema.projectMilestones.userId, userId), eq(schema.projectMilestones.projectId, id))).orderBy(asc(schema.projectMilestones.position)),
    db
      .select()
      .from(schema.activityLogs)
      .where(
        and(
          eq(schema.activityLogs.userId, userId),
          or(
            and(eq(schema.activityLogs.entityType, "project"), eq(schema.activityLogs.entityId, id)),
            sql`${schema.activityLogs.meta}->>'projectId' = ${id}`,
          ),
        ),
      )
      .orderBy(desc(schema.activityLogs.createdAt))
      .limit(30),
    db
      .select({ id: schema.calendarEvents.id, title: schema.calendarEvents.title, startAt: schema.calendarEvents.startAt })
      .from(schema.calendarEvents)
      .where(and(eq(schema.calendarEvents.userId, userId), eq(schema.calendarEvents.projectId, id)))
      .orderBy(asc(schema.calendarEvents.startAt)),
    db
      .select()
      .from(schema.knowledgeRelationships)
      .where(
        and(
          eq(schema.knowledgeRelationships.userId, userId),
          or(
            and(eq(schema.knowledgeRelationships.fromType, "project"), eq(schema.knowledgeRelationships.fromId, id)),
            and(eq(schema.knowledgeRelationships.toType, "project"), eq(schema.knowledgeRelationships.toId, id)),
          ),
        ),
      ),
  ]);

  // Progression dans le temps : tâches terminées cumulées par semaine (12 dernières semaines)
  const progressSeries = await db.execute<{ week: string; done: number }>(sql`
    with weeks as (
      select generate_series(date_trunc('week', now()) - interval '11 weeks', date_trunc('week', now()), interval '1 week') as w
    )
    select to_char(w, 'YYYY-MM-DD') as week,
      (select count(*)::int from ${schema.tasks} t where t.user_id = ${userId} and t.project_id = ${id} and t.completed_at < w + interval '1 week') as done
    from weeks order by w`);

  const total = tasks.length;
  const done = tasks.filter((t) => t.status === "done").length;
  return {
    ...project,
    tasks,
    notes,
    files,
    milestones,
    activity,
    events,
    links,
    stats: {
      total,
      done,
      remaining: total - done,
      overdue: tasks.filter((t) => t.status !== "done" && t.dueDate && t.dueDate < new Date().toISOString().slice(0, 10)).length,
      progress: total ? Math.round((done / total) * 100) : 0,
    },
    progressSeries: rowsOf<{ week: string; done: number }>(progressSeries).map((r) => ({ week: r.week, done: Number(r.done), total })),
  };
}

export async function createProject(db: DB, userId: string, raw: z.input<typeof ProjectCreate>) {
  const input = ProjectCreate.parse(raw);
  const [p] = await db.insert(schema.projects).values({ ...input, userId }).returning();
  await logActivity(db, userId, { type: "project.created", title: `Projet créé : ${p.name}`, entityType: "project", entityId: p.id });
  await emit(db, { type: "project.created", userId, entityType: "project", entityId: p.id, data: p, key: `project.created:${p.id}` });
  return p;
}

export async function updateProject(db: DB, userId: string, id: string, raw: z.input<typeof ProjectUpdate>) {
  const patch = ProjectUpdate.parse(raw);
  const [p] = await db.update(schema.projects).set(patch).where(and(eq(schema.projects.id, id), eq(schema.projects.userId, userId))).returning();
  if (!p) throw notFound("Projet");
  await logActivity(db, userId, { type: "project.updated", title: `Projet modifié : ${p.name}`, entityType: "project", entityId: id, meta: { fields: Object.keys(patch) } });
  return p;
}

export async function deleteProject(db: DB, userId: string, id: string) {
  const [p] = await db.delete(schema.projects).where(and(eq(schema.projects.id, id), eq(schema.projects.userId, userId))).returning();
  if (!p) throw notFound("Projet");
  await logActivity(db, userId, { type: "project.deleted", title: `Projet supprimé : ${p.name}`, entityType: "project", entityId: id });
}

export const MilestoneInput = z.object({ title: z.string().trim().min(1).max(200), dueDate: zDate.nullable().optional(), done: z.boolean().optional() });

export async function addMilestone(db: DB, userId: string, projectId: string, raw: z.input<typeof MilestoneInput>) {
  const input = MilestoneInput.parse(raw);
  await getProjectRow(db, userId, projectId);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.projectMilestones).where(eq(schema.projectMilestones.projectId, projectId));
  const [m] = await db.insert(schema.projectMilestones).values({ ...input, userId, projectId, position: n }).returning();
  return m;
}

export async function updateMilestone(db: DB, userId: string, id: string, raw: Partial<z.input<typeof MilestoneInput>>) {
  const patch = MilestoneInput.partial().parse(raw);
  const [m] = await db.update(schema.projectMilestones).set(patch).where(and(eq(schema.projectMilestones.id, id), eq(schema.projectMilestones.userId, userId))).returning();
  if (!m) throw notFound("Étape");
  return m;
}

export async function deleteMilestone(db: DB, userId: string, id: string) {
  const r = await db.delete(schema.projectMilestones).where(and(eq(schema.projectMilestones.id, id), eq(schema.projectMilestones.userId, userId))).returning();
  if (!r.length) throw notFound("Étape");
}

async function getProjectRow(db: DB, userId: string, id: string) {
  const [p] = await db.select().from(schema.projects).where(and(eq(schema.projects.id, id), eq(schema.projects.userId, userId)));
  if (!p) throw notFound("Projet");
  return p;
}
