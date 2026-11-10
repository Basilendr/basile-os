import { desc, eq } from "drizzle-orm";
import { route } from "@/lib/api";
import { schema } from "@/lib/db";

export const GET = route({}, async ({ db, user }) => ({
  items: await db
    .select({ run: schema.automationRuns, name: schema.automations.name })
    .from(schema.automationRuns)
    .innerJoin(schema.automations, eq(schema.automations.id, schema.automationRuns.automationId))
    .where(eq(schema.automationRuns.userId, user.id))
    .orderBy(desc(schema.automationRuns.startedAt))
    .limit(100),
}));
