import { desc, eq } from "drizzle-orm";
import { route } from "@/lib/api";
import { schema } from "@/lib/db";

export const GET = route({}, async ({ db, user }) => ({
  items: await db
    .select({ id: schema.schoolMessages.id, subject: schema.schoolMessages.subject, fromName: schema.schoolMessages.fromName, date: schema.schoolMessages.date, read: schema.schoolMessages.read })
    .from(schema.schoolMessages)
    .where(eq(schema.schoolMessages.userId, user.id))
    .orderBy(desc(schema.schoolMessages.date))
    .limit(200),
}));
