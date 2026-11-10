import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { route } from "@/lib/api";
import { schema } from "@/lib/db";
import { AGENTS, TOOLS, type AgentKey } from "@/lib/catalog";
import { notFound } from "@/lib/errors";
import { logSecurityEvent } from "@/lib/auth";

const Key = z.enum(Object.keys(AGENTS) as [AgentKey, ...AgentKey[]]);
const Body = z.object({ enabled: z.boolean().optional(), permissions: z.array(z.enum(Object.keys(TOOLS) as [string, ...string[]])).max(30).optional(), instructions: z.string().max(4000).optional() });

export const PATCH = route({ body: Body }, async ({ db, user, params, body }) => {
  const key = Key.parse(params.key);
  // l'agent personnel est le seul autorisé à déléguer
  const permissions = body.permissions?.filter((p) => p !== "deleguer_agent" || key === "personal");
  const [a] = await db.update(schema.agents).set({ ...body, permissions }).where(and(eq(schema.agents.userId, user.id), eq(schema.agents.key, key))).returning();
  if (!a) throw notFound("Agent");
  if (body.permissions) await logSecurityEvent(user.id, "agent.permissions_changed", { agent: key, permissions });
  return a;
});
