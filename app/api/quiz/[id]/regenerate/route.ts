import { after } from "next/server";
import { route, zId } from "@/lib/api";
import { retryQuiz, runGeneration } from "@/services/quiz/quiz";

export const POST = route({ rate: [10, 60_000] }, async ({ db, user, params }) => {
  const r = await retryQuiz(db, user.id, zId.parse(params.id));
  after(() => runGeneration(db, user.id, r.id));
  return r;
});
