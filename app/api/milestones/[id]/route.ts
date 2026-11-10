import { route, zId } from "@/lib/api";
import { MilestoneInput, deleteMilestone, updateMilestone } from "@/services/projects";

export const PATCH = route({ body: MilestoneInput.partial() }, async ({ db, user, params, body }) => updateMilestone(db, user.id, zId.parse(params.id), body));
export const DELETE = route({}, async ({ db, user, params }) => {
  await deleteMilestone(db, user.id, zId.parse(params.id));
  return { ok: true };
});
