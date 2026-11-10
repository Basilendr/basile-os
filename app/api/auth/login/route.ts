import { z } from "zod";
import { eq } from "drizzle-orm";
import { route } from "@/lib/api";
import { schema } from "@/lib/db";
import { verifyPassword } from "@/lib/crypto";
import { createSession, logSecurityEvent } from "@/lib/auth";
import { AppError } from "@/lib/errors";

const Body = z.object({ email: z.email(), password: z.string().min(1).max(200) });

export const POST = route({ auth: false, body: Body, rate: [8, 5 * 60_000] }, async ({ db, body }) => {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, body.email.toLowerCase()));
  const ok = user ? await verifyPassword(body.password, user.passwordHash) : false;
  if (!user || !ok) {
    await logSecurityEvent(user?.id ?? null, "login.failure", { email: body.email.toLowerCase() });
    throw new AppError("unauthorized", "Identifiants incorrects");
  }
  await createSession(user.id);
  await logSecurityEvent(user.id, "login.success");
  return { ok: true };
});
