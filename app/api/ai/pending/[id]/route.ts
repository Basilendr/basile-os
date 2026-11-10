import { z } from "zod";
import { route, zId } from "@/lib/api";
import { logSecurityEvent } from "@/lib/auth";
import { decidePending } from "@/services/ai/tools";

/** Validation explicite par l'utilisateur d'une action préparée par l'IA ou une automatisation. */
export const POST = route({ body: z.object({ approve: z.boolean(), edits: z.record(z.string(), z.unknown()).optional() }), rate: [30, 60_000] }, async ({ db, user, params, body }) => {
  const r = await decidePending(db, user.id, zId.parse(params.id), body.approve, body.edits);
  await logSecurityEvent(user.id, body.approve ? "ai.action.approved" : "ai.action.rejected", { tool: r.tool, status: r.status });
  return r;
});
