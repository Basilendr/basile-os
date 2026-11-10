import { z } from "zod";
import { route, zId } from "@/lib/api";
import { deleteManual, setHomeworkDone } from "@/services/school/school";

export const PATCH = route({ body: z.object({ done: z.boolean() }) }, async ({ db, user, params, body }) => setHomeworkDone(db, user.id, zId.parse(params.id), body.done));
export const DELETE = route({}, async ({ db, user, params }) => {
  await deleteManual(db, user.id, "homework", zId.parse(params.id));
  return { ok: true };
});
