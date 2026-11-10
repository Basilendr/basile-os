import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { route, zId } from "@/lib/api";
import { schema } from "@/lib/db";
import { getEvent } from "@/services/calendar";
import { universalSearch } from "@/services/search";
import { linksOf } from "@/services/brain";

/** Préparation d'un rendez-vous : uniquement des éléments réellement trouvés dans les données. */
export const GET = route({}, async ({ db, user, params }) => {
  const ev = await getEvent(db, user.id, zId.parse(params.id));
  const emails = ev.attendees.map((a) => a.email.toLowerCase());
  const words = ev.title.split(/[\s,.:;!?'’()-]+/).filter((w) => w.length > 3).slice(0, 4);
  const contacts = emails.length ? await db.select().from(schema.contacts).where(and(eq(schema.contacts.userId, user.id), inArray(sql`lower(${schema.contacts.email})`, emails))) : [];
  const mailConds = [
    ...emails.map((e) => sql`lower(${schema.emailMessages.fromEmail}) = ${e} or lower(${schema.emailMessages.to}) like ${"%" + e + "%"}`),
    ...words.map((w) => sql`unaccent(lower(${schema.emailMessages.subject})) like unaccent(lower(${"%" + w + "%"}))`),
  ];
  const relatedEmails = mailConds.length
    ? await db
        .select({ id: schema.emailMessages.gmailId, subject: schema.emailMessages.subject, from: schema.emailMessages.fromName, fromEmail: schema.emailMessages.fromEmail, date: schema.emailMessages.internalDate })
        .from(schema.emailMessages)
        .where(and(eq(schema.emailMessages.userId, user.id), or(...mailConds)))
        .orderBy(desc(schema.emailMessages.internalDate))
        .limit(8)
    : [];
  const docs = words.length ? (await universalSearch(db, user.id, words.join(" "), { types: ["note", "file", "knowledge"], limit: 4 })).concat(...(await Promise.all(words.map((w) => universalSearch(db, user.id, w, { types: ["note", "file", "knowledge"], limit: 3 }))))) : [];
  const uniqDocs = [...new Map(docs.map((d) => [`${d.type}:${d.id}`, d])).values()].slice(0, 8);
  const project = ev.projectId ? (await db.select({ id: schema.projects.id, name: schema.projects.name }).from(schema.projects).where(eq(schema.projects.id, ev.projectId)))[0] ?? null : null;
  return { event: ev, contacts, emails: relatedEmails, docs: uniqDocs, links: await linksOf(db, user.id, "event", ev.id), project };
});
