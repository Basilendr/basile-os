import { z } from "zod";
import { route } from "@/lib/api";
import { answer, syncSchool } from "@/services/school/school";
import { log } from "@/lib/log";

export const POST = route({ body: z.object({ index: z.number().int().min(0).max(20) }), rate: [10, 10 * 60_000] }, async ({ db, user, body }) => {
  const r = await answer(db, user.id, body.index);
  if (r.status === "connected") syncSchool(db, user.id).catch((e) => log.warn("school.initial_sync_failed", { error: String(e) }));
  return r;
});
