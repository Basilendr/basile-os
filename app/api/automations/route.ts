import { desc, eq } from "drizzle-orm";
import { route } from "@/lib/api";
import { schema } from "@/lib/db";
import { AutomationInput } from "@/lib/automation-schema";


export const GET = route({}, async ({ db, user }) => ({ items: await db.select().from(schema.automations).where(eq(schema.automations.userId, user.id)).orderBy(desc(schema.automations.updatedAt)) }));
export const POST = route({ body: AutomationInput }, async ({ db, user, body }) => {
  const [a] = await db.insert(schema.automations).values({ ...body, userId: user.id } as typeof schema.automations.$inferInsert).returning();
  return a;
});
