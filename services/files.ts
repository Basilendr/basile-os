import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/lib/db";
import { schema } from "@/lib/db";
import { env, serverless } from "@/lib/env";
import { AppError, notFound } from "@/lib/errors";
import { logActivity } from "./activity";
import { emit } from "./events";
import { indexEntity, removeEntity } from "./ai/embeddings";

/** Vercel limite le corps des requêtes à 4,5 Mo. */
export const MAX_UPLOAD = (serverless ? 4 : 25) * 1024 * 1024;
const inDb = () => env.FILE_STORAGE === "db" || (serverless && env.FILE_STORAGE !== "disk");

/** Types acceptés : PDF, images, documents, tableurs, présentations, texte. */
const ALLOWED = [
  /^application\/pdf$/,
  /^image\/(png|jpeg|gif|webp|svg\+xml|heic|avif)$/,
  /^text\/(plain|markdown|csv|html)$/,
  /^application\/(json|rtf|zip)$/,
  /^application\/(msword|vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation)|vnd\.ms-excel|vnd\.ms-powerpoint|vnd\.oasis\.opendocument\.(text|spreadsheet|presentation))$/,
];

const storageRoot = () => path.resolve(env.DATA_DIR, "files");

/** Chemin de stockage opaque, jamais dérivé du nom fourni par l'utilisateur. */
function storagePath(userId: string, key: string) {
  if (!/^[0-9a-f-]{36}$/.test(key) || !/^[0-9a-f-]{36}$/.test(userId)) throw new AppError("bad_request", "Clé de stockage invalide");
  return path.join(storageRoot(), userId, key);
}

export const FileQuery = z.object({
  parentId: z.string().optional(), // uuid | "root"
  q: z.string().max(200).optional(),
  favorite: z.enum(["1"]).optional(),
  kind: z.enum(["pdf", "image", "document", "spreadsheet", "presentation", "other"]).optional(),
  sort: z.enum(["name", "updated", "size", "type"]).default("name"),
  projectId: z.uuid().optional(),
});

export function fileKind(mime: string | null): "folder" | "pdf" | "image" | "document" | "spreadsheet" | "presentation" | "other" {
  if (!mime) return "other";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  if (/spreadsheet|excel|csv/.test(mime)) return "spreadsheet";
  if (/presentation|powerpoint/.test(mime)) return "presentation";
  if (/word|document|text\/|rtf|markdown|json/.test(mime)) return "document";
  return "other";
}

const KIND_SQL: Record<string, SQL> = {
  pdf: sql`${schema.files.mimeType} = 'application/pdf'`,
  image: sql`${schema.files.mimeType} like 'image/%'`,
  spreadsheet: sql`(${schema.files.mimeType} ~ '(spreadsheet|excel|csv)')`,
  presentation: sql`(${schema.files.mimeType} ~ '(presentation|powerpoint)')`,
  document: sql`(${schema.files.mimeType} ~ '(word|text/|rtf|markdown|json|opendocument.text)')`,
};

export async function listFiles(db: DB, userId: string, q: z.infer<typeof FileQuery>) {
  const f = schema.files;
  const where: SQL[] = [eq(f.userId, userId)];
  const searching = Boolean(q.q || q.favorite || q.kind || q.projectId);
  if (!searching) where.push(q.parentId && q.parentId !== "root" ? eq(f.parentId, q.parentId) : isNull(f.parentId));
  if (q.q) where.push(sql`(unaccent(lower(${f.name})) like unaccent(lower(${"%" + q.q + "%"})) or unaccent(lower(coalesce(${f.textContent},''))) like unaccent(lower(${"%" + q.q + "%"})))`);
  if (q.favorite) where.push(eq(f.favorite, true));
  if (q.kind) where.push(KIND_SQL[q.kind] ?? sql`true`);
  if (q.projectId) where.push(eq(f.projectId, q.projectId));
  const order = { name: asc(f.name), updated: desc(f.updatedAt), size: desc(f.size), type: asc(f.mimeType) }[q.sort];
  const rows = await db
    .select({
      id: f.id,
      name: f.name,
      isFolder: f.isFolder,
      mimeType: f.mimeType,
      size: f.size,
      parentId: f.parentId,
      projectId: f.projectId,
      favorite: f.favorite,
      hasText: sql<boolean>`${f.textContent} is not null and length(${f.textContent}) > 0`,
      createdAt: f.createdAt,
      updatedAt: f.updatedAt,
    })
    .from(f)
    .where(and(...where))
    .orderBy(desc(f.isFolder), order)
    .limit(500);
  return rows.map((r) => ({ ...r, kind: r.isFolder ? "folder" : fileKind(r.mimeType) }));
}

export async function getFile(db: DB, userId: string, id: string) {
  const [file] = await db.select().from(schema.files).where(and(eq(schema.files.id, id), eq(schema.files.userId, userId)));
  if (!file) throw notFound("Fichier");
  return file;
}

/** Fil d'Ariane jusqu'à la racine. */
export async function breadcrumbs(db: DB, userId: string, folderId: string | null) {
  const out: { id: string; name: string }[] = [];
  let cur = folderId;
  for (let i = 0; cur && i < 20; i++) {
    const f = await getFile(db, userId, cur);
    out.unshift({ id: f.id, name: f.name });
    cur = f.parentId;
  }
  return out;
}

async function assertFolder(db: DB, userId: string, parentId: string | null | undefined) {
  if (!parentId) return;
  const f = await getFile(db, userId, parentId);
  if (!f.isFolder) throw new AppError("bad_request", "La destination n'est pas un dossier");
}

export async function createFolder(db: DB, userId: string, name: string, parentId: string | null) {
  await assertFolder(db, userId, parentId);
  const [f] = await db.insert(schema.files).values({ userId, name: cleanName(name), isFolder: true, parentId }).returning();
  return f;
}

function cleanName(n: string) {
  const c = n.replace(/[\\/\0<>:"|?*\x00-\x1f]/g, "_").trim().slice(0, 240);
  if (!c) throw new AppError("bad_request", "Nom invalide");
  return c;
}

export async function uploadFile(db: DB, userId: string, file: File, opts: { parentId: string | null; projectId?: string | null }) {
  if (file.size > MAX_UPLOAD) throw new AppError("bad_request", `Fichier trop volumineux (max ${MAX_UPLOAD / 1024 / 1024} Mo)`);
  const mime = file.type || guessMime(file.name);
  if (!ALLOWED.some((r) => r.test(mime))) throw new AppError("bad_request", `Type de fichier non pris en charge : ${mime || "inconnu"}`);
  await assertFolder(db, userId, opts.parentId);
  const buf = Buffer.from(await file.arrayBuffer());
  const key = randomUUID();
  const p = storagePath(userId, key);
  if (inDb()) await db.insert(schema.fileBlobs).values({ storageKey: key, userId, data: buf });
  else {
    await fs.mkdir(path.dirname(p), { recursive: true, mode: 0o700 });
    await fs.writeFile(p, buf, { mode: 0o600 });
  }
  const text = await extractText(buf, mime).catch(() => null);
  const [row] = await db
    .insert(schema.files)
    .values({
      userId,
      name: cleanName(file.name),
      mimeType: mime,
      size: buf.length,
      storageKey: key,
      sha256: createHash("sha256").update(buf).digest("hex"),
      textContent: text?.slice(0, 400_000) ?? null,
      parentId: opts.parentId,
      projectId: opts.projectId ?? null,
    })
    .returning();
  await logActivity(db, userId, { type: "file.uploaded", title: `Fichier ajouté : ${row.name}`, entityType: "file", entityId: row.id, meta: { projectId: row.projectId } });
  await emit(db, { type: "file.uploaded", userId, entityType: "file", entityId: row.id, data: { name: row.name, mimeType: mime }, key: `file.uploaded:${row.id}` });
  if (row.textContent) indexEntity(db, userId, "file", row.id, `${row.name}\n\n${row.textContent}`).catch(() => null);
  return row;
}

function guessMime(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    txt: "text/plain",
    md: "text/markdown",
    csv: "text/csv",
    json: "application/json",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    doc: "application/msword",
    xls: "application/vnd.ms-excel",
    ppt: "application/vnd.ms-powerpoint",
  };
  return (ext && map[ext]) || "";
}

/** Extraction de texte pour la recherche et l'analyse documentaire (PDF, DOCX, texte). */
export async function extractText(buf: Buffer, mime: string): Promise<string | null> {
  if (/^text\/|application\/json/.test(mime)) return buf.toString("utf8");
  if (mime === "application/pdf") {
    const { extractText: pdf, getDocumentProxy } = await import("unpdf");
    const doc = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await pdf(doc, { mergePages: true });
    return Array.isArray(text) ? text.join("\n") : text;
  }
  if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const mammoth = await import("mammoth");
    const r = await mammoth.extractRawText({ buffer: buf });
    return r.value;
  }
  return null;
}

export async function readFileBytes(db: DB, userId: string, id: string) {
  const f = await getFile(db, userId, id);
  if (f.isFolder || !f.storageKey) throw new AppError("bad_request", "Ce n'est pas un fichier");
  const [blob] = await db.select({ data: schema.fileBlobs.data }).from(schema.fileBlobs).where(and(eq(schema.fileBlobs.storageKey, f.storageKey), eq(schema.fileBlobs.userId, userId)));
  const data = blob ? blob.data : await fs.readFile(storagePath(userId, f.storageKey));
  return { file: f, data };
}

export const FilePatch = z
  .object({ name: z.string().min(1).max(240), parentId: z.uuid().nullable(), favorite: z.boolean(), projectId: z.uuid().nullable() })
  .partial();

export async function updateFile(db: DB, userId: string, id: string, patch: z.infer<typeof FilePatch>) {
  const f = await getFile(db, userId, id);
  if (patch.parentId !== undefined) {
    await assertFolder(db, userId, patch.parentId);
    // un dossier ne peut pas être déplacé dans lui-même ou un descendant
    if (f.isFolder && patch.parentId) {
      const chain = await breadcrumbs(db, userId, patch.parentId);
      if (chain.some((c) => c.id === id)) throw new AppError("bad_request", "Déplacement impossible dans un sous-dossier de lui-même");
    }
  }
  if (patch.projectId) {
    const [p] = await db.select({ id: schema.projects.id }).from(schema.projects).where(and(eq(schema.projects.id, patch.projectId), eq(schema.projects.userId, userId)));
    if (!p) throw notFound("Projet");
  }
  const [row] = await db
    .update(schema.files)
    .set({ ...patch, name: patch.name ? cleanName(patch.name) : undefined })
    .where(and(eq(schema.files.id, id), eq(schema.files.userId, userId)))
    .returning();
  return row;
}

/** Suppression récursive (dossiers) — fichiers physiques effacés du stockage privé. */
export async function deleteFile(db: DB, userId: string, id: string) {
  const root = await getFile(db, userId, id);
  const ids = [root.id];
  const keys: string[] = root.storageKey ? [root.storageKey] : [];
  for (let frontier = [root.id]; frontier.length; ) {
    const children = await db.select().from(schema.files).where(and(eq(schema.files.userId, userId), inArray(schema.files.parentId, frontier)));
    frontier = children.filter((c) => c.isFolder).map((c) => c.id);
    for (const c of children) {
      ids.push(c.id);
      if (c.storageKey) keys.push(c.storageKey);
    }
  }
  await db.delete(schema.files).where(and(eq(schema.files.userId, userId), inArray(schema.files.id, ids)));
  if (keys.length) await db.delete(schema.fileBlobs).where(and(eq(schema.fileBlobs.userId, userId), inArray(schema.fileBlobs.storageKey, keys)));
  if (!inDb()) await Promise.all(keys.map((k) => fs.rm(storagePath(userId, k), { force: true })));
  await Promise.all(ids.map((i) => removeEntity(db, userId, "file", i)));
  await logActivity(db, userId, { type: "file.deleted", title: `${root.isFolder ? "Dossier" : "Fichier"} supprimé : ${root.name}`, entityType: "file", entityId: id });
  return { deleted: ids.length };
}

/** Pièces jointes d'emails : uniquement des fichiers appartenant à l'utilisateur. */
export async function loadAttachments(db: DB, userId: string, fileIds: string[]) {
  const out: { filename: string; mimeType: string; data: Buffer }[] = [];
  let total = 0;
  for (const id of fileIds) {
    const { file, data } = await readFileBytes(db, userId, id);
    total += data.length;
    if (total > 24 * 1024 * 1024) throw new AppError("bad_request", "Pièces jointes trop volumineuses (25 Mo max pour Gmail)");
    out.push({ filename: file.name, mimeType: file.mimeType ?? "application/octet-stream", data });
  }
  return out;
}
