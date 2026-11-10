import { route } from "@/lib/api";
import { destroySession, logSecurityEvent } from "@/lib/auth";

export const POST = route({}, async ({ user }) => {
  await logSecurityEvent(user.id, "logout");
  await destroySession();
  return { ok: true };
});
