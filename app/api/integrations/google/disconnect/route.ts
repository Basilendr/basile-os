import { z } from "zod";
import { route } from "@/lib/api";
import { logSecurityEvent } from "@/lib/auth";
import { disconnectService } from "@/services/google/oauth";

export const POST = route({ body: z.object({ service: z.enum(["gmail", "calendar", "drive", "contacts", "all"]) }) }, async ({ db, user, body }) => {
  const r = await disconnectService(db, user.id, body.service);
  await logSecurityEvent(user.id, r.revoked ? "oauth.google.revoked" : "oauth.google.disconnected", { service: body.service });
  return r;
});
