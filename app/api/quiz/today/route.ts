import { after } from "next/server";
import { z } from "zod";
import { route } from "@/lib/api";
import { ChooseInput, chooseDaily, runGeneration, todayDocs } from "@/services/quiz/quiz";

const Q = z.object({ range: z.enum(["today", "week"]).default("today") });

/** Documents enregistrés aujourd'hui (ou ces 7 derniers jours) : l'élève choisit celui de son quiz du jour. */
export const GET = route({ query: Q }, async ({ db, user, query }) => todayDocs(db, user.id, query.range));

/** Quiz du jour sur le document choisi, avec la partie à réviser si elle est précisée ; rédigé en arrière-plan. */
export const POST = route({ body: ChooseInput, rate: [10, 60_000] }, async ({ db, user, body }) => {
  const r = await chooseDaily(db, user.id, body);
  after(() => runGeneration(db, user.id, r.id));
  return r;
});
