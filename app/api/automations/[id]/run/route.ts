import { and, eq } from "drizzle-orm";
import { route, zId } from "@/lib/api";
import { schema } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { execute } from "@/services/automations/engine";

/** Exécution manuelle (test) : déclencheur « manuel » avec un échantillon de données vide. */
export const POST = route({ rate: [20, 60_000] }, async ({ db, user, params }) => {
  const [a] = await db.select().from(schema.automations).where(and(eq(schema.automations.id, zId.parse(params.id)), eq(schema.automations.userId, user.id)));
  if (!a) throw notFound("Automatisation");
  const run = await execute(db, a, { type: "manual", key: `manual:${Date.now()}`, data: { title: a.name, date: new Date().toISOString().slice(0, 10) } });
  return run;
});
