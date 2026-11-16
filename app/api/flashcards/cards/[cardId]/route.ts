import { route } from "@/lib/api";
import { CardPatch, deleteCard, updateCard } from "@/services/flashcards/flashcards";

export const PATCH = route({ body: CardPatch }, async ({ db, user, params, body }) => updateCard(db, user.id, params.cardId, body));
export const DELETE = route({}, async ({ db, user, params }) => deleteCard(db, user.id, params.cardId));
