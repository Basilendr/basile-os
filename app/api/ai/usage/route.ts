import { eq, sql } from "drizzle-orm";
import { route } from "@/lib/api";
import { schema } from "@/lib/db";

export const GET = route({}, async ({ db, user }) => {
  const rows = await db
    .select({ model: schema.aiUsage.model, feature: schema.aiUsage.feature, calls: sql<number>`count(*)::int`, input: sql<number>`sum(${schema.aiUsage.inputTokens})::int`, output: sql<number>`sum(${schema.aiUsage.outputTokens})::int` })
    .from(schema.aiUsage)
    .where(sql`${eq(schema.aiUsage.userId, user.id)} and ${schema.aiUsage.createdAt} > now() - interval '30 days'`)
    .groupBy(schema.aiUsage.model, schema.aiUsage.feature);
  return { last30Days: rows };
});
