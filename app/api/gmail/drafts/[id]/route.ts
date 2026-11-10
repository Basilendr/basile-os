import { z } from "zod";
import { route } from "@/lib/api";
import { deleteDraft } from "@/services/google/gmail";

export const DELETE = route({}, async ({ db, user, params }) => {
  await deleteDraft(db, user.id, z.string().max(64).parse(params.id));
  return { ok: true };
});
