import "server-only";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/lib/db";
import { schema } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { logActivity } from "./activity";
import { indexEntity, removeEntity } from "./ai/embeddings";

export const ENTITY_TYPES = ["project", "task", "note", "file", "contact", "email", "event", "knowledge"] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const hrefFor = (type: string, id: string) =>
  ({ project: `/projects/${id}`, task: `/tasks?task=${id}`, note: `/notes?note=${id}`, file: `/files?file=${id}`, contact: `/contacts?contact=${id}`, email: `/inbox?message=${id}`, event: `/calendar?event=${id}`, knowledge: `/brain?item=${id}` })[type] ?? "/brain";

/** Résout des références (type, id) en titres + liens — seulement les entités de l'utilisateur. */
export async function resolveEntities(db: DB, userId: string, refs: { type: string; id: string }[]) {
  const out = new Map<string, { type: string; id: string; title: string; href: string }>();
  const by = (t: string) => [...new Set(refs.filter((r) => r.type === t).map((r) => r.id))];
  const uuid = (ids: string[]) => ids.filter((i) => /^[0-9a-f-]{36}$/.test(i));
  const put = (type: string, id: string, title: string) => out.set(`${type}:${id}`, { type, id, title, href: hrefFor(type, id) });
  const t = schema;
  const jobs: Promise<void>[] = [];
  const q = <R extends { id: string; title: string }>(type: string, p: Promise<R[]>) => jobs.push(p.then((rows) => rows.forEach((r) => put(type, r.id, r.title))));
  if (uuid(by("project")).length) q("project", db.select({ id: t.projects.id, title: t.projects.name }).from(t.projects).where(and(eq(t.projects.userId, userId), inArray(t.projects.id, uuid(by("project"))))));
  if (uuid(by("task")).length) q("task", db.select({ id: t.tasks.id, title: t.tasks.title }).from(t.tasks).where(and(eq(t.tasks.userId, userId), inArray(t.tasks.id, uuid(by("task"))))));
  if (uuid(by("note")).length) q("note", db.select({ id: t.notes.id, title: t.notes.title }).from(t.notes).where(and(eq(t.notes.userId, userId), inArray(t.notes.id, uuid(by("note"))))));
  if (uuid(by("file")).length) q("file", db.select({ id: t.files.id, title: t.files.name }).from(t.files).where(and(eq(t.files.userId, userId), inArray(t.files.id, uuid(by("file"))))));
  if (uuid(by("contact")).length) q("contact", db.select({ id: t.contacts.id, title: t.contacts.name }).from(t.contacts).where(and(eq(t.contacts.userId, userId), inArray(t.contacts.id, uuid(by("contact"))))));
  if (uuid(by("event")).length) q("event", db.select({ id: t.calendarEvents.id, title: t.calendarEvents.title }).from(t.calendarEvents).where(and(eq(t.calendarEvents.userId, userId), inArray(t.calendarEvents.id, uuid(by("event"))))));
  if (uuid(by("knowledge")).length) q("knowledge", db.select({ id: t.knowledgeItems.id, title: t.knowledgeItems.title }).from(t.knowledgeItems).where(and(eq(t.knowledgeItems.userId, userId), inArray(t.knowledgeItems.id, uuid(by("knowledge"))))));
  if (by("email").length) q("email", db.select({ id: t.emailMessages.gmailId, title: t.emailMessages.subject }).from(t.emailMessages).where(and(eq(t.emailMessages.userId, userId), inArray(t.emailMessages.gmailId, by("email")))));
  await Promise.all(jobs);
  return out;
}

/* ---------------------------------------------------------------- éléments de connaissance */

export const KnowledgeInput = z.object({
  kind: z.enum(["idea", "meeting", "summary", "reference", "email"]),
  title: z.string().trim().min(1).max(300),
  content: z.string().max(100_000).default(""),
  tags: z.array(z.string().max(40)).max(20).default([]),
  sourceType: z.string().max(40).nullable().optional(),
  sourceId: z.string().max(200).nullable().optional(),
});

export async function listKnowledge(db: DB, userId: string, kind?: string) {
  const where = [eq(schema.knowledgeItems.userId, userId)];
  if (kind) where.push(eq(schema.knowledgeItems.kind, kind));
  return db.select().from(schema.knowledgeItems).where(and(...where)).orderBy(desc(schema.knowledgeItems.updatedAt)).limit(300);
}

export async function createKnowledge(db: DB, userId: string, raw: z.input<typeof KnowledgeInput>) {
  const input = KnowledgeInput.parse(raw);
  const [k] = await db.insert(schema.knowledgeItems).values({ ...input, userId }).returning();
  await logActivity(db, userId, { type: "knowledge.created", title: `Ajouté au Second Brain : ${k.title}`, entityType: "knowledge", entityId: k.id });
  indexEntity(db, userId, "knowledge", k.id, `${k.title}\n\n${k.content}`).catch(() => null);
  return k;
}

export async function updateKnowledge(db: DB, userId: string, id: string, raw: Partial<z.input<typeof KnowledgeInput>>) {
  const patch = KnowledgeInput.partial().parse(raw);
  const [k] = await db.update(schema.knowledgeItems).set(patch).where(and(eq(schema.knowledgeItems.id, id), eq(schema.knowledgeItems.userId, userId))).returning();
  if (!k) throw notFound("Élément");
  indexEntity(db, userId, "knowledge", k.id, `${k.title}\n\n${k.content}`).catch(() => null);
  return k;
}

export async function deleteKnowledge(db: DB, userId: string, id: string) {
  const r = await db.delete(schema.knowledgeItems).where(and(eq(schema.knowledgeItems.id, id), eq(schema.knowledgeItems.userId, userId))).returning();
  if (!r.length) throw notFound("Élément");
  await removeEntity(db, userId, "knowledge", id);
  await db.delete(schema.knowledgeRelationships).where(and(eq(schema.knowledgeRelationships.userId, userId), or(and(eq(schema.knowledgeRelationships.fromType, "knowledge"), eq(schema.knowledgeRelationships.fromId, id)), and(eq(schema.knowledgeRelationships.toType, "knowledge"), eq(schema.knowledgeRelationships.toId, id)))));
}

/* ---------------------------------------------------------------- relations */

export const LinkInput = z.object({ fromType: z.enum(ENTITY_TYPES), fromId: z.string().min(1).max(200), toType: z.enum(ENTITY_TYPES), toId: z.string().min(1).max(200), relation: z.string().max(40).default("related") });

export async function link(db: DB, userId: string, raw: z.input<typeof LinkInput>) {
  const l = LinkInput.parse(raw);
  const resolved = await resolveEntities(db, userId, [{ type: l.fromType, id: l.fromId }, { type: l.toType, id: l.toId }]);
  if (!resolved.has(`${l.fromType}:${l.fromId}`) || !resolved.has(`${l.toType}:${l.toId}`)) throw notFound("Élément à relier");
  const [r] = await db.insert(schema.knowledgeRelationships).values({ ...l, userId }).onConflictDoNothing().returning();
  return r ?? { ok: true };
}

export async function unlink(db: DB, userId: string, id: string) {
  await db.delete(schema.knowledgeRelationships).where(and(eq(schema.knowledgeRelationships.id, id), eq(schema.knowledgeRelationships.userId, userId)));
}

export async function linksOf(db: DB, userId: string, type: string, id: string) {
  const rows = await db
    .select()
    .from(schema.knowledgeRelationships)
    .where(and(eq(schema.knowledgeRelationships.userId, userId), or(and(eq(schema.knowledgeRelationships.fromType, type), eq(schema.knowledgeRelationships.fromId, id)), and(eq(schema.knowledgeRelationships.toType, type), eq(schema.knowledgeRelationships.toId, id)))));
  const other = rows.map((r) => (r.fromType === type && r.fromId === id ? { type: r.toType, id: r.toId, linkId: r.id, relation: r.relation } : { type: r.fromType, id: r.fromId, linkId: r.id, relation: r.relation }));
  const resolved = await resolveEntities(db, userId, other);
  return other.map((o) => ({ ...o, ...(resolved.get(`${o.type}:${o.id}`) ?? { title: "(élément supprimé)", href: hrefFor(o.type, o.id) }) }));
}

/** Graphe : relations explicites + relations structurelles (tâche/note/fichier/événement ↔ projet). */
export async function graph(db: DB, userId: string) {
  const t = schema;
  const [projects, tasks, notes, files, contacts, knowledge, events, rels] = await Promise.all([
    db.select({ id: t.projects.id, title: t.projects.name, color: t.projects.color }).from(t.projects).where(eq(t.projects.userId, userId)),
    db.select({ id: t.tasks.id, title: t.tasks.title, projectId: t.tasks.projectId }).from(t.tasks).where(eq(t.tasks.userId, userId)).limit(400),
    db.select({ id: t.notes.id, title: t.notes.title, projectId: t.notes.projectId }).from(t.notes).where(eq(t.notes.userId, userId)).limit(300),
    db.select({ id: t.files.id, title: t.files.name, projectId: t.files.projectId, isFolder: t.files.isFolder }).from(t.files).where(eq(t.files.userId, userId)).limit(300),
    db.select({ id: t.contacts.id, title: t.contacts.name }).from(t.contacts).where(eq(t.contacts.userId, userId)).limit(300),
    db.select({ id: t.knowledgeItems.id, title: t.knowledgeItems.title, kind: t.knowledgeItems.kind }).from(t.knowledgeItems).where(eq(t.knowledgeItems.userId, userId)).limit(300),
    db.select({ id: t.calendarEvents.id, title: t.calendarEvents.title, projectId: t.calendarEvents.projectId }).from(t.calendarEvents).where(eq(t.calendarEvents.userId, userId)).limit(200),
    db.select().from(t.knowledgeRelationships).where(eq(t.knowledgeRelationships.userId, userId)).limit(2000),
  ]);
  const nodes = new Map<string, { id: string; type: string; title: string; href: string; color?: string }>();
  const add = (type: string, id: string, title: string, color?: string) => nodes.set(`${type}:${id}`, { id: `${type}:${id}`, type, title, href: hrefFor(type, id), color });
  projects.forEach((p) => add("project", p.id, p.title, p.color));
  knowledge.forEach((k) => add("knowledge", k.id, k.title));
  contacts.forEach((c) => add("contact", c.id, c.title));
  const edges: { source: string; target: string; relation: string }[] = [];
  for (const x of tasks) if (x.projectId) (add("task", x.id, x.title), edges.push({ source: `task:${x.id}`, target: `project:${x.projectId}`, relation: "tâche" }));
  for (const x of notes) (add("note", x.id, x.title), x.projectId && edges.push({ source: `note:${x.id}`, target: `project:${x.projectId}`, relation: "note" }));
  for (const x of files.filter((f) => !f.isFolder)) if (x.projectId) (add("file", x.id, x.title), edges.push({ source: `file:${x.id}`, target: `project:${x.projectId}`, relation: "document" }));
  for (const x of events) if (x.projectId) (add("event", x.id, x.title), edges.push({ source: `event:${x.id}`, target: `project:${x.projectId}`, relation: "réunion" }));
  const missing: { type: string; id: string }[] = [];
  for (const r of rels) {
    for (const [ty, id] of [[r.fromType, r.fromId], [r.toType, r.toId]]) if (!nodes.has(`${ty}:${id}`)) missing.push({ type: ty, id });
  }
  const resolved = await resolveEntities(db, userId, missing);
  for (const v of resolved.values()) add(v.type, v.id, v.title);
  for (const r of rels) if (nodes.has(`${r.fromType}:${r.fromId}`) && nodes.has(`${r.toType}:${r.toId}`)) edges.push({ source: `${r.fromType}:${r.fromId}`, target: `${r.toType}:${r.toId}`, relation: r.relation });
  return { nodes: [...nodes.values()], edges };
}
