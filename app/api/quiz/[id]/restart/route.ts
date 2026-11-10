import { route, zId } from "@/lib/api";
import { restartQuiz } from "@/services/quiz/quiz";

export const POST = route({}, async ({ db, user, params }) => restartQuiz(db, user.id, zId.parse(params.id)));
