import { route, zId } from "@/lib/api";
import { MilestoneInput, addMilestone } from "@/services/projects";

export const POST = route({ body: MilestoneInput }, async ({ db, user, params, body }) => addMilestone(db, user.id, zId.parse(params.id), body));
