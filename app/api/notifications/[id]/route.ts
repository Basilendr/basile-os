import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { route } from "@/lib/api";
import { schema } from "@/lib/db";
import { notFound } from "@/lib/errors";

const own = (userId: string, id: string) => and(eq(schema.notifications.id, id), eq(schema.notifications.userId, userId));

export const PATCH = route({ body: z.object({ read: z.boolean() }) }, async ({ db, user, params, body }) => {
  const [n] = await db
    .update(schema.notifications)
    .set({ readAt: body.read ? new Date() : null })
    .where(own(user.id, z.uuid().parse(params.id)))
    .returning();
  if (!n) throw notFound("Notification");
  return n;
});

export const DELETE = route({}, async ({ db, user, params }) => {
  const rows = await db.delete(schema.notifications).where(own(user.id, z.uuid().parse(params.id))).returning({ id: schema.notifications.id });
  if (!rows.length) throw notFound("Notification");
  return { ok: true };
});
