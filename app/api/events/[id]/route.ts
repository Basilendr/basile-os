import { route, zId } from "@/lib/api";
import { EventPatch, deleteEvent, getEvent, updateEvent } from "@/services/calendar";

export const GET = route({}, async ({ db, user, params }) => getEvent(db, user.id, zId.parse(params.id)));
export const PATCH = route({ body: EventPatch }, async ({ db, user, params, body }) => updateEvent(db, user.id, zId.parse(params.id), body));
export const DELETE = route({}, async ({ db, user, params }) => {
  await deleteEvent(db, user.id, zId.parse(params.id));
  return { ok: true };
});
