import { route } from "@/lib/api";
import { listLabels } from "@/services/google/gmail";

export const GET = route({}, async ({ db, user }) => ({ labels: await listLabels(db, user.id) }));
