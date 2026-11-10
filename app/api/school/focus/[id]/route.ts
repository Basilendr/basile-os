import { route, zId } from "@/lib/api";
import { deleteSession } from "@/services/school/focus";

export const DELETE = route({}, async ({ db, user, params }) => deleteSession(db, user.id, zId.parse(params.id)));
