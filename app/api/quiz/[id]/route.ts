import { route, zId } from "@/lib/api";
import { deleteQuiz, getQuiz } from "@/services/quiz/quiz";

export const GET = route({}, async ({ db, user, params }) => getQuiz(db, user.id, zId.parse(params.id)));
export const DELETE = route({}, async ({ db, user, params }) => deleteQuiz(db, user.id, zId.parse(params.id)));
