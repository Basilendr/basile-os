import { route, zId } from "@/lib/api";
import { AnswerInput, answerQuestion } from "@/services/quiz/quiz";

export const POST = route({ body: AnswerInput, rate: [120, 60_000] }, async ({ db, user, params, body }) => answerQuestion(db, user.id, zId.parse(params.id), body));
