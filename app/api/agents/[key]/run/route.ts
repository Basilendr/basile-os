import { z } from "zod";
import { route } from "@/lib/api";
import { AGENTS, type AgentKey } from "@/lib/catalog";
import { runAgent } from "@/services/ai/agents";

export const POST = route({ body: z.object({ input: z.string().trim().min(3).max(4000) }), rate: [10, 60_000] }, async ({ db, user, params, body }) => {
  const key = z.enum(Object.keys(AGENTS) as [AgentKey, ...AgentKey[]]).parse(params.key);
  return runAgent(db, user.id, key, body.input);
});
