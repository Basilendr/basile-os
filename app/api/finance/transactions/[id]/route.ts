import { route, zId } from "@/lib/api";
import { TxInput, deleteTx, updateTx } from "@/services/finance";

export const PATCH = route({ body: TxInput.partial() }, async ({ db, user, params, body }) => updateTx(db, user.id, zId.parse(params.id), body));
export const DELETE = route({}, async ({ db, user, params }) => {
  await deleteTx(db, user.id, zId.parse(params.id));
  return { ok: true };
});
