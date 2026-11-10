import { z } from "zod";
import { route, zDate } from "@/lib/api";
import { BlocksZ, generatePlan, getPlan, savePlan } from "@/services/ai/planner";

export const GET = route({ query: z.object({ date: zDate }) }, async ({ db, user, query }) => ({ plan: await getPlan(db, user.id, query.date) }));
export const POST = route({ body: z.object({ date: zDate }), rate: [12, 60_000] }, async ({ db, user, body }) => generatePlan(db, user.id, body.date));
export const PATCH = route({ body: z.object({ date: zDate, blocks: BlocksZ.optional(), status: z.enum(["draft", "accepted", "rejected"]).optional() }) }, async ({ db, user, body }) =>
  savePlan(db, user.id, body.date, { blocks: body.blocks, status: body.status }),
);
