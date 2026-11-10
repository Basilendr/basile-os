import { route } from "@/lib/api";
import { graph } from "@/services/brain";

export const GET = route({}, async ({ db, user }) => graph(db, user.id));
