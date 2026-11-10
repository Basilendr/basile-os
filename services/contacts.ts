import "server-only";
import { and, arrayContains, asc, desc, eq, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/lib/db";
import { schema } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { logActivity } from "./activity";
import { linksOf } from "./brain";

export const ContactInput = z.object({
  name: z.string().trim().min(1, "Nom requis").max(200),
  email: z.email().max(200).nullable().optional().or(z.literal("").transform(() => null)),
  phone: z.string().max(40).nullable().optional(),
  company: z.string().max(200).nullable().optional(),
  jobTitle: z.string().max(200).nullable().optional(),
  notes: z.string().max(20_000).default(""),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  favorite: z.boolean().default(false),
});

export async function listContacts(db: DB, userId: string, q: { q?: string; tag?: string; favorite?: boolean; company?: string }) {
  const c = schema.contacts;
  const where: SQL[] = [eq(c.userId, userId)];
  if (q.q) where.push(sql`unaccent(lower(${c.name} || ' ' || coalesce(${c.email},'') || ' ' || coalesce(${c.company},'') || ' ' || coalesce(${c.phone},''))) like unaccent(lower(${"%" + q.q + "%"}))`);
  if (q.tag) where.push(arrayContains(c.tags, [q.tag]));
  if (q.favorite) where.push(eq(c.favorite, true));
  if (q.company) where.push(eq(c.company, q.company));
  return db.select().from(c).where(and(...where)).orderBy(desc(c.favorite), asc(c.name)).limit(1000);
}

export async function getContact(db: DB, userId: string, id: string) {
  const [c] = await db.select().from(schema.contacts).where(and(eq(schema.contacts.id, id), eq(schema.contacts.userId, userId)));
  if (!c) throw notFound("Contact");
  // Historique des interactions réel : emails échangés, événements partagés, liens
  const emails = c.email
    ? await db
        .select({ id: schema.emailMessages.gmailId, subject: schema.emailMessages.subject, date: schema.emailMessages.internalDate, labels: schema.emailMessages.labelIds })
        .from(schema.emailMessages)
        .where(and(eq(schema.emailMessages.userId, userId), or(sql`lower(${schema.emailMessages.fromEmail}) = lower(${c.email})`, sql`lower(${schema.emailMessages.to}) like lower(${"%" + c.email + "%"})`)))
        .orderBy(desc(schema.emailMessages.internalDate))
        .limit(20)
    : [];
  const events = c.email
    ? await db
        .select({ id: schema.calendarEvents.id, title: schema.calendarEvents.title, startAt: schema.calendarEvents.startAt })
        .from(schema.calendarEvents)
        .where(and(eq(schema.calendarEvents.userId, userId), sql`${schema.calendarEvents.attendees}::text ilike ${"%" + c.email + "%"}`))
        .orderBy(desc(schema.calendarEvents.startAt))
        .limit(20)
    : [];
  return { ...c, emails, events, links: await linksOf(db, userId, "contact", id) };
}

export async function createContact(db: DB, userId: string, raw: z.input<typeof ContactInput>) {
  const input = ContactInput.parse(raw);
  const [c] = await db.insert(schema.contacts).values({ ...input, email: input.email ?? null, userId }).returning();
  await logActivity(db, userId, { type: "contact.created", title: `Contact ajouté : ${c.name}`, entityType: "contact", entityId: c.id });
  return c;
}

export async function updateContact(db: DB, userId: string, id: string, raw: Partial<z.input<typeof ContactInput>>) {
  const patch = ContactInput.partial().parse(raw);
  const [c] = await db.update(schema.contacts).set(patch).where(and(eq(schema.contacts.id, id), eq(schema.contacts.userId, userId))).returning();
  if (!c) throw notFound("Contact");
  return c;
}

export async function deleteContact(db: DB, userId: string, id: string) {
  const r = await db.delete(schema.contacts).where(and(eq(schema.contacts.id, id), eq(schema.contacts.userId, userId))).returning();
  if (!r.length) throw notFound("Contact");
}
