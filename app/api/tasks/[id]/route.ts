import { route, zId } from "@/lib/api";
import { TaskUpdate, deleteTask, getTask, updateTask } from "@/services/tasks";

export const GET = route({}, async ({ db, user, params }) => getTask(db, user.id, zId.parse(params.id)));
export const PATCH = route({ body: TaskUpdate }, async ({ db, user, params, body }) => updateTask(db, user.id, zId.parse(params.id), body));
export const DELETE = route({}, async ({ db, user, params }) => {
  await deleteTask(db, user.id, zId.parse(params.id));
  return { ok: true };
});
