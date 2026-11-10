import { route } from "@/lib/api";
import { schoolSummary } from "@/services/school/school";

export const GET = route({}, async ({ db, user }) => schoolSummary(db, user.id));
