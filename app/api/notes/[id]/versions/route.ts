import { route, zId } from "@/lib/api";
import { listVersions } from "@/services/notes";

export const GET = route({}, async ({ db, user, params }) => ({ items: await listVersions(db, user.id, zId.parse(params.id)) }));
