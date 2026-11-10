import { route, zId } from "@/lib/api";
import { ContactInput, deleteContact, getContact, updateContact } from "@/services/contacts";

export const GET = route({}, async ({ db, user, params }) => getContact(db, user.id, zId.parse(params.id)));
export const PATCH = route({ body: ContactInput.partial() }, async ({ db, user, params, body }) => updateContact(db, user.id, zId.parse(params.id), body));
export const DELETE = route({}, async ({ db, user, params }) => {
  await deleteContact(db, user.id, zId.parse(params.id));
  return { ok: true };
});
