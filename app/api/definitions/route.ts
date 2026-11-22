import { after } from "next/server";
import { route } from "@/lib/api";
import { CreateInput, createDeck, overview, runExtraction, runKeywords } from "@/services/definitions/definitions";

export const maxDuration = 300;

/** Paquets de définitions et cartes à revoir aujourd'hui. */
export const GET = route({}, async ({ db, user }) => overview(db, user.id));

/** Nouveau paquet : liste collée (prête tout de suite, mots clés affinés par l'IA), cours Drive ou texte (lus par l'IA), ou saisie à la main. */
export const POST = route({ body: CreateInput, rate: [15, 60_000] }, async ({ db, user, body }) => {
  const r = await createDeck(db, user.id, body);
  if (r.generating) after(() => runExtraction(db, user.id, r.id));
  else if (r.analyze) after(() => runKeywords(db, user.id, r.id));
  return r;
});
