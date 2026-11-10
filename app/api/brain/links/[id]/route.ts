import { route, zId } from "@/lib/api";
import { unlink } from "@/services/brain";

export const DELETE = route({}, async ({ db, user, params }) => {
  await unlink(db, user.id, zId.parse(params.id));
  return { ok: true };
});
