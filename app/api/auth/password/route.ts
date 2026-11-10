import { z } from "zod";
import { and, eq, ne } from "drizzle-orm";
import { route } from "@/lib/api";
import { schema } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/crypto";
import { logSecurityEvent } from "@/lib/auth";
import { AppError } from "@/lib/errors";

export const POST = route({ body: z.object({ current: z.string().min(1).max(200), next: z.string().min(10, "10 caractères minimum").max(200) }), rate: [5, 15 * 60_000] }, async ({ db, user, body }) => {
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
  if (!(await verifyPassword(body.current, u.passwordHash))) throw new AppError("invalid_credentials", "Mot de passe actuel incorrect");
  await db.update(schema.users).set({ passwordHash: await hashPassword(body.next) }).where(eq(schema.users.id, user.id));
  // ferme toutes les autres sessions
  await db.delete(schema.sessions).where(and(eq(schema.sessions.userId, user.id), ne(schema.sessions.id, user.sessionId)));
  await logSecurityEvent(user.id, "password.changed");
  return { ok: true };
});
