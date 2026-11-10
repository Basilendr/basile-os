import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { route } from "@/lib/api";
import { schema } from "@/lib/db";
import { env } from "@/lib/env";
import { verifyPassword } from "@/lib/crypto";
import { destroySession } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { disconnectService } from "@/services/google/oauth";

/** Suppression définitive du compte : exige le mot de passe et la phrase de confirmation. */
export const DELETE = route({ body: z.object({ password: z.string().min(1), confirm: z.literal("SUPPRIMER") }), rate: [3, 60_000] }, async ({ db, user, body }) => {
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
  if (!(await verifyPassword(body.password, u.passwordHash))) throw new AppError("invalid_credentials", "Mot de passe incorrect");
  await disconnectService(db, user.id, "all").catch(() => null); // révoque l'accès Google
  await fs.rm(path.resolve(env.DATA_DIR, "files", user.id), { recursive: true, force: true });
  await destroySession();
  await db.delete(schema.users).where(eq(schema.users.id, user.id)); // cascade sur toutes les données
  return { ok: true };
});
