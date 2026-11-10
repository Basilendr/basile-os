import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { route, zId } from "@/lib/api";
import { schema } from "@/lib/db";
import { notFound } from "@/lib/errors";

const own = (u: string, id: string) => and(eq(schema.aiMemory.id, id), eq(schema.aiMemory.userId, u));

export const PATCH = route({ body: z.object({ content: z.string().trim().min(3).max(500).optional(), category: z.enum(["preference", "project", "decision", "goal", "method"]).optional() }) }, async ({ db, user, params, body }) => {
  const [m] = await db.update(schema.aiMemory).set(body).where(own(user.id, zId.parse(params.id))).returning();
  if (!m) throw notFound("Souvenir");
  return m;
});
export const DELETE = route({}, async ({ db, user, params }) => {
  const r = await db.delete(schema.aiMemory).where(own(user.id, zId.parse(params.id))).returning();
  if (!r.length) throw notFound("Souvenir");
  return { ok: true };
});
