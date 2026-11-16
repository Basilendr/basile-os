import { route } from "@/lib/api";
import { DeckPatch, deleteDeck, getDeck, updateDeck } from "@/services/flashcards/flashcards";

export const GET = route({}, async ({ db, user, params }) => getDeck(db, user.id, params.id));
export const PATCH = route({ body: DeckPatch }, async ({ db, user, params, body }) => updateDeck(db, user.id, params.id, body));
export const DELETE = route({}, async ({ db, user, params }) => deleteDeck(db, user.id, params.id));
