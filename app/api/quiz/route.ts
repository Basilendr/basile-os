import { after } from "next/server";
import { route } from "@/lib/api";
import { CustomInput, createCustom, overview, runGeneration } from "@/services/quiz/quiz";

export const GET = route({}, async ({ db, user }) => overview(db, user.id));

/** Quiz à la demande sur les documents choisis : la rédaction se poursuit après la réponse. */
export const POST = route({ body: CustomInput, rate: [10, 60_000] }, async ({ db, user, body }) => {
  const r = await createCustom(db, user.id, body);
  after(() => runGeneration(db, user.id, r.id));
  return r;
});
