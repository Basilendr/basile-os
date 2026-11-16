import { after } from "next/server";
import { route } from "@/lib/api";
import { CreateInput, createDeck, overview, runExtraction } from "@/services/flashcards/flashcards";

export const maxDuration = 300;

/** Paquets de vocabulaire et cartes à revoir aujourd'hui. */
export const GET = route({}, async ({ db, user }) => overview(db, user.id));

/** Nouveau paquet : document Drive ou texte collé (lus par l'IA en arrière-plan), ou mots saisis à la main. */
export const POST = route({ body: CreateInput, rate: [15, 60_000] }, async ({ db, user, body }) => {
  const r = await createDeck(db, user.id, body);
  if (r.generating) after(() => runExtraction(db, user.id, r.id));
  return r;
});
