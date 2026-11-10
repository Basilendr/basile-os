import { route, zId } from "@/lib/api";
import { NoteUpdate, deleteNote, getNote, updateNote } from "@/services/notes";

export const GET = route({}, async ({ db, user, params }) => getNote(db, user.id, zId.parse(params.id)));
export const PATCH = route({ body: NoteUpdate }, async ({ db, user, params, body }) => updateNote(db, user.id, zId.parse(params.id), body));
export const DELETE = route({}, async ({ db, user, params }) => {
  await deleteNote(db, user.id, zId.parse(params.id));
  return { ok: true };
});
