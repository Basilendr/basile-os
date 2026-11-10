import { and, eq } from "drizzle-orm";
import { route, zId } from "@/lib/api";
import { schema } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { AutomationInput } from "@/lib/automation-schema";

const own = (u: string, id: string) => and(eq(schema.automations.id, id), eq(schema.automations.userId, u));

export const GET = route({}, async ({ db, user, params }) => {
  const [a] = await db.select().from(schema.automations).where(own(user.id, zId.parse(params.id)));
  if (!a) throw notFound("Automatisation");
  return a;
});
export const PATCH = route({ body: AutomationInput.partial() }, async ({ db, user, params, body }) => {
  const [a] = await db.update(schema.automations).set(body as Partial<typeof schema.automations.$inferInsert>).where(own(user.id, zId.parse(params.id))).returning();
  if (!a) throw notFound("Automatisation");
  return a;
});
export const DELETE = route({}, async ({ db, user, params }) => {
  const r = await db.delete(schema.automations).where(own(user.id, zId.parse(params.id))).returning();
  if (!r.length) throw notFound("Automatisation");
  return { ok: true };
});
