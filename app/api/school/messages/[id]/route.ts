import { route, zId } from "@/lib/api";
import { messageContent } from "@/services/school/school";

export const GET = route({}, async ({ db, user, params }) => messageContent(db, user.id, zId.parse(params.id)));
