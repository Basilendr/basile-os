import { route } from "@/lib/api";
import { schema } from "@/lib/db";
import { GoalInput } from "@/services/finance";

export const POST = route({ body: GoalInput }, async ({ db, user, body }) => {
  const [g] = await db.insert(schema.savingsGoals).values({ ...body, userId: user.id }).returning();
  return g;
});
