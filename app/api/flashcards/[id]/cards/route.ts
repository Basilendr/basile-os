import { route } from "@/lib/api";
import { AddInput, addCards } from "@/services/flashcards/flashcards";

/** Ajoute des mots au paquet (un par un, ou une liste « mot = traduction »). */
export const POST = route({ body: AddInput, rate: [60, 60_000] }, async ({ db, user, params, body }) => addCards(db, user.id, params.id, body));
