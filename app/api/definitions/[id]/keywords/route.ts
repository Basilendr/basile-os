import { after } from "next/server";
import { route } from "@/lib/api";
import { prepareKeywords, runKeywords } from "@/services/definitions/definitions";

export const maxDuration = 300;

/** Relance l'analyse des mots importants par l'IA (sauf ceux choisis à la main). */
export const POST = route({ rate: [6, 60_000] }, async ({ db, user, params }) => {
  const r = await prepareKeywords(db, user.id, params.id);
  after(() => runKeywords(db, user.id, params.id, true));
  return r;
});
