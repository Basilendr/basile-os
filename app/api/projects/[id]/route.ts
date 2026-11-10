import { route, zId } from "@/lib/api";
import { ProjectUpdate, deleteProject, getProject, updateProject } from "@/services/projects";

export const GET = route({}, async ({ db, user, params }) => getProject(db, user.id, zId.parse(params.id)));
export const PATCH = route({ body: ProjectUpdate }, async ({ db, user, params, body }) => updateProject(db, user.id, zId.parse(params.id), body));
export const DELETE = route({}, async ({ db, user, params }) => {
  await deleteProject(db, user.id, zId.parse(params.id));
  return { ok: true };
});
