import { route } from "@/lib/api";
import { FocusInput, focusOverview, recordSession } from "@/services/school/focus";

export const GET = route({}, async ({ db, user }) => focusOverview(db, user.id));
export const POST = route({ body: FocusInput, rate: [60, 60_000] }, async ({ db, user, body }) => recordSession(db, user.id, body));
