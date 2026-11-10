import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { route } from "@/lib/api";
import { schema } from "@/lib/db";

export const GET = route({ query: z.object({ status: z.enum(["pending", "all"]).default("pending") }) }, async ({ db, user, query }) => {
  const where = [eq(schema.aiPendingActions.userId, user.id)];
  if (query.status === "pending") where.push(eq(schema.aiPendingActions.status, "pending"));
  return { items: await db.select().from(schema.aiPendingActions).where(and(...where)).orderBy(desc(schema.aiPendingActions.createdAt)).limit(100) };
});
