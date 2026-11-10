import { z } from "zod";
import { and, eq, like } from "drizzle-orm";
import { route } from "@/lib/api";
import { schema } from "@/lib/db";
import { logSecurityEvent } from "@/lib/auth";
import { AppError } from "@/lib/errors";

export const DELETE = route({}, async ({ db, user, params }) => {
  const prefix = z.string().regex(/^[0-9a-f]{16}$/).parse(params.id);
  if (user.sessionId.startsWith(prefix)) throw new AppError("bad_request", "Utilise « Se déconnecter » pour la session actuelle.");
  const r = await db.delete(schema.sessions).where(and(eq(schema.sessions.userId, user.id), like(schema.sessions.id, `${prefix}%`))).returning();
  await logSecurityEvent(user.id, "session.revoked", { count: r.length });
  return { revoked: r.length };
});
