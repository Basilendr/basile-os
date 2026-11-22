import { after } from "next/server";
import { route } from "@/lib/api";
import { AddInput, addCards, runKeywords } from "@/services/definitions/definitions";

export const maxDuration = 300;

/** Ajoute des définitions (une par une, ou une liste « notion : définition »), puis l'IA en repère les mots clés. */
export const POST = route({ body: AddInput, rate: [60, 60_000] }, async ({ db, user, params, body }) => {
  const r = await addCards(db, user.id, params.id, body);
  if (r.analyze) after(() => runKeywords(db, user.id, params.id));
  return r;
});
