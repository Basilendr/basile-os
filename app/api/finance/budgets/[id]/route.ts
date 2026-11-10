import { and, eq } from "drizzle-orm";
import { route, zId } from "@/lib/api";
import { schema } from "@/lib/db";

export const DELETE = route({}, async ({ db, user, params }) => {
  await db.delete(schema.budgets).where(and(eq(schema.budgets.id, zId.parse(params.id)), eq(schema.budgets.userId, user.id)));
  return { ok: true };
});
