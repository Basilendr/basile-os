import "server-only";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import type { DB } from "@/lib/db";
import { schema } from "@/lib/db";

export type SearchHit = {
  type: "task" | "project" | "note" | "contact" | "event" | "email" | "file" | "conversation" | "knowledge";
  id: string;
  title: string;
  subtitle?: string;
  href: string;
  date?: string | null;
};

export const SEARCH_TYPES: SearchHit["type"][] = ["task", "project", "note", "event", "email", "file", "contact", "conversation", "knowledge"];

/** Correspondance insensible à la casse et aux accents. */
const match = (col: unknown, q: string): SQL => sql`unaccent(lower(${col})) like unaccent(lower(${"%" + q.replace(/[%_\\]/g, "\\$&") + "%"}))`;

/**
 * Recherche lexicale unifiée sur toutes les sources locales (données de l'utilisateur uniquement).
 * La recherche sémantique (embeddings) est fournie par services/ai/semantic.ts.
 */
export async function universalSearch(db: DB, userId: string, q: string, opts: { types?: SearchHit["type"][]; limit?: number } = {}) {
  const query = q.trim().slice(0, 200);
  if (!query) return [];
  const types = new Set(opts.types?.length ? opts.types : SEARCH_TYPES);
  const lim = opts.limit ?? 6;
  const jobs: Promise<SearchHit[]>[] = [];
  const t = schema;

  if (types.has("task"))
    jobs.push(
      db
        .select({ id: t.tasks.id, title: t.tasks.title, status: t.tasks.status, due: t.tasks.dueDate })
        .from(t.tasks)
        .where(and(eq(t.tasks.userId, userId), sql`(${match(t.tasks.title, query)} or ${match(t.tasks.description, query)})`))
        .orderBy(desc(t.tasks.updatedAt))
        .limit(lim)
        .then((r) => r.map((x) => ({ type: "task" as const, id: x.id, title: x.title, subtitle: x.status === "done" ? "Terminée" : x.due ? `Échéance ${x.due}` : "Tâche", href: `/tasks?task=${x.id}`, date: x.due }))),
    );
  if (types.has("project"))
    jobs.push(
      db
        .select({ id: t.projects.id, name: t.projects.name, description: t.projects.description })
        .from(t.projects)
        .where(and(eq(t.projects.userId, userId), sql`(${match(t.projects.name, query)} or ${match(t.projects.description, query)})`))
        .limit(lim)
        .then((r) => r.map((x) => ({ type: "project" as const, id: x.id, title: x.name, subtitle: x.description.slice(0, 80) || "Projet", href: `/projects/${x.id}` }))),
    );
  if (types.has("note"))
    jobs.push(
      db
        .select({ id: t.notes.id, title: t.notes.title, text: t.notes.contentText, updatedAt: t.notes.updatedAt })
        .from(t.notes)
        .where(and(eq(t.notes.userId, userId), sql`(${match(t.notes.title, query)} or ${match(t.notes.contentText, query)})`))
        .orderBy(desc(t.notes.updatedAt))
        .limit(lim)
        .then((r) => r.map((x) => ({ type: "note" as const, id: x.id, title: x.title, subtitle: excerpt(x.text, query), href: `/notes?note=${x.id}`, date: x.updatedAt.toISOString() }))),
    );
  if (types.has("contact"))
    jobs.push(
      db
        .select({ id: t.contacts.id, name: t.contacts.name, email: t.contacts.email, company: t.contacts.company })
        .from(t.contacts)
        .where(and(eq(t.contacts.userId, userId), sql`(${match(t.contacts.name, query)} or ${match(sql`coalesce(${t.contacts.email},'')`, query)} or ${match(sql`coalesce(${t.contacts.company},'')`, query)})`))
        .limit(lim)
        .then((r) => r.map((x) => ({ type: "contact" as const, id: x.id, title: x.name, subtitle: [x.email, x.company].filter(Boolean).join(" · "), href: `/contacts?contact=${x.id}` }))),
    );
  if (types.has("event"))
    jobs.push(
      db
        .select({ id: t.calendarEvents.id, title: t.calendarEvents.title, startAt: t.calendarEvents.startAt, location: t.calendarEvents.location })
        .from(t.calendarEvents)
        .where(and(eq(t.calendarEvents.userId, userId), sql`(${match(t.calendarEvents.title, query)} or ${match(t.calendarEvents.description, query)})`))
        .orderBy(desc(t.calendarEvents.startAt))
        .limit(lim)
        .then((r) =>
          r.map((x) => ({
            type: "event" as const,
            id: x.id,
            title: x.title,
            subtitle: x.startAt.toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" }) + (x.location ? ` · ${x.location}` : ""),
            href: `/calendar?event=${x.id}`,
            date: x.startAt.toISOString(),
          })),
        ),
    );
  if (types.has("email"))
    jobs.push(
      db
        .select({ id: t.emailMessages.gmailId, subject: t.emailMessages.subject, from: t.emailMessages.fromName, fromEmail: t.emailMessages.fromEmail, date: t.emailMessages.internalDate })
        .from(t.emailMessages)
        .where(
          and(
            eq(t.emailMessages.userId, userId),
            sql`(${match(t.emailMessages.subject, query)} or ${match(t.emailMessages.snippet, query)} or ${match(sql`coalesce(${t.emailMessages.fromName},'') || ' ' || coalesce(${t.emailMessages.fromEmail},'')`, query)})`,
          ),
        )
        .orderBy(desc(t.emailMessages.internalDate))
        .limit(lim)
        .then((r) => r.map((x) => ({ type: "email" as const, id: x.id, title: x.subject || "(sans objet)", subtitle: x.from || x.fromEmail || "", href: `/inbox?message=${x.id}`, date: x.date.toISOString() }))),
    );
  if (types.has("file"))
    jobs.push(
      db
        .select({ id: t.files.id, name: t.files.name, isFolder: t.files.isFolder, parentId: t.files.parentId })
        .from(t.files)
        .where(and(eq(t.files.userId, userId), sql`(${match(t.files.name, query)} or ${match(sql`coalesce(${t.files.textContent},'')`, query)})`))
        .limit(lim)
        .then((r) => r.map((x) => ({ type: "file" as const, id: x.id, title: x.name, subtitle: x.isFolder ? "Dossier" : "Fichier", href: x.isFolder ? `/files?folder=${x.id}` : `/files?file=${x.id}` }))),
    );
  if (types.has("conversation"))
    jobs.push(
      db
        .selectDistinctOn([t.aiConversations.id], { id: t.aiConversations.id, title: t.aiConversations.title, kind: t.aiConversations.kind })
        .from(t.aiConversations)
        .leftJoin(t.aiMessages, eq(t.aiMessages.conversationId, t.aiConversations.id))
        .where(and(eq(t.aiConversations.userId, userId), sql`(${match(t.aiConversations.title, query)} or ${match(sql`coalesce(${t.aiMessages.content},'')`, query)})`))
        .limit(lim)
        .then((r) => r.map((x) => ({ type: "conversation" as const, id: x.id, title: x.title, subtitle: "Conversation IA", href: `${x.kind === "command" ? "/command" : "/assistant"}?c=${x.id}` }))),
    );
  if (types.has("knowledge"))
    jobs.push(
      db
        .select({ id: t.knowledgeItems.id, title: t.knowledgeItems.title, kind: t.knowledgeItems.kind, content: t.knowledgeItems.content })
        .from(t.knowledgeItems)
        .where(and(eq(t.knowledgeItems.userId, userId), sql`(${match(t.knowledgeItems.title, query)} or ${match(t.knowledgeItems.content, query)})`))
        .limit(lim)
        .then((r) => r.map((x) => ({ type: "knowledge" as const, id: x.id, title: x.title, subtitle: excerpt(x.content, query), href: `/brain?item=${x.id}` }))),
    );

  return (await Promise.all(jobs)).flat();
}

function excerpt(text: string, q: string) {
  if (!text) return "";
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  const start = Math.max(0, i - 30);
  return (start > 0 ? "…" : "") + text.slice(start, start + 100).replace(/\s+/g, " ");
}
