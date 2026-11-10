import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { route } from "@/lib/api";
import { schema } from "@/lib/db";

const Q = z.object({ kind: z.enum(["assistant", "command"]).optional(), q: z.string().max(200).optional() });

export const GET = route({ query: Q }, async ({ db, user, query }) => {
  const c = schema.aiConversations;
  const where = [eq(c.userId, user.id)];
  if (query.kind) where.push(eq(c.kind, query.kind));
  if (query.q) where.push(sql`(unaccent(lower(${c.title})) like unaccent(lower(${"%" + query.q + "%"})) or exists (select 1 from ${schema.aiMessages} m where m.conversation_id = ${c.id} and unaccent(lower(m.content)) like unaccent(lower(${"%" + query.q + "%"}))))`);
  return { items: await db.select().from(c).where(and(...where)).orderBy(desc(c.updatedAt)).limit(100) };
});
