import "server-only";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { schema, type DB } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { shiftDate } from "../quiz/time";
import { localParts } from "./overlay";
import { downloadAttachment } from "./school";

/**
 * Emploi du temps de la semaine tel que la vie scolaire l'envoie (PDF de M. Casaux), affiché tel quel.
 * Un document envoyé le samedi ou le dimanche vaut pour la semaine suivante ; en semaine, pour la semaine en cours.
 */

const m = schema.schoolMessages;
const d = schema.schoolDocuments;
const DOC = /\.(pdf|png|jpe?g|webp)$/i;
const SENDER = /casaux/i;
const ABOUT = /\bedt\b|emploi du temps/i;

const mimeOf = (name: string, given: string) => (/\.pdf$/i.test(name) ? "application/pdf" : /\.png$/i.test(name) ? "image/png" : /\.jpe?g$/i.test(name) ? "image/jpeg" : /\.webp$/i.test(name) ? "image/webp" : given);

/** Lundi de la semaine que couvre un document envoyé à cette date (AAAA-MM-JJ, heure locale). */
export function weekOfDocument(sent: Date, tz: string) {
  const day = localParts(sent, tz).date;
  const wd = new Date(`${day}T12:00:00Z`).getUTCDay();
  return wd === 0 ? shiftDate(day, 1) : wd === 6 ? shiftDate(day, 2) : shiftDate(day, 1 - wd);
}

export type WeekDocument = { messageId: string; fileId: number; name: string; fromName: string; date: string; subject: string };

/** Dernier emploi du temps envoyé pour la semaine qui commence le lundi `monday`. */
export async function weekDocument(db: DB, userId: string, monday: string, tz: string): Promise<WeekDocument | null> {
  const rows = await db
    .select({ id: m.id, fromName: m.fromName, subject: m.subject, date: m.date, files: m.files })
    .from(m)
    .where(and(eq(m.userId, userId), eq(m.folder, "received"), gte(m.date, new Date(`${shiftDate(monday, -3)}T00:00:00Z`)), lte(m.date, new Date(`${shiftDate(monday, 6)}T00:00:00Z`))))
    .orderBy(desc(m.date));
  for (const r of rows) {
    if (!SENDER.test(r.fromName ?? "") && !ABOUT.test(r.subject)) continue;
    if (weekOfDocument(r.date, tz) !== monday) continue;
    const file = ((r.files ?? []) as { id: number; name: string }[]).find((f) => DOC.test(f.name));
    if (file) return { messageId: r.id, fileId: file.id, name: file.name, fromName: r.fromName ?? "Vie scolaire", date: r.date.toISOString(), subject: r.subject };
  }
  return null;
}

/** Contenu du document : gardé en base après le premier téléchargement depuis École Directe. */
export async function documentContent(db: DB, userId: string, fileId: number): Promise<{ data: Buffer; mimeType: string; name: string }> {
  const [cached] = await db.select().from(d).where(and(eq(d.userId, userId), eq(d.fileId, fileId)));
  if (cached) return { data: cached.data, mimeType: cached.mimeType, name: cached.name };
  // Seulement une pièce jointe d'un message de l'élève.
  const msgs = await db.select({ files: m.files }).from(m).where(eq(m.userId, userId));
  const file = msgs.flatMap((x) => (x.files ?? []) as { id: number; name: string }[]).find((f) => f.id === fileId);
  if (!file) throw notFound("Document");
  const doc = await downloadAttachment(db, userId, fileId);
  const mimeType = mimeOf(file.name, doc.mimeType);
  await db.insert(d).values({ userId, fileId, name: file.name, mimeType, data: doc.data }).onConflictDoNothing();
  return { data: doc.data, mimeType, name: file.name };
}
