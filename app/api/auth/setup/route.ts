import { z } from "zod";
import { route } from "@/lib/api";
import { createOwner } from "@/services/account";
import { createSession, logSecurityEvent } from "@/lib/auth";

const Body = z.object({
  email: z.email().max(200),
  password: z.string().min(10, "10 caractères minimum").max(200),
  displayName: z.string().trim().min(1).max(80),
  timezone: z.string().max(60).optional(),
});

export const POST = route({ auth: false, body: Body, rate: [5, 60_000] }, async ({ db, body }) => {
  const user = await createOwner(db, body);
  await createSession(user.id);
  await logSecurityEvent(user.id, "account.created");
  return { ok: true };
});
