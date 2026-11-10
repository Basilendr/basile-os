import "server-only";
import { and, arrayContains, asc, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/lib/db";
import { schema } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import { logActivity } from "./activity";
import { emit } from "./events";
import { rowsOf } from "@/lib/sql";
import { indexEntity, removeEntity } from "./ai/embeddings";

/** Une version est conservée au plus toutes les 5 minutes d'édition, et toujours avant une restauration. */
const VERSION_INTERVAL_MS = 5 * 60_000;
const MAX_VERSIONS = 50;

export const NoteCreate = z.object({
  title: z.string().trim().max(300).default("Sans titre"),
  content: z.record(z.string(), z.unknown()).default({ type: "doc", content: [] }),
  contentText: z.string().max(500_000).default(""),
  folderId: z.uuid().nullable().optional(),
  projectId: z.uuid().nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
  favorite: z.boolean().default(false),
});

export const NoteUpdate = NoteCreate.partial().extend({
  /** Révision connue du client : protège contre l'écrasement d'une version plus récente. */
  baseRevision: z.number().int().optional(),
});

export const NoteQuery = z.object({
  folderId: z.string().optional(), // uuid | "none"
  tag: z.string().max(40).optional(),
  favorite: z.enum(["1"]).optional(),
  projectId: z.uuid().optional(),
  q: z.string().max(200).optional(),
});

export async function listNotes(db: DB, userId: string, q: z.infer<typeof NoteQuery>) {
  const n = schema.notes;
  const where: SQL[] = [eq(n.userId, userId)];
  if (q.folderId === "none") where.push(isNull(n.folderId));
  else if (q.folderId) where.push(eq(n.folderId, q.folderId));
  if (q.tag) where.push(arrayContains(n.tags, [q.tag]));
  if (q.favorite) where.push(eq(n.favorite, true));
  if (q.projectId) where.push(eq(n.projectId, q.projectId));
  if (q.q) where.push(sql`(unaccent(lower(${n.title})) like unaccent(lower(${"%" + q.q + "%"})) or unaccent(lower(${n.contentText})) like unaccent(lower(${"%" + q.q + "%"})))`);
  return db
    .select({
      id: n.id,
      title: n.title,
      excerpt: sql<string>`left(${n.contentText}, 160)`,
      folderId: n.folderId,
      projectId: n.projectId,
      tags: n.tags,
      favorite: n.favorite,
      updatedAt: n.updatedAt,
      createdAt: n.createdAt,
    })
    .from(n)
    .where(and(...where))
    .orderBy(desc(n.favorite), desc(n.updatedAt))
    .limit(500);
}

export async function getNote(db: DB, userId: string, id: string) {
  const [note] = await db.select().from(schema.notes).where(and(eq(schema.notes.id, id), eq(schema.notes.userId, userId)));
  if (!note) throw notFound("Note");
  return note;
}

export async function createNote(db: DB, userId: string, raw: z.input<typeof NoteCreate>) {
  const input = NoteCreate.parse(raw);
  await assertRefs(db, userId, input.folderId, input.projectId);
  const [note] = await db.insert(schema.notes).values({ ...input, userId }).returning();
  await logActivity(db, userId, { type: "note.created", title: `Note créée : ${note.title}`, entityType: "note", entityId: note.id, meta: { projectId: note.projectId } });
  await emit(db, { type: "note.created", userId, entityType: "note", entityId: note.id, data: { title: note.title }, key: `note.created:${note.id}` });
  indexEntity(db, userId, "note", note.id, `${note.title}\n\n${note.contentText}`).catch(() => null);
  return note;
}

export async function updateNote(db: DB, userId: string, id: string, raw: z.input<typeof NoteUpdate>) {
  const { baseRevision, ...patch } = NoteUpdate.parse(raw);
  const current = await getNote(db, userId, id);
  if (baseRevision !== undefined && baseRevision < current.revision) {
    throw new AppError("conflict", "Cette note a été modifiée ailleurs. Recharge-la avant d'enregistrer.", { revision: current.revision });
  }
  await assertRefs(db, userId, patch.folderId, patch.projectId);
  const contentChanged = patch.content !== undefined || patch.title !== undefined;
  if (contentChanged) await maybeSnapshot(db, userId, current);
  const [note] = await db
    .update(schema.notes)
    .set({ ...patch, revision: contentChanged ? current.revision + 1 : current.revision })
    .where(and(eq(schema.notes.id, id), eq(schema.notes.userId, userId)))
    .returning();
  if (contentChanged) scheduleIndex(db, userId, note.id);
  return note;
}

/** Réindexation différée (anti-rebond) pour ne pas appeler le fournisseur à chaque frappe. */
const pendingIndex = new Map<string, ReturnType<typeof setTimeout>>();
function scheduleIndex(db: DB, userId: string, id: string) {
  clearTimeout(pendingIndex.get(id));
  pendingIndex.set(
    id,
    setTimeout(async () => {
      pendingIndex.delete(id);
      const [n] = await db.select().from(schema.notes).where(eq(schema.notes.id, id));
      if (n) await indexEntity(db, userId, "note", n.id, `${n.title}\n\n${n.contentText}`).catch(() => null);
    }, 30_000),
  );
  pendingIndex.get(id)?.unref?.();
}

async function maybeSnapshot(db: DB, userId: string, note: typeof schema.notes.$inferSelect, force = false) {
  const [last] = await db
    .select({ createdAt: schema.noteVersions.createdAt })
    .from(schema.noteVersions)
    .where(eq(schema.noteVersions.noteId, note.id))
    .orderBy(desc(schema.noteVersions.createdAt))
    .limit(1);
  if (!force && last && Date.now() - last.createdAt.getTime() < VERSION_INTERVAL_MS) return;
  if (!force && !note.contentText.trim() && note.title === "Sans titre") return;
  await db.insert(schema.noteVersions).values({ userId, noteId: note.id, revision: note.revision, title: note.title, content: note.content });
  await db.execute(sql`
    delete from ${schema.noteVersions} where note_id = ${note.id} and id not in (
      select id from ${schema.noteVersions} where note_id = ${note.id} order by created_at desc limit ${MAX_VERSIONS}
    )`);
}

export async function listVersions(db: DB, userId: string, noteId: string) {
  await getNote(db, userId, noteId);
  return db
    .select({ id: schema.noteVersions.id, revision: schema.noteVersions.revision, title: schema.noteVersions.title, createdAt: schema.noteVersions.createdAt })
    .from(schema.noteVersions)
    .where(and(eq(schema.noteVersions.noteId, noteId), eq(schema.noteVersions.userId, userId)))
    .orderBy(desc(schema.noteVersions.createdAt));
}

export async function getVersion(db: DB, userId: string, versionId: string) {
  const [v] = await db.select().from(schema.noteVersions).where(and(eq(schema.noteVersions.id, versionId), eq(schema.noteVersions.userId, userId)));
  if (!v) throw notFound("Version");
  return v;
}

export async function restoreVersion(db: DB, userId: string, noteId: string, versionId: string, contentText: string) {
  const note = await getNote(db, userId, noteId);
  const v = await getVersion(db, userId, versionId);
  if (v.noteId !== noteId) throw notFound("Version");
  await maybeSnapshot(db, userId, note, true);
  const [restored] = await db
    .update(schema.notes)
    .set({ title: v.title, content: v.content, contentText, revision: note.revision + 1 })
    .where(eq(schema.notes.id, noteId))
    .returning();
  await logActivity(db, userId, { type: "note.restored", title: `Version restaurée : ${v.title}`, entityType: "note", entityId: noteId });
  return restored;
}

export async function deleteNote(db: DB, userId: string, id: string) {
  const [n] = await db.delete(schema.notes).where(and(eq(schema.notes.id, id), eq(schema.notes.userId, userId))).returning();
  if (!n) throw notFound("Note");
  await removeEntity(db, userId, "note", id);
  await logActivity(db, userId, { type: "note.deleted", title: `Note supprimée : ${n.title}`, entityType: "note", entityId: id });
}

export async function noteTags(db: DB, userId: string) {
  const rows = await db.execute<{ tag: string; n: number }>(
    sql`select unnest(tags) as tag, count(*)::int as n from ${schema.notes} where user_id = ${userId} group by 1 order by 2 desc, 1 limit 100`,
  );
  return rowsOf<{ tag: string; n: number }>(rows);
}

/* Dossiers */
export const FolderInput = z.object({ name: z.string().trim().min(1).max(100), parentId: z.uuid().nullable().optional() });

export async function listFolders(db: DB, userId: string) {
  return db
    .select({
      id: schema.noteFolders.id,
      name: schema.noteFolders.name,
      parentId: schema.noteFolders.parentId,
      count: sql<number>`(select count(*)::int from ${schema.notes} n where n.folder_id = ${schema.noteFolders.id})`,
    })
    .from(schema.noteFolders)
    .where(eq(schema.noteFolders.userId, userId))
    .orderBy(asc(schema.noteFolders.position), asc(schema.noteFolders.name));
}

export async function createFolder(db: DB, userId: string, raw: z.input<typeof FolderInput>) {
  const input = FolderInput.parse(raw);
  const [f] = await db.insert(schema.noteFolders).values({ ...input, userId }).returning();
  return f;
}

export async function renameFolder(db: DB, userId: string, id: string, name: string) {
  const [f] = await db.update(schema.noteFolders).set({ name }).where(and(eq(schema.noteFolders.id, id), eq(schema.noteFolders.userId, userId))).returning();
  if (!f) throw notFound("Dossier");
  return f;
}

export async function deleteFolder(db: DB, userId: string, id: string) {
  const r = await db.delete(schema.noteFolders).where(and(eq(schema.noteFolders.id, id), eq(schema.noteFolders.userId, userId))).returning();
  if (!r.length) throw notFound("Dossier");
}

async function assertRefs(db: DB, userId: string, folderId?: string | null, projectId?: string | null) {
  if (folderId) {
    const [f] = await db.select({ id: schema.noteFolders.id }).from(schema.noteFolders).where(and(eq(schema.noteFolders.id, folderId), eq(schema.noteFolders.userId, userId)));
    if (!f) throw notFound("Dossier");
  }
  if (projectId) {
    const [p] = await db.select({ id: schema.projects.id }).from(schema.projects).where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)));
    if (!p) throw notFound("Projet");
  }
}
