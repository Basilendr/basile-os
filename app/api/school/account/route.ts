import { z } from "zod";
import { route } from "@/lib/api";
import { logSecurityEvent } from "@/lib/auth";
import { connect, disconnect, getAccount, publicAccount, syncSchool } from "@/services/school/school";
import { log } from "@/lib/log";

export const GET = route({}, async ({ db, user }) => publicAccount(await getAccount(db, user.id)));

/** Identifiants École Directe : transmis uniquement au serveur, chiffrés au repos, jamais renvoyés. */
export const POST = route({ body: z.object({ username: z.string().trim().min(1).max(120), password: z.string().min(1).max(200) }), rate: [6, 10 * 60_000] }, async ({ db, user, body }) => {
  const r = await connect(db, user.id, body.username, body.password);
  await logSecurityEvent(user.id, "school.connected", { status: r.status });
  if (r.status === "connected") syncSchool(db, user.id).catch((e) => log.warn("school.initial_sync_failed", { error: String(e) }));
  return r;
});

export const DELETE = route({}, async ({ db, user }) => {
  await disconnect(db, user.id);
  await logSecurityEvent(user.id, "school.disconnected");
  return { ok: true };
});
