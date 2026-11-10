import { z } from "zod";
import { route, zDate } from "@/lib/api";
import { commitBlock } from "@/services/ai/planner";

/** Écrit un bloc dans le calendrier réel : exige `confirm: true` (validation explicite). */
export const POST = route({ body: z.object({ date: zDate, blockId: z.string().max(64), confirm: z.literal(true) }) }, async ({ db, user, body }) => commitBlock(db, user.id, body.date, body.blockId));
