import { after } from "next/server";
import { route, zId } from "@/lib/api";
import { SourcesInput, evalQuizNow, runGeneration, setEvalSources } from "@/services/quiz/quiz";
import { checkUser } from "@/services/quiz/schedule";

/** Documents à réviser pour l'évaluation : si une étape (J-7, J-3, veille) est déjà atteinte, son quiz est préparé aussitôt. */
export const PUT = route({ body: SourcesInput }, async ({ db, user, params, body }) => {
  const r = await setEvalSources(db, user.id, zId.parse(params.id), body);
  after(() => checkUser(db, user.id).catch(() => null));
  return r;
});

/** Quiz d'entraînement immédiat sur l'évaluation. */
export const POST = route({ rate: [10, 60_000] }, async ({ db, user, params }) => {
  const r = await evalQuizNow(db, user.id, zId.parse(params.id));
  after(() => runGeneration(db, user.id, r.id));
  return r;
});
