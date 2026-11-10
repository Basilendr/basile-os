import { z } from "zod";
import { route, zId } from "@/lib/api";
import { explainQuestion } from "@/services/quiz/quiz";

export const POST = route({ body: z.object({ questionId: z.string().min(1).max(20) }), rate: [20, 60_000] }, async ({ db, user, params, body }) => explainQuestion(db, user.id, zId.parse(params.id), body.questionId));
