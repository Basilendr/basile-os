import { and, eq, isNull } from "drizzle-orm";
import { route } from "@/lib/api";
import { schema } from "@/lib/db";

export const POST = route({}, async ({ db, user }) => {
  await db
    .update(schema.notifications)
    .set({ readAt: new Date() })
    .where(and(eq(schema.notifications.userId, user.id), isNull(schema.notifications.readAt)));
  return { ok: true };
});
