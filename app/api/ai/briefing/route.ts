import { z } from "zod";
import { route } from "@/lib/api";
import { generateBriefing } from "@/services/ai/briefing";

export const POST = route({ body: z.object({ kind: z.enum(["morning", "evening"]).default("morning") }), rate: [10, 60_000] }, async ({ db, user, body }) => generateBriefing(db, user.id, body.kind));
