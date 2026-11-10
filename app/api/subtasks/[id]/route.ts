import { z } from "zod";
import { route, zId } from "@/lib/api";
import { deleteSubtask, updateSubtask } from "@/services/tasks";

export const PATCH = route({ body: z.object({ title: z.string().trim().min(1).max(300).optional(), done: z.boolean().optional() }) }, async ({ db, user, params, body }) =>
  updateSubtask(db, user.id, zId.parse(params.id), body),
);
export const DELETE = route({}, async ({ db, user, params }) => {
  await deleteSubtask(db, user.id, zId.parse(params.id));
  return { ok: true };
});
