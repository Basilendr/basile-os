import { route } from "@/lib/api";
import { listAgents } from "@/services/ai/agents";

export const GET = route({}, async ({ db, user }) => ({ items: await listAgents(db, user.id) }));
