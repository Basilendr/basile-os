import { and, desc, eq } from "drizzle-orm";
import { route, zId } from "@/lib/api";
import { schema } from "@/lib/db";

export const GET = route({}, async ({ db, user, params }) => ({
  items: await db.select().from(schema.automationRuns).where(and(eq(schema.automationRuns.userId, user.id), eq(schema.automationRuns.automationId, zId.parse(params.id)))).orderBy(desc(schema.automationRuns.startedAt)).limit(100),
}));
