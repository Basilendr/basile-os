import { and, eq } from "drizzle-orm";
import { route, zId } from "@/lib/api";
import { schema } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { GoalInput } from "@/services/finance";

const own = (u: string, id: string) => and(eq(schema.savingsGoals.id, id), eq(schema.savingsGoals.userId, u));

export const PATCH = route({ body: GoalInput.partial() }, async ({ db, user, params, body }) => {
  const [g] = await db.update(schema.savingsGoals).set(body).where(own(user.id, zId.parse(params.id))).returning();
  if (!g) throw notFound("Objectif");
  return g;
});
export const DELETE = route({}, async ({ db, user, params }) => {
  await db.delete(schema.savingsGoals).where(own(user.id, zId.parse(params.id)));
  return { ok: true };
});
