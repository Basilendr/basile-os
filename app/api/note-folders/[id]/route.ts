import { z } from "zod";
import { route, zId } from "@/lib/api";
import { deleteFolder, renameFolder } from "@/services/notes";

export const PATCH = route({ body: z.object({ name: z.string().trim().min(1).max(100) }) }, async ({ db, user, params, body }) => renameFolder(db, user.id, zId.parse(params.id), body.name));
export const DELETE = route({}, async ({ db, user, params }) => {
  await deleteFolder(db, user.id, zId.parse(params.id));
  return { ok: true };
});
